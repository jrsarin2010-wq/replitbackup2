import { describe, it, expect } from "vitest";
import { resolveConversationMode } from "../lib/mode-resolver";
import { validateAIResponse, buildCorrectionHint, deterministicFallback, isGenericGreeting } from "../lib/response-validator";
import { buildModeDirective } from "../lib/prompt-builder";

/**
 * Task #17 — pipeline golden suite.
 *
 * Simula o fluxo completo do ai-engine para cada um dos 4 modos
 * determinísticos, com o cliente OpenAI substituído por um mock que
 * devolve respostas pré-fabricadas (boas ou violadoras). Verifica:
 *   1) o modo correto é resolvido a partir do contexto;
 *   2) o validador classifica a resposta de acordo com o modo;
 *   3) quando há violação, o hint de correção é gerado e o retry mockado
 *      pode obedecer (sem fallback) ou desobedecer (cai no fallback
 *      determinístico seguro);
 *   4) os flags retryUsed/fallbackUsed batem com o caminho percorrido.
 */

interface MockOpenAIReply {
  reply: string;
}

function makeMockOpenAI(seq: MockOpenAIReply[]) {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const r = seq[i++] ?? seq[seq.length - 1];
          return { choices: [{ message: { content: r.reply } }] };
        },
      },
    },
  };
}

const baseValCtx = {
  availabilityInfo: "Quarta 10:00, 14:00, 16:30",
  procedureNames: ["limpeza", "clareamento"],
  ownerTitle: "Dra." as const,
  ownerFirstName: "Ana",
  consultationFee: "200",
  procedurePrices: [200],
};

/**
 * Mini-harness que reproduz fielmente o caminho de validação do
 * processIncomingMessage (ai-engine.ts) — invoca exatamente as mesmas
 * funções de produção (resolveConversationMode, buildModeDirective,
 * validateAIResponse, buildCorrectionHint, deterministicFallback) e só
 * substitui o cliente OpenAI por um mock. Mantém o teste rápido e
 * determinístico sem precisar de DB/conversation cache.
 */
async function runPipeline(opts: {
  ctx: Parameters<typeof resolveConversationMode>[0];
  openaiSeq: MockOpenAIReply[];
  /** Task #23 — simula a flag derivada de historyMessages. */
  isFirstAIReplyInMode?: boolean;
  /** Task #23 — última mensagem do paciente (para detectar saudação). */
  incomingMessage?: string;
}) {
  const { mode } = resolveConversationMode(opts.ctx);
  // Garante que a diretiva do modo realmente vai para o prompt
  const directive = buildModeDirective(mode);
  expect(directive).toContain(`MODO_ATIVO: ${mode}`);

  const client = makeMockOpenAI(opts.openaiSeq);
  let retryUsed = false;
  let fallbackUsed = false;
  const triagePending = mode === "CONVENIO_TRIAGEM";
  const isFirstAIReplyInMode = opts.isFirstAIReplyInMode ?? false;
  const incomingIsGreeting = opts.incomingMessage ? isGenericGreeting(opts.incomingMessage) : false;

  const first = await client.chat.completions.create();
  let reply = first.choices[0].message.content;

  let violations = validateAIResponse({ ...baseValCtx, reply, triagePending, mode, isFirstAIReplyInMode, incomingIsGreeting });
  if (violations.length > 0) {
    retryUsed = true;
    const hint = buildCorrectionHint(violations);
    expect(hint.length).toBeGreaterThan(0);
    const retry = await client.chat.completions.create();
    const retryReply = retry.choices[0].message.content;
    const retryViolations = validateAIResponse({ ...baseValCtx, reply: retryReply, triagePending, mode, isFirstAIReplyInMode, incomingIsGreeting });
    if (retryViolations.length === 0) {
      reply = retryReply;
    } else {
      const union = [...violations, ...retryViolations];
      reply = deterministicFallback(union, { triagePending, mode });
      fallbackUsed = true;
    }
  }
  const finalViolations = validateAIResponse({ ...baseValCtx, reply, triagePending, mode, isFirstAIReplyInMode, incomingIsGreeting });
  return { mode, reply, retryUsed, fallbackUsed, obeyed: finalViolations.length === 0, directive };
}

describe("mode pipeline (Task #17 golden, OpenAI mocked)", () => {
  it("CONVENIO_TRIAGEM: resposta inicial pergunta plano/particular → obedece sem retry", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      openaiSeq: [{ reply: "Claro! Antes, posso confirmar: você vai usar plano ou é particular?" }],
    });
    expect(r.mode).toBe("CONVENIO_TRIAGEM");
    expect(r.obeyed).toBe(true);
    expect(r.retryUsed).toBe(false);
    expect(r.fallbackUsed).toBe(false);
  });

  it("CONVENIO_TRIAGEM: oferece horário sem triagem → retry corrige", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      openaiSeq: [
        { reply: "Posso te marcar quarta às 10:00?" },
        { reply: "Antes de te passar horários, posso saber se você vai usar plano ou é particular?" },
      ],
    });
    expect(r.mode).toBe("CONVENIO_TRIAGEM");
    expect(r.retryUsed).toBe(true);
    expect(r.fallbackUsed).toBe(false);
    expect(r.obeyed).toBe(true);
  });

  it("CONVENIO_AGENDAR: usa termo de venda → retry também viola → fallback", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false } },
      openaiSeq: [
        { reply: "Consegui um encaixe especial pra você quarta às 10:00, corre que vai!" },
        { reply: "Última vaga, garanta já o seu horário!" },
      ],
    });
    expect(r.mode).toBe("CONVENIO_AGENDAR");
    expect(r.retryUsed).toBe(true);
    expect(r.fallbackUsed).toBe(true);
    expect(r.reply).not.toMatch(/encaixe|corre que vai|garanta/i);
  });

  it("CONVENIO_AGENDAR: oferta neutra de horário válido → obedece sem retry", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false } },
      openaiSeq: [{ reply: "Tenho disponível quarta às 10:00 ou às 14:00. Qual fica melhor pra você?" }],
    });
    expect(r.mode).toBe("CONVENIO_AGENDAR");
    expect(r.retryUsed).toBe(false);
    expect(r.fallbackUsed).toBe(false);
    expect(r.obeyed).toBe(true);
  });

  it("PARTICULAR_SPIN: usa SPIN/escassez → permitido, sem retry", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: true, triageComplete: true, triageNeeded: false } },
      openaiSeq: [{ reply: "Consegui um encaixe especial pra você quarta às 10:00. Posso reservar?" }],
    });
    expect(r.mode).toBe("PARTICULAR_SPIN");
    expect(r.retryUsed).toBe(false);
    expect(r.fallbackUsed).toBe(false);
    expect(r.obeyed).toBe(true);
  });

  // ── Task #23 — empatia primeiro em CONVENIO_TRIAGEM ─────────────────────
  it("Task #23: CONVENIO_TRIAGEM 1ª resposta empática (sem pergunta) com queixa do paciente → obedece sem retry", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      isFirstAIReplyInMode: true,
      incomingMessage: "estou com muita dor de dente do siso",
      openaiSeq: [{ reply: "Que dor chata, imagino o quanto está incomodando — vamos cuidar disso pra você." }],
    });
    expect(r.mode).toBe("CONVENIO_TRIAGEM");
    expect(r.retryUsed).toBe(false);
    expect(r.obeyed).toBe(true);
  });

  it("Task #23 (refinado): CONVENIO_TRIAGEM 1ª resposta calorosa para saudação genérica passa SEM pergunta plano/particular", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      isFirstAIReplyInMode: true,
      incomingMessage: "oi, bom dia",
      openaiSeq: [
        { reply: "Oi José, tudo bem? Sou a Ana da clínica, em que posso te ajudar hoje?" },
      ],
    });
    expect(r.mode).toBe("CONVENIO_TRIAGEM");
    expect(r.retryUsed).toBe(false);
    expect(r.fallbackUsed).toBe(false);
    expect(r.obeyed).toBe(true);
  });

  it("Task #23: CONVENIO_TRIAGEM 2ª resposta sem pergunta → viola e retry corrige (1ª-resposta exception NÃO se aplica)", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      isFirstAIReplyInMode: false,
      incomingMessage: "obrigada",
      openaiSeq: [
        { reply: "Imagino o quanto está incomodando." },
        { reply: "Pra te encaminhar: você vai usar plano ou é particular?" },
      ],
    });
    expect(r.mode).toBe("CONVENIO_TRIAGEM");
    expect(r.retryUsed).toBe(true);
    expect(r.obeyed).toBe(true);
  });

  it("Task #23: CONVENIO_AGENDAR após \"uso plano X\" oferece a AGENDA REAL sem SPIN", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false } },
      isFirstAIReplyInMode: false,
      incomingMessage: "uso plano Unimed",
      openaiSeq: [{ reply: "Perfeito! Tenho disponível quarta às 10:00, 14:00 ou 16:30. Qual fica melhor pra você?" }],
    });
    expect(r.mode).toBe("CONVENIO_AGENDAR");
    expect(r.retryUsed).toBe(false);
    expect(r.obeyed).toBe(true);
    expect(r.reply).toMatch(/10:00|14:00|16:30/);
    expect(r.reply.toLowerCase()).not.toMatch(/oportunidade|n[ãa]o perca|aproveite|encaixe especial|corre que vai|garanta j[áa]/);
  });

  it("Task #23: PARTICULAR_SPIN continua aceitando SPIN/escassez normalmente (sem regressão)", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: true, triageComplete: true, triageNeeded: false } },
      isFirstAIReplyInMode: false,
      incomingMessage: "queria saber dos preços",
      openaiSeq: [{ reply: "Consegui um encaixe especial pra você quarta às 10:00, é uma oportunidade — posso reservar?" }],
    });
    expect(r.mode).toBe("PARTICULAR_SPIN");
    expect(r.retryUsed).toBe(false);
    expect(r.obeyed).toBe(true);
  });

  // ── Task #23 (refinado) — simulação de conversas reais de paciente ───────
  // Estes testes percorrem múltiplas trocas seguidas para garantir que a
  // experiência ponta-a-ponta é a esperada: 1ª resposta calorosa SEM
  // pergunta de pagamento, 2ª já pergunta plano/particular, 3ª (depois
  // que paciente respondeu) oferece horários reais sem gatilho mental.

  it("Simulação paciente — saudação \"boa tarde\": 1ª calorosa sem pagamento, 2ª pergunta plano/particular, 3ª oferece agenda", async () => {
    // Turno 1 — paciente: "boa tarde"; IA: acolhe, pergunta como pode ajudar
    const turn1 = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      isFirstAIReplyInMode: true,
      incomingMessage: "boa tarde",
      openaiSeq: [{ reply: "Boa tarde, José! Sou a Ana da clínica, em que posso te ajudar hoje?" }],
    });
    expect(turn1.mode).toBe("CONVENIO_TRIAGEM");
    expect(turn1.obeyed).toBe(true);
    expect(turn1.retryUsed).toBe(false);
    expect(turn1.reply.toLowerCase()).not.toMatch(/plano|particular|conv[eê]nio/);
    expect(turn1.reply).not.toMatch(/\d{1,2}:\d{2}/);

    // Turno 2 — paciente conta a queixa; IA acolhe E pergunta plano/particular
    const turn2 = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      isFirstAIReplyInMode: false,
      incomingMessage: "estou com dor no siso",
      openaiSeq: [{ reply: "Que situação chata, José — imagino o quanto está incomodando. Pra te orientar certinho, você vai usar plano ou é particular?" }],
    });
    expect(turn2.mode).toBe("CONVENIO_TRIAGEM");
    expect(turn2.obeyed).toBe(true);
    expect(turn2.retryUsed).toBe(false);
    expect(turn2.reply.toLowerCase()).toMatch(/plano|particular/);
    expect(turn2.reply).not.toMatch(/\d{1,2}:\d{2}/);

    // Turno 3 — paciente disse "uso Unimed"; IA agora pode oferecer horários da agenda real
    const turn3 = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false } },
      isFirstAIReplyInMode: false,
      incomingMessage: "uso Unimed",
      openaiSeq: [{ reply: "Perfeito, José! Tenho disponível quarta às 10:00, 14:00 ou 16:30. Qual fica melhor pra você?" }],
    });
    expect(turn3.mode).toBe("CONVENIO_AGENDAR");
    expect(turn3.obeyed).toBe(true);
    expect(turn3.retryUsed).toBe(false);
    expect(turn3.reply).toMatch(/10:00|14:00|16:30/);
    expect(turn3.reply.toLowerCase()).not.toMatch(/oportunidade|n[ãa]o perca|aproveite|garanta/);
  });

  it("Simulação paciente — queixa direta na 1ª: IA acolhe sem pagamento, depois pergunta, depois agenda", async () => {
    // Turno 1 — paciente: "estou com dor de dente"; IA: acolhe e pergunta sobre a dor
    const turn1 = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      isFirstAIReplyInMode: true,
      incomingMessage: "estou com muita dor de dente",
      openaiSeq: [{ reply: "Que dor chata, imagino o quanto está incomodando. Conta um pouco mais o que você está sentindo?" }],
    });
    expect(turn1.obeyed).toBe(true);
    expect(turn1.retryUsed).toBe(false);
    expect(turn1.reply.toLowerCase()).not.toMatch(/plano|particular/);

    // Turno 2 — paciente detalha; IA pergunta plano/particular
    const turn2 = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      isFirstAIReplyInMode: false,
      incomingMessage: "é uma pontada quando como gelado",
      openaiSeq: [{ reply: "Entendi, isso costuma ser sensibilidade. Pra te orientar direitinho, você vai usar plano ou é particular?" }],
    });
    expect(turn2.obeyed).toBe(true);
    expect(turn2.reply.toLowerCase()).toMatch(/plano|particular/);
    expect(turn2.reply).not.toMatch(/\d{1,2}:\d{2}/);

    // Turno 3 — paciente: "particular"; IA entra em PARTICULAR_SPIN e pode usar SPIN
    const turn3 = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: true, triageComplete: true, triageNeeded: false } },
      isFirstAIReplyInMode: false,
      incomingMessage: "particular",
      openaiSeq: [{ reply: "Tranquilo! A consulta sai por R$ 200. Tenho quarta às 10:00 ou 14:00, qual fica melhor?" }],
    });
    expect(turn3.mode).toBe("PARTICULAR_SPIN");
    expect(turn3.obeyed).toBe(true);
    expect(turn3.reply).toMatch(/10:00|14:00/);
  });

  it("Simulação anti-regressão — IA NÃO pode oferecer horário durante triagem mesmo perguntando plano/particular junto", async () => {
    // Reproduz o bug que o usuário relatou: "você usa plano ou é particular? Posso te marcar quarta às 10:00?"
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true } },
      isFirstAIReplyInMode: false,
      incomingMessage: "quero marcar uma consulta",
      openaiSeq: [
        { reply: "Você vai usar plano ou é particular? Posso te marcar quarta às 10:00." },
        { reply: "Antes de te passar horários, posso saber: você vai usar plano ou é particular?" },
      ],
    });
    expect(r.mode).toBe("CONVENIO_TRIAGEM");
    expect(r.retryUsed).toBe(true);
    expect(r.obeyed).toBe(true);
    expect(r.reply).not.toMatch(/\d{1,2}:\d{2}/);
  });

  // ── Task #24 — informar valor da consulta proativamente para particular ───
  it("Task #24: diretiva PARTICULAR_SPIN exige informar valor proativamente", () => {
    const directive = buildModeDirective("PARTICULAR_SPIN");
    expect(directive).toMatch(/VALOR DA CONSULTA/i);
    expect(directive).toMatch(/INFORME PROATIVAMENTE/i);
    expect(directive.toLowerCase()).toContain("sem esperar o paciente perguntar");
  });

  it("Task #24: diretiva PARTICULAR_SPIN dá exemplo BOM com valor + horário na mesma frase", () => {
    const directive = buildModeDirective("PARTICULAR_SPIN");
    expect(directive).toMatch(/Exemplo BOM/);
    expect(directive).toMatch(/R\$\s*\d+/);
  });

  it("Task #24: diretiva CONVENIO_AGENDAR continua proibindo falar de valor (sem regressão)", () => {
    const directive = buildModeDirective("CONVENIO_AGENDAR");
    expect(directive).toMatch(/PROIBIDO falar de pre[çc]o|valor de consulta/i);
    expect(directive).not.toMatch(/INFORME PROATIVAMENTE/i);
  });

  it("Task #24: diretiva PARTICULAR_SPIN inclui regra para consulta GRATUITA (chargesConsultation=false)", () => {
    const directive = buildModeDirective("PARTICULAR_SPIN");
    expect(directive).toMatch(/consulta gratuita|n[ãa]o cobra consulta/i);
    expect(directive).toMatch(/destaque|diferencial/i);
  });

  it("Task #24: PARTICULAR_SPIN com consulta GRATUITA — resposta sem R$ destacando \"gratuita\" passa o pipeline", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: true, triageComplete: true, triageNeeded: false } },
      isFirstAIReplyInMode: false,
      incomingMessage: "particular",
      openaiSeq: [{ reply: "Que bom! A primeira avaliação é gratuita aqui na clínica. Tenho quarta às 10:00 ou 14:00, qual fica melhor pra você?" }],
    });
    expect(r.mode).toBe("PARTICULAR_SPIN");
    expect(r.obeyed).toBe(true);
    expect(r.reply.toLowerCase()).toContain("gratuita");
    expect(r.reply).not.toMatch(/R\$/);
  });

  it("Task #24: CONVENIO_AGENDAR — IA mencionar valor (R$) é REJEITADA e retry corrige", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false } },
      openaiSeq: [
        { reply: "Perfeito! A consulta sai por R$ 200. Tenho quarta às 10:00, pode ser?" },
        { reply: "Tenho disponível quarta às 10:00 ou às 14:00. Qual fica melhor pra você?" },
      ],
    });
    expect(r.mode).toBe("CONVENIO_AGENDAR");
    expect(r.retryUsed).toBe(true);
    expect(r.obeyed).toBe(true);
    expect(r.reply).not.toMatch(/R\$/);
  });

  it("Task #24: PARTICULAR_SPIN — IA responde com valor + horário e passa pipeline", async () => {
    const r = await runPipeline({
      ctx: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: { isInsurance: false, isPrivate: true, triageComplete: true, triageNeeded: false } },
      isFirstAIReplyInMode: false,
      incomingMessage: "particular",
      openaiSeq: [{ reply: "Tranquilo! A consulta sai por R$ 200. Tenho quarta às 10:00 ou 14:00, qual fica melhor pra você?" }],
    });
    expect(r.mode).toBe("PARTICULAR_SPIN");
    expect(r.obeyed).toBe(true);
    expect(r.reply).toMatch(/R\$\s*200/);
    expect(r.reply).toMatch(/10:00|14:00/);
  });

  it("PACIENTE_AGENDAR: oferece horário fora da agenda → retry corrige com horário válido", async () => {
    const r = await runPipeline({
      ctx: { contactType: "patient", clinicAcceptsInsurance: false, insuranceMode: { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: false } },
      openaiSeq: [
        { reply: "Posso te encaixar terça às 19:30?" },
        { reply: "Tenho quarta às 14:00 disponível. Posso reservar pra você?" },
      ],
    });
    expect(r.mode).toBe("PACIENTE_AGENDAR");
    expect(r.retryUsed).toBe(true);
    expect(r.fallbackUsed).toBe(false);
    expect(r.obeyed).toBe(true);
  });
});

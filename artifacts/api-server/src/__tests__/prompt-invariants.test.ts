/**
 * BLINDAGEM ANTI-REGRESSAO DOS PROMPTS
 *
 * Cada bloco abaixo trava uma melhoria que ja foi adicionada ao prompt.
 * Se alguem (humano OU agente) remover, renomear ou deslocar uma dessas
 * instrucoes acidentalmente, o teste correspondente falha e impede o merge.
 *
 * REGRA: toda nova melhoria de prompt entra junto com um teste neste arquivo.
 *
 * Invariantes cobertos:
 *   1. SPECIALTY_KNOWLEDGE_LIMIT_HEADER prepended antes de cada secao de
 *      especialidade (impede a IA de misturar conhecimento clinico proprio).
 *   2. Aviso "Horarios mencionados em mensagens anteriores" logo apos a
 *      AGENDA DISPONIVEL (anti horarios-fantasmas vindos do historico).
 *   3. ANCORA de recencia "Apenas os horarios acima existem" logo apos a
 *      AGENDA (reforco contra invencao de horarios via efeito recency).
 *   4. Bloco INCERTEZA com frase obrigatoria "Preciso verificar isso com a
 *      clinica e te respondo em breve" (treina "eu nao sei").
 *   5. REGRAS GERAIS proibe inventar horarios E informacoes (escopo geral).
 *   9. displayClinicName — prefixo "Clinica" automatico na apresentacao:
 *      nome simples ("Sorrizin") → "Clinica Sorrizin"; nome ja com "Clinica"
 *      nao duplica. Trava o uso de displayClinicName no bloco PRIMEIRO CONTATO.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    query: {
      dentalLeadsTable: { findFirst: vi.fn().mockResolvedValue(null) },
      patientsTable:    { findFirst: vi.fn().mockResolvedValue(null) },
      appointmentsTable:{ findMany: vi.fn().mockResolvedValue([]) },
    },
  },
  dentalLeadsTable:  { name: "dental_leads" },
  patientsTable:     { name: "patients" },
  appointmentsTable: { name: "appointments" },
}));

vi.mock("../lib/cache", () => ({
  getCachedSettings: vi.fn().mockResolvedValue({
    clinicName:         "Clinica Teste",
    aiName:             "Ana",
    professionalName:   "Dr. João",
    workingHoursStart:  "08:00",
    workingHoursEnd:    "18:00",
    acceptsInsurance:   false,
    chargesConsultation: true,
    consultationFee:    150,
    paymentMethods:     "Cartão, PIX",
    utcOffsetHours:     -3,
    activeDays:         "1,2,3,4,5",
  }),
  getCachedProcedures:    vi.fn().mockResolvedValue([{ name: "Limpeza", price: 150 }]),
  getCachedProfessionals: vi.fn().mockResolvedValue([{
    id: 1, name: "Dr. João", active: true, specialty: null, cro: null,
    instagramUrl: null, chargesConsultation: true, consultationFee: 150,
    acceptsInsurance: false, insurancePlans: null, insuranceDays: null,
    defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
  }]),
  TenantCache: class {
    get() { return undefined; }
    set() {}
    invalidate() {}
    clear() {}
  },
}));

vi.mock("../lib/ai-learning", () => ({
  getContactMemories:    vi.fn().mockResolvedValue([]),
  getRelevantObjections: vi.fn().mockResolvedValue([]),
  getRelevantKnowledge:  vi.fn().mockResolvedValue([]),
  getOptimizedStrategies: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/lead-engine", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    resolveInsuranceMode: vi.fn().mockResolvedValue({
      isInsuranceContact:    false,
      skipAvailability:      false,
      shouldSkipScheduleOffer: false,
    }),
    getTopStrategies: vi.fn().mockResolvedValue([]),
  };
});

import { buildSplitPrompt } from "../lib/prompt-builder.js";
import {
  SPECIALTY_KNOWLEDGE_LIMIT_HEADER,
  buildDentalSpecialtySection,
} from "../lib/prompt-helpers.js";
import type { ConversationContext } from "../lib/lead-engine.js";

const CONTEXT: ConversationContext = {
  tenantId:     1,
  conversationId: 1,
  contactPhone: "+5511999999999",
  contactName:  "Maria",
  contactType:  "unknown",
};

const AGENDA = "Seg 09:00 | Ter 14:00 | Qua 16:00";

// ─────────────────────────────────────────────────────────────────────────────
// 1. SPECIALTY_KNOWLEDGE_LIMIT_HEADER
// ─────────────────────────────────────────────────────────────────────────────
describe("Invariante #1 — Limite absoluto antes de cada especialidade", () => {
  it("preserva o texto exato do header (nao reescrever sem atualizar este teste)", () => {
    expect(SPECIALTY_KNOWLEDGE_LIMIT_HEADER).toBe(
      "LIMITE ABSOLUTO: Use APENAS as informacoes abaixo. Nao complemente com conhecimento proprio sobre esse procedimento.",
    );
  });

  it("prepend o header em CADA secao de especialidade casada", () => {
    const single = buildDentalSpecialtySection("quero saber sobre lente de resina");
    expect(single).toContain(SPECIALTY_KNOWLEDGE_LIMIT_HEADER);
    const headerIdx = single.indexOf(SPECIALTY_KNOWLEDGE_LIMIT_HEADER);
    const sectionIdx = single.indexOf("ESPECIALIDADE — LENTES DE CONTATO DE RESINA");
    expect(headerIdx).toBeLessThan(sectionIdx);
    expect(headerIdx).toBeGreaterThanOrEqual(0);
  });

  it("repete o header quando varias especialidades sao casadas na mesma mensagem", () => {
    const multi = buildDentalSpecialtySection("comparar lente de resina vs lente de ceramica");
    const occurrences = multi.split(SPECIALTY_KNOWLEDGE_LIMIT_HEADER).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("nao emite o header quando nenhuma especialidade e mencionada", () => {
    const none = buildDentalSpecialtySection("oi tudo bem?");
    expect(none).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Aviso de horarios desatualizados (Task #13 / #16)
// ─────────────────────────────────────────────────────────────────────────────
describe("Invariante #2 — Aviso anti horarios-fantasmas apos AGENDA", () => {
  it("inclui o aviso EXCLUSIVAMENTE/Ignore historico apos AGENDA DISPONIVEL", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("=== AGENDA DISPONIVEL ===");
    expect(dynamicContext).toContain("Horarios mencionados em mensagens anteriores");
    expect(dynamicContext).toContain("EXCLUSIVAMENTE");
    expect(dynamicContext).toContain("Ignore qualquer horario que apareca no historico");

    const agendaIdx = dynamicContext.indexOf("=== AGENDA DISPONIVEL ===");
    const warningIdx = dynamicContext.indexOf("Horarios mencionados em mensagens anteriores");
    expect(warningIdx).toBeGreaterThan(agendaIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ANCORA de recencia (commit 44e1b22)
// ─────────────────────────────────────────────────────────────────────────────
describe("Invariante #3 — Ancora de recencia logo apos AGENDA", () => {
  it("inclui 'ANCORA: Apenas os horarios acima existem' DEPOIS da agenda E DEPOIS do aviso", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("ANCORA: Apenas os horarios acima existem");
    expect(dynamicContext).toContain("Qualquer horario nao listado = inventado = PROIBIDO");

    const agendaIdx = dynamicContext.indexOf("=== AGENDA DISPONIVEL ===");
    const warningIdx = dynamicContext.indexOf("Horarios mencionados em mensagens anteriores");
    const anchorIdx = dynamicContext.indexOf("ANCORA: Apenas os horarios acima existem");

    // Ordem obrigatoria: agenda → warning → ancora
    expect(warningIdx).toBeGreaterThan(agendaIdx);
    expect(anchorIdx).toBeGreaterThan(warningIdx);
  });

  it("mantem a ancora mesmo quando availabilityInfo esta vazio", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("ANCORA: Apenas os horarios acima existem");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Bloco INCERTEZA — treinar "eu nao sei" (commit 66912d3)
// ─────────────────────────────────────────────────────────────────────────────
describe("Invariante #4 — Bloco INCERTEZA com frase obrigatoria", () => {
  it("inclui o bloco INCERTEZA com a frase mandatoria literal", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("INCERTEZA:");
    expect(dynamicContext).toContain('"Preciso verificar isso com a clinica e te respondo em breve."');
    // Categorias-gatilho explicitas para a IA reconhecer quando aplicar
    expect(dynamicContext).toMatch(/preco.*procedimento.*disponibilidade.*plano/);
    expect(dynamicContext).toContain("NUNCA chute");
  });

  it("posiciona INCERTEZA antes de REGRAS GERAIS (zona de recencia)", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    const incertezaIdx = dynamicContext.indexOf("INCERTEZA:");
    const regrasIdx = dynamicContext.indexOf("REGRAS GERAIS:");
    expect(incertezaIdx).toBeGreaterThan(0);
    expect(regrasIdx).toBeGreaterThan(incertezaIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. REGRAS GERAIS — proibicao geral de invencao (commit 66912d3)
// ─────────────────────────────────────────────────────────────────────────────
describe("Invariante #5 — Proibicao geral de inventar (horarios E informacoes)", () => {
  it("REGRAS GERAIS proibe inventar horarios E informacoes (nao apenas horarios)", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("Nunca invente horarios nem informacoes");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Apresentacao em DUAS etapas (Task #25 — fluxo correto de primeiro contato)
// ─────────────────────────────────────────────────────────────────────────────
//
// Bug reportado: a IA perguntava "plano ou particular?" JUNTO com a apresentacao,
// antes mesmo de saber o que o paciente precisa. O comportamento correto e:
// 1) Apresentacao + "como posso te ajudar?"
// 2) Paciente diz o que precisa
// 3) Somente entao a IA pergunta "plano ou particular?"
//
// Anti-regressao (Task #25): a regra de PRIMEIRO CONTATO NUNCA pode pedir
// plano/particular na apresentacao, mesmo quando a clinica aceita convenio.
import { getCachedSettings, getCachedProfessionals } from "../lib/cache.js";
import { resolveInsuranceMode } from "../lib/lead-engine.js";

describe("Invariante #6 — Apresentacao em DUAS etapas (Task #25)", () => {
  function enableInsuranceMocks() {
    (getCachedSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      clinicName: "Clinica Teste", aiName: "Ana", professionalName: "Dr. João",
      workingHoursStart: "08:00", workingHoursEnd: "18:00",
      acceptsInsurance: true, insurancePlans: "Unimed, Bradesco",
      chargesConsultation: true, consultationFee: 150,
      paymentMethods: "Cartão, PIX", utcOffsetHours: -3, activeDays: "1,2,3,4,5",
    });
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      id: 1, name: "Dr. João", active: true, specialty: null, cro: null,
      instagramUrl: null, chargesConsultation: true, consultationFee: 150,
      acceptsInsurance: true, insurancePlans: "Unimed, Bradesco", insuranceDays: null,
      defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    }]);
  }

  it("PRIMEIRO CONTATO com convenio: bloco de identidade pergunta 'como posso te ajudar?' (NAO plano/particular)", async () => {
    enableInsuranceMocks();
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", true /* isFirstContact */, 0, false, true,
    );
    expect(identityPrompt).toContain("REGRA ABSOLUTA — PRIMEIRO CONTATO");
    expect(identityPrompt).toContain("Como posso te ajudar?");
    // Anti-regressao: NUNCA pedir plano/particular como pergunta na apresentacao.
    // (a string "plano ou particular" pode aparecer dentro de PROIBICOES; o que nao
    // pode existir e o exemplo de pergunta tipo "voce vai usar plano ou e particular?")
    expect(identityPrompt).not.toMatch(/voce vai usar plano/i);
    expect(identityPrompt).not.toContain("Antes de te ajudar");
    expect(identityPrompt).not.toMatch(/MESMA mensagem.*plano/i);
  });

  it("PRIMEIRO CONTATO com convenio: bloco de identidade proibe SPIN/horarios/preco/plano-particular na apresentacao", async () => {
    enableInsuranceMocks();
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(identityPrompt).toContain("PROIBIDO ABSOLUTO no PRIMEIRO CONTATO");
    expect(identityPrompt).toContain('NAO pergunte "plano ou particular?" na apresentacao');
    expect(identityPrompt).toContain("NAO faca perguntas SPIN");
    expect(identityPrompt).toContain("NAO ofereca horarios");
    expect(identityPrompt).toContain("NAO mencione preco");
  });

  it("PRIMEIRO CONTATO sem convenio: usa o mesmo formato 'como posso te ajudar?'", async () => {
    // usa o mock default acceptsInsurance=false
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(identityPrompt).toContain("REGRA ABSOLUTA — PRIMEIRO CONTATO");
    expect(identityPrompt).toContain("Como posso te ajudar?");
    expect(identityPrompt).not.toContain("plano ou e particular");
  });

  it("PACIENTE cadastrado: bloco de identidade nao injeta plano/particular", async () => {
    enableInsuranceMocks();
    const PATIENT_CTX: ConversationContext = { ...CONTEXT, contactType: "patient" };
    const { identityPrompt } = await buildSplitPrompt(
      1, PATIENT_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(identityPrompt).not.toContain("plano ou e particular");
  });

  it("Contato JA DECLAROU plano: identityPrompt continua usando 'como posso te ajudar?' (sem nova pergunta)", async () => {
    enableInsuranceMocks();
    (resolveInsuranceMode as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false,
    });
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "tenho unimed", "neutral", true, 0, false, true,
    );
    expect(identityPrompt).toContain("REGRA ABSOLUTA — PRIMEIRO CONTATO");
    expect(identityPrompt).toContain("Como posso te ajudar?");
    expect(identityPrompt).not.toContain("plano ou e particular");
  });

  it("Bloco de bifurcacao no contexto dinamico exige fluxo em DUAS etapas (apresentar primeiro, perguntar plano/particular DEPOIS)", async () => {
    enableInsuranceMocks();
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(dynamicContext).toContain("FLUXO CONVENIO/PARTICULAR");
    // Novo contrato: pergunta plano/particular SO ocorre depois do contato descrever o motivo
    expect(dynamicContext).toContain("Como posso te ajudar?");
    expect(dynamicContext).toMatch(/Apos o contato descrever o que precisa/i);
    expect(dynamicContext).toContain("PROIBIDO comecar SPIN antes de receber a resposta");
    // Anti-regressao: nunca instrui a perguntar plano/particular junto com a apresentacao
    expect(dynamicContext).not.toMatch(/JUNTO com a apresentacao inicial/i);
    expect(dynamicContext).not.toMatch(/NA MESMA mensagem/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. SPIN AUSENTE quando triagem plano/particular esta pendente (anti-regressao)
// ─────────────────────────────────────────────────────────────────────────────
//
// Bug em producao: mesmo com a Invariante #6 protegendo a regra de bifurcacao,
// o leadBlock continuava injetando o bloco completo de SPIN Selling
// ("VOCE E UMA CRA", "METODOLOGIA SPIN SELLING", "Fase SPIN atual",
// "ESTRATEGIAS ATIVAS" listando spin_situacao/spin_problema/etc) quando o
// contato ainda nao tinha respondido plano/particular. O modelo via instrucoes
// contraditorias (proibicao no topo, metodologia detalhada embaixo) e seguia o
// SPIN. A Invariante #6 nao detectava porque so verificava a presenca da
// bifurcacao, nao a ausencia do SPIN.
//
// Fix: novo branch no leadBlock para "triagem pendente" que NAO injeta SPIN.
// Esta invariante trava a ausencia das instrucoes de SPIN nesse cenario.
import { db } from "@workspace/db";

describe("Invariante #7 — SPIN AUSENTE quando triagem plano/particular esta pendente", () => {
  function enableInsuranceMocksWithLead() {
    (getCachedSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      clinicName: "Clinica Teste", aiName: "Ana", professionalName: "Dr. João",
      workingHoursStart: "08:00", workingHoursEnd: "18:00",
      acceptsInsurance: true, insurancePlans: "Unimed, Bradesco",
      chargesConsultation: true, consultationFee: 150,
      paymentMethods: "Cartão, PIX", utcOffsetHours: -3, activeDays: "1,2,3,4,5",
    });
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 1, name: "Dr. João", active: true, specialty: null, cro: null,
      instagramUrl: null, chargesConsultation: true, consultationFee: 150,
      acceptsInsurance: true, insurancePlans: "Unimed, Bradesco", insuranceDays: null,
      defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    }]);
    (db.query.dentalLeadsTable.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99, tenantId: 1, name: "Maria", interest: "limpeza", source: "instagram",
      status: "new", temperature: "warm", lastContactAt: null,
      paymentType: null, professionalId: null,
    });
  }

  const LEAD_CTX: ConversationContext = { ...CONTEXT, contactType: "lead", leadId: 99 };

  function fullPrompt(identity: string, dynamic: string): string {
    return `${identity}\n\n${dynamic}`;
  }

  it("NAO contem 'VOCE E UMA CRA' quando triagem pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(fullPrompt(identityPrompt, dynamicContext)).not.toContain("VOCE E UMA CRA");
  });

  it("NAO contem 'METODOLOGIA SPIN SELLING' quando triagem pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(fullPrompt(identityPrompt, dynamicContext)).not.toContain("METODOLOGIA SPIN SELLING");
  });

  it("NAO contem 'Fase SPIN atual' quando triagem pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(fullPrompt(identityPrompt, dynamicContext)).not.toContain("Fase SPIN atual");
  });

  it("NAO contem 'ESTRATEGIAS ATIVAS' quando triagem pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(fullPrompt(identityPrompt, dynamicContext)).not.toContain("ESTRATEGIAS ATIVAS");
  });

  it("NAO contem NENHUM nome de estrategia SPIN (spin_situacao/problema/implicacao/necessidade) quando triagem pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    const all = fullPrompt(identityPrompt, dynamicContext);
    expect(all).not.toContain("spin_situacao");
    expect(all).not.toContain("spin_problema");
    expect(all).not.toContain("spin_implicacao");
    expect(all).not.toContain("spin_necessidade");
  });

  it("NAO contem termos de pressao em ingles (loss_aversion/price_anchoring/scarcity) quando triagem pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    const all = fullPrompt(identityPrompt, dynamicContext);
    expect(all).not.toContain("loss_aversion");
    expect(all).not.toContain("price_anchoring");
    expect(all).not.toMatch(/\bscarcity\b/);
  });

  it("NAO contem termos de pressao em portugues (escassez/urgencia) quando triagem pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    const all = fullPrompt(identityPrompt, dynamicContext);
    expect(all.toLowerCase()).not.toContain("escassez");
    expect(all.toLowerCase()).not.toContain("urgencia");
  });

  it("CONTEM a pergunta 'plano ou e particular' quando triagem pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(fullPrompt(identityPrompt, dynamicContext)).toContain("plano ou e particular");
  });

  it("CONTEM proibicao 'PROIBIDO comecar SPIN antes de receber a resposta' quando triagem pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(fullPrompt(identityPrompt, dynamicContext)).toContain("PROIBIDO comecar SPIN antes de receber a resposta");
  });

  it("CONTEM o cabecalho 'TRIAGEM PLANO/PARTICULAR PENDENTE' no leadBlock", async () => {
    enableInsuranceMocksWithLead();
    const { dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(dynamicContext).toContain("TRIAGEM PLANO/PARTICULAR PENDENTE");
  });

  // Dupla cobertura: triagem pendente protege tanto isFirstContact=true quanto =false
  // (ex: contato voltou a falar dias depois sem ter respondido plano/particular)
  it("isFirstContact=FALSE: SPIN continua AUSENTE quando triagem ainda pendente", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "oi", "neutral", false /* isFirstContact */, 0, false, true,
    );
    const all = fullPrompt(identityPrompt, dynamicContext);
    expect(all).not.toContain("METODOLOGIA SPIN SELLING");
    expect(all).not.toContain("ESTRATEGIAS ATIVAS");
    expect(all).not.toContain("VOCE E UMA CRA");
    expect(all).toContain("TRIAGEM PLANO/PARTICULAR PENDENTE");
    expect(all).toContain("plano ou e particular");
  });

  // Branch de pre-triagem nao deve injetar instrucoes de cancelamento/reagendamento
  // (a regra estrita e: aguardar plano/particular antes de qualquer outra acao)
  it("intent=cancellation com triagem pendente: nao adiciona ramo de cancelamento, mantem REGRA ESTRITA", async () => {
    enableInsuranceMocksWithLead();
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "cancellation", "", "quero cancelar", "neutral", true, 0, false, true,
    );
    const all = fullPrompt(identityPrompt, dynamicContext);
    expect(all).toContain("TRIAGEM PLANO/PARTICULAR PENDENTE");
    expect(all).toContain("REGRA ESTRITA");
    expect(all).not.toContain("METODOLOGIA SPIN SELLING");
    expect(all).not.toContain("ESTRATEGIAS ATIVAS");
    // intent-leakage guard: nenhum branch de cancelamento dentro da pre-triagem
    expect(all).not.toContain("CONTATO CANCELANDO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7b. Caminhos preservados — particular volta SPIN, convenio mantem MODO
// ─────────────────────────────────────────────────────────────────────────────

describe("Invariante #7b — Caminhos preservados apos a triagem", () => {
  function enableInsuranceMocksWithLead() {
    (getCachedSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      clinicName: "Clinica Teste", aiName: "Ana", professionalName: "Dr. João",
      workingHoursStart: "08:00", workingHoursEnd: "18:00",
      acceptsInsurance: true, insurancePlans: "Unimed, Bradesco",
      chargesConsultation: true, consultationFee: 150,
      paymentMethods: "Cartão, PIX", utcOffsetHours: -3, activeDays: "1,2,3,4,5",
    });
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 1, name: "Dr. João", active: true, specialty: null, cro: null,
      instagramUrl: null, chargesConsultation: true, consultationFee: 150,
      acceptsInsurance: true, insurancePlans: "Unimed, Bradesco", insuranceDays: null,
      defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    }]);
    (db.query.dentalLeadsTable.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99, tenantId: 1, name: "Maria", interest: "limpeza", source: "instagram",
      status: "new", temperature: "warm", lastContactAt: null,
      paymentType: null, professionalId: null,
    });
  }

  const LEAD_CTX: ConversationContext = { ...CONTEXT, contactType: "lead", leadId: 99 };

  it("declarou PARTICULAR: SPIN volta a aparecer (METODOLOGIA SPIN SELLING + ESTRATEGIAS ATIVAS)", async () => {
    enableInsuranceMocksWithLead();
    (resolveInsuranceMode as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isInsurance: false, isPrivate: true, triageComplete: true, triageNeeded: false,
    });
    const { dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "particular", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("METODOLOGIA SPIN SELLING");
    expect(dynamicContext).toContain("ESTRATEGIAS ATIVAS");
  });

  it("declarou PLANO: MODO CONVENIO ativo, sem termos de pressao", async () => {
    enableInsuranceMocksWithLead();
    (resolveInsuranceMode as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false,
    });
    const { dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "tenho unimed", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("MODO CONVENIO");
    expect(dynamicContext).not.toContain("METODOLOGIA SPIN SELLING");
    expect(dynamicContext).not.toContain("loss_aversion");
    expect(dynamicContext).not.toContain("price_anchoring");
  });

  // ── Task #11 — vazamento de SPIN em convenio ──────────────────────────────
  // Apos o contato declarar plano/convenio, o prompt final NUNCA pode conter
  // termos de venda — nem como instrucao positiva nem como proibicao. O modelo
  // pode absorver qualquer ocorrencia desses termos e gerar pressao comercial
  // em pacientes de plano (bug original reportado).
  it("Task #11: declarou PLANO — prompt final NAO contem nenhum termo proibido (SPIN/escassez/urgencia/ancoragem/agenda disputada/consegui um encaixe/sao os ultimos)", async () => {
    enableInsuranceMocksWithLead();
    (resolveInsuranceMode as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false,
    });
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "Seg 09:00 | Ter 14:00", "tenho unimed",
      "neutral", false, 0, false, true,
    );
    const all = `${identityPrompt}\n${dynamicContext}`;
    const lower = all.toLowerCase();
    // Verifica que a METODOLOGIA SPIN não está ATIVA — a palavra "spin" pode aparecer
    // no bloco MODO CONVENIO como parte da explicação do que é proibido ("fluxo spin selling
    // que não se aplica a convênio"), mas os marcadores de SPIN ativo não devem existir.
    expect(lower).not.toContain("metodologia spin selling");
    expect(lower).not.toContain("estrategias ativas:");
    expect(lower).not.toContain("escassez");
    expect(lower).not.toContain("urgencia");
    expect(lower).not.toContain("urgência");
    expect(lower).not.toContain("ancoragem");
    expect(lower).not.toContain("consegui um encaixe");
    expect(lower).not.toContain("agenda disputada");
    expect(lower).not.toMatch(/s[aã]o\s+os\s+[uú]ltimos/);
    expect(lower).not.toContain("spin_situacao");
    expect(lower).not.toContain("spin_problema");
    expect(lower).not.toContain("spin_implicacao");
    expect(lower).not.toContain("spin_necessidade");
    expect(lower).not.toContain("loss_aversion");
    expect(lower).not.toContain("price_anchoring");
    expect(lower).not.toMatch(/\bscarcity\b/);
    // Garante que continua acolhendo (nao zerou o bloco)
    expect(dynamicContext).toContain("MODO CONVENIO");
  });

  it("Task #11: TRIAGEM PENDENTE — strategyBlock NAO injetado mesmo se getOptimizedStrategies retornar texto com termos de venda", async () => {
    enableInsuranceMocksWithLead();
    const aiLearning = await import("../lib/ai-learning");
    (aiLearning.getOptimizedStrategies as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ESTRATEGIAS ATIVAS:\n- spin_situacao: faca perguntas de situacao\n- spin_problema: explore o problema\n- scarcity: use escassez real\n- urgency: crie urgencia\n- price_anchoring: ancore o preco\n- loss_aversion: enfatize a perda"
    );
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "Seg 09:00 | Ter 14:00", "oi",
      "neutral", false, 0, false, true,
    );
    const all = `${identityPrompt}\n${dynamicContext}`;
    const lower = all.toLowerCase();
    expect(lower).not.toContain("spin_situacao");
    expect(lower).not.toContain("spin_problema");
    expect(lower).not.toContain("loss_aversion");
    expect(lower).not.toContain("price_anchoring");
    expect(lower).not.toMatch(/\bscarcity\b/);
    expect(lower).not.toContain("escassez");
    expect(lower).not.toContain("urgencia");
    expect(lower).not.toContain("crie urgencia");
    expect(lower).not.toContain("ancore o preco");
    // Continua pedindo a triagem
    expect(all).toContain("plano ou e particular");
  });

  it("Task #11: declarou PLANO em intent=scheduling — prompt final continua sem termos proibidos", async () => {
    enableInsuranceMocksWithLead();
    (resolveInsuranceMode as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false,
    });
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "scheduling", "Seg 09:00 | Ter 14:00", "tenho unimed e quero marcar",
      "neutral", false, 0, false, true,
    );
    const lower = `${identityPrompt}\n${dynamicContext}`.toLowerCase();
    // Verifica que a METODOLOGIA SPIN não está ATIVA (marcadores de bloco ativo)
    expect(lower).not.toContain("metodologia spin selling");
    expect(lower).not.toContain("estrategias ativas:");
    expect(lower).not.toContain("escassez");
    expect(lower).not.toContain("urgencia");
    expect(lower).not.toContain("consegui um encaixe");
    expect(lower).not.toContain("agenda disputada");
  });

  it("PACIENTE cadastrado: nunca recebe a pergunta plano/particular nem TRIAGEM PENDENTE", async () => {
    (getCachedSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      clinicName: "Clinica Teste", aiName: "Ana", professionalName: "Dr. João",
      workingHoursStart: "08:00", workingHoursEnd: "18:00",
      acceptsInsurance: true, insurancePlans: "Unimed, Bradesco",
      chargesConsultation: true, consultationFee: 150,
      paymentMethods: "Cartão, PIX", utcOffsetHours: -3, activeDays: "1,2,3,4,5",
    });
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 1, name: "Dr. João", active: true, specialty: null, cro: null,
      instagramUrl: null, chargesConsultation: true, consultationFee: 150,
      acceptsInsurance: true, insurancePlans: "Unimed, Bradesco", insuranceDays: null,
      defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    }]);
    const PATIENT_CTX: ConversationContext = { ...CONTEXT, contactType: "patient", patientId: 42 };
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, PATIENT_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    const all = `${identityPrompt}\n${dynamicContext}`;
    expect(all).not.toContain("TRIAGEM PLANO/PARTICULAR PENDENTE");
    expect(all).not.toContain("plano ou e particular");
  });

  it("CLINICA NAO ACEITA convenio: lead novo nunca recebe TRIAGEM PENDENTE", async () => {
    (db.query.dentalLeadsTable.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99, tenantId: 1, name: "Maria", interest: "limpeza", source: "instagram",
      status: "new", temperature: "warm", lastContactAt: null,
      paymentType: null, professionalId: null,
    });
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX, "greeting", "", "", "neutral", true, 0, false, true,
    );
    const all = `${identityPrompt}\n${dynamicContext}`;
    expect(all).not.toContain("TRIAGEM PLANO/PARTICULAR PENDENTE");
    expect(all).not.toContain("plano ou e particular");
    // E SPIN volta a aparecer normalmente
    expect(dynamicContext).toContain("METODOLOGIA SPIN SELLING");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. displayClinicName — prefixo "Clínica" automático sem duplicação
// ─────────────────────────────────────────────────────────────────────────────
//
// Problema: a IA se apresentava como "da Sorrizin" quando o campo clinicName
// continha só o nome simples sem o prefixo "Clínica".
// Fix: prompt-builder cria displayClinicName que antepõe "Clínica " quando o
// clinicName não começa com "Clínica" ou "Clinica" (qualquer capitalização).
// Anti-regressão: impede troca de ${displayClinicName} por ${clinicName} no
// bloco de PRIMEIRO CONTATO.

import * as fs from "fs";
import * as path from "path";

const PROMPT_BUILDER_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../lib/prompt-builder.ts"),
  "utf-8",
);

describe("Invariante #9 — displayClinicName: prefixo 'Clínica' automático na apresentação", () => {
  function mockClinic(name: string, insurance = false) {
    (getCachedSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      clinicName: name, aiName: "Ana", professionalName: "Dr. João",
      workingHoursStart: "08:00", workingHoursEnd: "18:00",
      acceptsInsurance: insurance, chargesConsultation: true, consultationFee: 150,
      paymentMethods: "Cartão, PIX", utcOffsetHours: -3, activeDays: "1,2,3,4,5",
    });
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      id: 1, name: "Dr. João", active: true, specialty: null, cro: null,
      instagramUrl: null, chargesConsultation: true, consultationFee: 150,
      acceptsInsurance: insurance, insurancePlans: null, insuranceDays: null,
      defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    }]);
  }

  it("nome simples 'Sorrizin' → prompt contém 'Clínica Sorrizin' no PRIMEIRO CONTATO", async () => {
    mockClinic("Sorrizin");
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(identityPrompt).toContain("Clínica Sorrizin");
  });

  it("nome simples 'Sorrizin' → prompt NÃO contém '\"Sorrizin\"' como nome isolado na regra de PRIMEIRO CONTATO", async () => {
    mockClinic("Sorrizin");
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", true, 0, false, true,
    );
    // O nome no NOME DA CLINICA deve ser "Clínica Sorrizin", nunca "Sorrizin" nu
    expect(identityPrompt).not.toMatch(/NOME DA CLINICA: "Sorrizin"/);
  });

  it("nome já com acento 'Clínica Sorriso Perfeito' → NÃO duplica ('Clínica Clínica')", async () => {
    mockClinic("Clínica Sorriso Perfeito");
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(identityPrompt).toContain("Clínica Sorriso Perfeito");
    expect(identityPrompt).not.toContain("Clínica Clínica");
  });

  it("nome sem acento 'Clinica Teste' → NÃO duplica ('Clínica Clinica')", async () => {
    mockClinic("Clinica Teste");
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(identityPrompt).not.toContain("Clínica Clinica");
  });

  it("fluxo convenio: 'Sorrizin' → displayClinicName aparece corretamente na regra de plano/particular", async () => {
    mockClinic("Sorrizin", true /* acceptsInsurance */);
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(identityPrompt).toContain("Clínica Sorrizin");
    expect(identityPrompt).not.toContain("Clínica Clínica");
  });

  it("source de prompt-builder.ts declara a variável displayClinicName", () => {
    expect(PROMPT_BUILDER_SOURCE).toContain("displayClinicName");
  });

  it("source: bloco NOME DA CLINICA usa displayClinicName, não clinicName bruto", () => {
    // Garante que o template usa a variável com prefixo, não o clinicName raw
    expect(PROMPT_BUILDER_SOURCE).toMatch(/NOME DA CLINICA.*\$\{displayClinicName\}/s);
  });

  it("source: formato de apresentação 'da ${displayClinicName}' presente no template", () => {
    expect(PROMPT_BUILDER_SOURCE).toContain("da ${displayClinicName}");
  });
});

describe("Invariante #8 — Tutor IA: pacotes de recarga refletem CREDIT_PACKAGES (sem alucinação de preços)", () => {
  it("o prompt base do Tutor IA lista cada pacote oficial com nome, preço e descrição (interpolação real)", async () => {
    const { getSystemPromptBase, clearTutorKnowledgeCache } = await import("../lib/tutor-knowledge");
    const { CREDIT_PACKAGES } = await import("../lib/abacatepay");
    clearTutorKnowledgeCache();
    const prompt = getSystemPromptBase();

    // O placeholder precisa ter sido substituído (nada de literais quebrados).
    expect(prompt).not.toContain("{{CREDIT_PACKAGES}}");

    // Cada pacote oficial aparece com nome + preço.
    for (const pkg of CREDIT_PACKAGES) {
      expect(prompt).toContain(pkg.name);
      expect(pkg.priceLabel).toMatch(/R\$/);
      expect(pkg.description).toBeTruthy();
      expect(pkg.chars).toBeGreaterThan(0);
    }

    // E nada de preços antigos errados que o code review pegou.
    expect(prompt).not.toMatch(/R\$\s*99,90/);
    expect(prompt).not.toMatch(/R\$\s*199,90/);
  });

  it("INSTRUÇÕES DE COMPORTAMENTO menciona explicitamente os três escopos (primeiros passos, pagamento, técnico)", async () => {
    const { getSystemPromptBase, clearTutorKnowledgeCache } = await import("../lib/tutor-knowledge");
    clearTutorKnowledgeCache();
    const prompt = getSystemPromptBase();
    expect(prompt).toMatch(/PRIMEIROS PASSOS/);
    expect(prompt).toMatch(/PAGAMENTO E ASSINATURA/);
    expect(prompt).toMatch(/DÚVIDAS TÉCNICAS GERAIS/);
    expect(prompt).toMatch(/nunca invente preços/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Filtro de profissionais por convenio (Task #25)
// ─────────────────────────────────────────────────────────────────────────────
//
// Bug reportado: quando ha multiplos profissionais, o prompt listava TODOS os
// profissionais ativos, sem filtrar pelos que realmente atendem convenio.
// Quando a IA esta em modo convenio (apos o paciente confirmar plano), ela
// so pode oferecer profissionais com acceptsInsurance === true.
//
// Anti-regressao: a listagem PROFISSIONAIS DA CLINICA, em modo convenio, NUNCA
// pode incluir um profissional que nao atende convenio.
describe("Invariante #10 — Filtro de profissionais por convenio (Task #25)", () => {
  const SETTINGS_INSURANCE = {
    clinicName: "Clinica Teste", aiName: "Ana", professionalName: "Dr. João",
    workingHoursStart: "08:00", workingHoursEnd: "18:00",
    acceptsInsurance: true, insurancePlans: "Unimed, Bradesco",
    chargesConsultation: true, consultationFee: 150,
    paymentMethods: "Cartão, PIX", utcOffsetHours: -3, activeDays: "1,2,3,4,5",
  };
  const PROF_CONVENIO = {
    id: 1, name: "Dr. Convenio", active: true, specialty: "Clinico Geral",
    cro: null, instagramUrl: null, chargesConsultation: true, consultationFee: 150,
    acceptsInsurance: true, insurancePlans: "Unimed, Bradesco", insuranceDays: null,
    defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
  };
  const PROF_PARTICULAR = {
    id: 2, name: "Dr. Particular", active: true, specialty: "Estetica",
    cro: null, instagramUrl: null, chargesConsultation: true, consultationFee: 250,
    acceptsInsurance: false, insurancePlans: null, insuranceDays: null,
    defaultLeadDurationMinutes: 45, defaultPatientDurationMinutes: 45,
  };
  const LEAD_CTX_INSURANCE: ConversationContext = { ...CONTEXT, contactType: "lead", leadId: 99 };

  function setupMocks(opts: {
    professionals: unknown[];
    insuranceConfirmed: boolean;
  }) {
    (getCachedSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SETTINGS_INSURANCE);
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValueOnce(opts.professionals);
    (db.query.dentalLeadsTable.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 99, tenantId: 1, name: "Maria", interest: "limpeza", source: "instagram",
      status: "new", temperature: "warm", lastContactAt: null,
      paymentType: opts.insuranceConfirmed ? "plano" : null, professionalId: null,
    });
    (resolveInsuranceMode as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      opts.insuranceConfirmed
        ? { isInsurance: true, isPrivate: false, triageComplete: true, triageNeeded: false }
        : { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: true },
    );
  }

  it("Modo CONVENIO (1 prof aceita conv + 1 nao): listagem inclui apenas Dr. Convenio (single-prof format)", async () => {
    setupMocks({ professionals: [PROF_CONVENIO, PROF_PARTICULAR], insuranceConfirmed: true });
    const { dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX_INSURANCE, "scheduling", "", "tenho unimed", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("Dr. Convenio");
    expect(dynamicContext).not.toContain("Dr. Particular");
    // Apos filtrar, so resta 1 prof → cai na linha "Profissional: ..."
    expect(dynamicContext).toMatch(/Profissional: Dr\. Convenio/);
  });

  it("Modo CONVENIO multi-prof (2 conv + 1 particular): listagem mostra contagem FILTRADA e omite o particular", async () => {
    const PROF_CONVENIO_B = { ...PROF_CONVENIO, id: 3, name: "Dr. Convenio B", insurancePlans: "Bradesco" };
    setupMocks({
      professionals: [PROF_CONVENIO, PROF_CONVENIO_B, PROF_PARTICULAR],
      insuranceConfirmed: true,
    });
    const { dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX_INSURANCE, "scheduling", "Seg 09:00 | Ter 14:00", "tenho unimed",
      "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("Dr. Convenio");
    expect(dynamicContext).toContain("Dr. Convenio B");
    expect(dynamicContext).not.toContain("Dr. Particular");
    expect(dynamicContext).toMatch(/PROFISSIONAIS DA CLINICA \(2 profissionais que atendem convenio\)/);
  });

  it("Modo PARTICULAR (triagem nao concluida): listagem inclui TODOS os profissionais com label 'ativos'", async () => {
    setupMocks({ professionals: [PROF_CONVENIO, PROF_PARTICULAR], insuranceConfirmed: false });
    const { dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX_INSURANCE, "greeting", "", "", "neutral", true, 0, false, true,
    );
    expect(dynamicContext).toContain("Dr. Convenio");
    expect(dynamicContext).toContain("Dr. Particular");
    expect(dynamicContext).toMatch(/PROFISSIONAIS DA CLINICA \(2 profissionais ativos\)/);
  });

  it("Modo CONVENIO com so 1 prof que aceita conv: regra de agendamento usa SINGLE-PROFESSIONAL (nao multi)", async () => {
    setupMocks({ professionals: [PROF_CONVENIO, PROF_PARTICULAR], insuranceConfirmed: true });
    const { dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX_INSURANCE, "scheduling", "Seg 09:00 | Ter 14:00", "tenho unimed",
      "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("AGENDA — CONVENIO (REGRA ABSOLUTA)");
    expect(dynamicContext).not.toContain("AGENDA — CONVENIO MULTI-PROFISSIONAL");
  });

  it("Modo CONVENIO com 2 profs que aceitam conv: regra MULTI exige opcoes filtradas (somente os que atendem convenio)", async () => {
    const PROF_CONVENIO_B = { ...PROF_CONVENIO, id: 3, name: "Dr. Convenio B", insurancePlans: "Bradesco" };
    setupMocks({
      professionals: [PROF_CONVENIO, PROF_CONVENIO_B, PROF_PARTICULAR],
      insuranceConfirmed: true,
    });
    const { dynamicContext } = await buildSplitPrompt(
      1, LEAD_CTX_INSURANCE, "scheduling", "Seg 09:00 | Ter 14:00", "tenho unimed",
      "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("AGENDA — CONVENIO MULTI-PROFISSIONAL");
    expect(dynamicContext).toContain("APENAS as opcoes listadas em PROFISSIONAIS DA CLINICA");
    expect(dynamicContext).toContain("somente profissionais que atendem convenio");
    expect(dynamicContext).not.toContain("Dr. Particular");
  });
});


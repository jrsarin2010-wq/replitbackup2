/**
 * Seed mínimo de versões legais ativas (kind="tos" e kind="subscription").
 *
 * Por que existe: o `tos-gate.ts` permite passagem quando NÃO há versões
 * ativas (`if (activeIds.length === 0) return next()`), MAS assim que
 * existir uma versão ativa o tenant é bloqueado até aceitar — então
 * subir produção sem nenhuma versão seedada é incoerente: ou a barreira
 * legal não existe, ou ela existe e os tenants já podem aceitar.
 *
 * Este script é IDEMPOTENTE: se já houver uma versão ativa daquele kind,
 * não faz nada. Pode ser executado quantas vezes quiser, em qualquer
 * ambiente (Replit, Railway), sem efeito colateral.
 *
 * O conteúdo abaixo é uma minuta funcional v1.0 — basta editar o campo
 * `content` aqui (ou substituir via UPDATE) quando o time jurídico
 * fornecer o texto definitivo. O `version_label` deve ser bumped (v1.1,
 * v2.0, etc.) e a versão antiga marcada `active=false` quando isso ocorrer
 * — o gate força reaceite automaticamente.
 *
 * Uso: pnpm --filter @workspace/api-server exec tsx scripts/seed-tos-versions.ts
 */

import { db } from "@workspace/db";
import { tosVersionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

interface SeedSpec {
  kind: "tos" | "subscription";
  version: string;
  title: string;
  content: string;
}

const SEEDS: SeedSpec[] = [
  {
    kind: "tos",
    version: "v1.0",
    title: "Termo de Uso da Secretária IA",
    content: [
      "MINUTA v1.0 — substituir pelo texto definitivo do jurídico antes de produção.",
      "",
      "1. Objeto. A OdontoFlow disponibiliza ao Contratante uma plataforma de",
      "   atendimento automatizado por inteligência artificial para uso interno",
      "   de clínicas odontológicas no Brasil.",
      "",
      "2. Aceite. O uso da plataforma implica aceitação destes termos. O aceite",
      "   é registrado eletronicamente com data, hora, IP e user-agent, conforme",
      "   art. 10, §2º da MP 2.200-2/2001.",
      "",
      "3. Responsabilidades do Contratante. Cabe ao Contratante manter dados",
      "   cadastrais corretos, controlar o acesso de seus colaboradores à",
      "   plataforma e respeitar a LGPD ao tratar dados de pacientes.",
      "",
      "4. Responsabilidades da Contratada. Cabe à OdontoFlow manter a plataforma",
      "   disponível conforme SLA, aplicar medidas razoáveis de segurança e",
      "   suspender funcionalidades sob risco mediante aviso prévio.",
      "",
      "5. Suporte. Atendimento via canais oficiais em horário comercial. Tempo",
      "   de resposta-alvo de 1 dia útil para incidentes não-críticos.",
      "",
      "6. Vedações. É proibido usar a plataforma para enviar conteúdo ilícito,",
      "   violar direitos de terceiros, contornar limites técnicos ou conduzir",
      "   engenharia reversa do produto.",
      "",
      "7. Suspensão. A OdontoFlow pode suspender o acesso em caso de violação",
      "   destes termos, com aviso prévio quando possível.",
      "",
      "8. Vigência. Este termo vigora enquanto durar a relação contratual entre",
      "   as partes e pode ser atualizado a qualquer tempo, com novo aceite",
      "   exigido a partir da publicação.",
      "",
      "9. Foro. Fica eleito o foro da comarca da sede da Contratada.",
    ].join("\n"),
  },
  {
    kind: "subscription",
    version: "v1.0",
    title: "Contrato de Assinatura e Condições Comerciais",
    content: [
      "MINUTA v1.0 — substituir pelo texto definitivo do jurídico antes de produção.",
      "",
      "1. Objeto. Contratação de licença de uso da plataforma OdontoFlow na",
      "   modalidade SaaS, com cobrança recorrente mensal.",
      "",
      "2. Plano e preço. O plano contratado e o valor mensal vigente estão",
      "   refletidos no painel de assinaturas do Contratante e podem ser",
      "   ajustados pela Contratada com aviso prévio de 30 (trinta) dias.",
      "",
      "3. Forma de pagamento. Cobrança via Pix, cartão recorrente ou boleto,",
      "   conforme método selecionado pelo Contratante na contratação.",
      "",
      "4. Inadimplência. O atraso superior a 10 (dez) dias autoriza a suspensão",
      "   parcial das funcionalidades, mantida a leitura do histórico. Atraso",
      "   superior a 30 (trinta) dias autoriza o cancelamento.",
      "",
      "5. Cancelamento. O Contratante pode cancelar a assinatura a qualquer",
      "   tempo pelo painel; o cancelamento produz efeitos no fim do ciclo",
      "   vigente sem reembolso proporcional.",
      "",
      "6. Reembolso. Não há reembolso sobre ciclos já utilizados, exceto em",
      "   caso de indisponibilidade contínua da plataforma superior a 5 (cinco)",
      "   dias úteis dentro de um mesmo ciclo.",
      "",
      "7. SLA. A Contratada empenha esforços para manter disponibilidade mensal",
      "   de 99,5%, excluídas janelas programadas de manutenção comunicadas com",
      "   antecedência mínima de 24 horas.",
      "",
      "8. Confidencialidade. Cada parte preserva o sigilo das informações",
      "   técnicas, comerciais e de pacientes a que tiver acesso, durante a",
      "   vigência e por 5 (cinco) anos após o término.",
      "",
      "9. LGPD. As partes atuam, respectivamente, como Controlador (Contratante)",
      "   e Operador (Contratada) dos dados pessoais de pacientes tratados na",
      "   plataforma, conforme art. 5º da Lei 13.709/2018.",
      "",
      "10. Foro. Fica eleito o foro da comarca da sede da Contratada.",
    ].join("\n"),
  },
];

async function main() {
  let inserted = 0;
  let skipped = 0;

  for (const spec of SEEDS) {
    const existingActive = await db
      .select({ id: tosVersionsTable.id, version: tosVersionsTable.version })
      .from(tosVersionsTable)
      .where(and(eq(tosVersionsTable.kind, spec.kind), eq(tosVersionsTable.active, true)))
      .limit(1);
    if (existingActive.length > 0) {
      console.log(
        `[skip] já existe versão ativa para kind="${spec.kind}" (id=${existingActive[0].id}, version=${existingActive[0].version})`,
      );
      skipped += 1;
      continue;
    }

    // Não há ativa ainda. Inserir essa minuta. Se já existir uma row idêntica
    // por (kind, version) — aborta inserir nova mas deixa a antiga inativa.
    const sameVersion = await db
      .select({ id: tosVersionsTable.id, active: tosVersionsTable.active })
      .from(tosVersionsTable)
      .where(and(eq(tosVersionsTable.kind, spec.kind), eq(tosVersionsTable.version, spec.version)))
      .limit(1);

    if (sameVersion.length > 0) {
      // Reativar a versão existente em vez de criar duplicata.
      await db
        .update(tosVersionsTable)
        .set({ active: true })
        .where(eq(tosVersionsTable.id, sameVersion[0].id));
      console.log(
        `[reactivate] kind="${spec.kind}" version=${spec.version} (id=${sameVersion[0].id}) marcada active=true`,
      );
      inserted += 1;
      continue;
    }

    const [row] = await db
      .insert(tosVersionsTable)
      .values({
        kind: spec.kind,
        version: spec.version,
        title: spec.title,
        content: spec.content,
        active: true,
      })
      .returning({ id: tosVersionsTable.id });
    console.log(`[insert] kind="${spec.kind}" version=${spec.version} (id=${row.id}) — ativa`);
    inserted += 1;
  }

  console.log(`\nResumo: ${inserted} inserida(s)/reativada(s), ${skipped} pulada(s).`);
  await db.$client.end();
}

main().catch(async (err) => {
  console.error("ERRO no seed-tos-versions:", err);
  try { await db.$client.end(); } catch { /* noop */ }
  process.exit(1);
});

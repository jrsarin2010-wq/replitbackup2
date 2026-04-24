import { Router } from "express";
import { tenantMiddleware } from "../../middlewares/tenant";
import { db } from "@workspace/db";
import { dentalSettingsTable, dentalProfessionalsTable, dentalProceduresTable, tenantsTable, tutorFeedbackTable, tutorChatSessionsTable, dentalLeadsTable, appointmentsTable, patientsTable } from "@workspace/db";
import { eq, sql, and, gte, count } from "drizzle-orm";
import { openai as defaultOpenai, OpenAI } from "@workspace/integrations-openai-ai-server";
import { logger } from "../../lib/logger";
import { decryptIfNeeded, hasEncryptionKey } from "../../lib/encryption";
import { getCachedSettings } from "../../lib/cache";
import { getAudioCreditStatus } from "../../lib/credit-manager";
import { getSystemPromptBase } from "../../lib/tutor-knowledge";
import { buildOwnerTitleContextLine, type OwnerGender } from "../../lib/owner-title";

const router = Router();
router.use(tenantMiddleware);


function planLabelFor(plan?: string | null): string {
  if (plan === "basic") return "Básico";
  if (plan === "essencial") return "Essencial";
  if (plan === "pro") return "Pro";
  if (plan === "trial") return "Trial";
  if (plan === "premium") return "Premium";
  return plan || "—";
}

function formatDateBR(d?: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function buildSystemPrompt(context: {
  clinicName?: string;
  ownerName?: string | null;
  ownerGender?: OwnerGender;
  whatsappConnected?: boolean;
  professionalCount?: number;
  procedureCount?: number;
  telegramConfigured?: boolean;
  activeLeadsCount?: number;
  recentAppointmentsCount?: number;
  recoveryQueueSize?: number;
  recoveryEnabled?: boolean;
  professionalsWithIncompleteSchedule?: number;
  audioMode?: string;
  plan?: string | null;
  subscriptionStatus?: string | null;
  subscribedAt?: Date | string | null;
  subscriptionExpiresAt?: Date | string | null;
  maxProfessionals?: number;
  audioMonthlyCharsUsed?: number;
  audioMonthlyQuota?: number;
  audioMonthlyCharsRemaining?: number;
  audioRechargeBalance?: number;
}): string {
  const ctxLines: string[] = [];

  if (context.clinicName) ctxLines.push(`• Nome da clínica: ${context.clinicName}`);

  const ownerLine = buildOwnerTitleContextLine(context.ownerName, context.ownerGender);
  if (ownerLine) ctxLines.push(ownerLine);

  // Pagamento / assinatura
  ctxLines.push(`• Plano atual: ${planLabelFor(context.plan)}${context.subscriptionStatus === "cancelled" ? " (⚠️ CANCELADO — ativo até o vencimento)" : context.subscriptionStatus === "active" ? " (ativo)" : ""}`);
  if (context.subscribedAt) ctxLines.push(`• Contratado em: ${formatDateBR(context.subscribedAt)}`);
  if (context.subscriptionExpiresAt) ctxLines.push(`• Próximo vencimento: ${formatDateBR(context.subscriptionExpiresAt)}`);

  // Profissionais (titular + extras pagos)
  const max = context.maxProfessionals ?? 1;
  const extras = Math.max(0, max - 1);
  ctxLines.push(`• Slots de profissional contratados: ${max} (${extras} extra${extras === 1 ? "" : "s"} pago${extras === 1 ? "" : "s"} a R$ 97/mês cada, além do titular)`);
  ctxLines.push(`• Profissionais cadastrados: ${context.professionalCount ?? 0}${(context.professionalCount ?? 0) === 0 ? " — nenhum ainda, o titular precisa ser cadastrado" : ""}`);

  // Áudio (créditos)
  if (context.audioMonthlyQuota !== undefined) {
    const used = context.audioMonthlyCharsUsed ?? 0;
    const remaining = context.audioMonthlyCharsRemaining ?? Math.max(0, (context.audioMonthlyQuota ?? 0) - used);
    const usedMin = Math.round(used / 1000);
    const totalMin = Math.round((context.audioMonthlyQuota ?? 0) / 1000);
    const remainingMin = Math.round(remaining / 1000);
    ctxLines.push(`• Áudio IA — cota mensal: ${usedMin}/${totalMin} min usados (${remainingMin} min restantes)`);
  }
  if (context.audioRechargeBalance !== undefined && context.audioRechargeBalance > 0) {
    ctxLines.push(`• Áudio IA — créditos de recarga: +${Math.round(context.audioRechargeBalance / 1000)} min extras disponíveis`);
  }
  if (context.audioMode && context.audioMode !== "off") {
    ctxLines.push(`• Áudio IA — modo ativo: ${context.audioMode}`);
  }

  // Operacionais
  ctxLines.push(`• WhatsApp: ${context.whatsappConnected ? "✅ conectado" : "❌ não conectado — configure antes de testar a IA"}`);
  ctxLines.push(`• Procedimentos cadastrados: ${context.procedureCount ?? 0}${(context.procedureCount ?? 0) === 0 ? " — sem procedimentos a IA não consegue agendar" : ""}`);
  ctxLines.push(`• Telegram: ${context.telegramConfigured ? "✅ configurado" : "❌ não configurado — o dentista não receberá alertas"}`);

  if (context.activeLeadsCount !== undefined) {
    ctxLines.push(`• Leads ativos: ${context.activeLeadsCount}`);
  }
  if (context.recentAppointmentsCount !== undefined) {
    ctxLines.push(`• Agendamentos nos últimos 7 dias: ${context.recentAppointmentsCount}`);
  }
  if (context.recoveryQueueSize !== undefined) {
    const recovStatus = context.recoveryEnabled ? "✅ ativo" : "⚠️ módulo pausado";
    ctxLines.push(`• Fila de recuperação: ${context.recoveryQueueSize} candidatos — módulo ${recovStatus}`);
  }
  if (context.professionalsWithIncompleteSchedule !== undefined && context.professionalsWithIncompleteSchedule > 0) {
    ctxLines.push(`• Profissionais com agenda incompleta (sem horários configurados): ${context.professionalsWithIncompleteSchedule} — ⚠️ a IA não consegue agendar consultas com eles. Configure em Configurações → Profissionais.`);
  }

  return getSystemPromptBase() + `\n\n═══════════════════════════════════════════\nCONTEXTO DA CLÍNICA ATUAL\n═══════════════════════════════════════════\n${ctxLines.join("\n")}\n\nUse esse contexto para personalizar TODAS as respostas. Em especial:\n• Perguntas de pagamento/assinatura: cite o plano atual, o vencimento exato e o saldo de áudio dele — não responda de forma genérica.\n• Perguntas técnicas: aponte direto pra configuração específica (com menu/aba exatos) e mencione gargalos reais que vê no contexto.\n• Perguntas de primeiros passos: comece pelo próximo passo pendente que aparece como ❌ ou ⚠️ no contexto.`;
}

router.get("/proactive", async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [settings, tenant, professionals, procedures, activeLeadsResult, recentAppointmentsResult, recoveryCountResult] = await Promise.all([
      getCachedSettings(req.tenantId),
      db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) }),
      db.query.dentalProfessionalsTable.findMany({ where: eq(dentalProfessionalsTable.tenantId, req.tenantId) }),
      db.query.dentalProceduresTable.findMany({ where: eq(dentalProceduresTable.tenantId, req.tenantId) }),
      db.select({ count: count() }).from(dentalLeadsTable).where(
        and(eq(dentalLeadsTable.tenantId, req.tenantId), eq(dentalLeadsTable.status, "active"))
      ),
      db.select({ count: count() }).from(appointmentsTable).where(
        and(eq(appointmentsTable.tenantId, req.tenantId), gte(appointmentsTable.startsAt, sevenDaysAgo))
      ),
      db.execute<{ cnt: string }>(sql`
        SELECT (
          SELECT COUNT(*) FROM patients
          WHERE tenant_id = ${req.tenantId}
            AND (last_visit IS NULL OR last_visit < NOW() - INTERVAL '60 days')
        ) + (
          SELECT COUNT(DISTINCT dl.id) FROM dental_leads dl
          INNER JOIN appointments a ON a.lead_id = dl.id
          WHERE dl.tenant_id = ${req.tenantId}
            AND dl.status = 'active'
            AND a.status = 'no_show'
            AND a.starts_at < NOW() - INTERVAL '14 days'
        ) AS cnt
      `),
    ]);

    const tenantRecord = tenant as Record<string, unknown> | undefined;
    const whatsappConnected = tenantRecord?.whatsappConnected === "true";
    const hasProcedures = procedures.length > 0;
    const hasTelegram = !!(settings?.telegramBotToken && settings?.telegramChatId);
    const hasProfessionals = professionals.length > 0;
    const settingsRecord = settings as (typeof settings & { recoveryEnabled?: boolean }) | undefined;
    const recoveryEnabled = settingsRecord?.recoveryEnabled ?? false;
    const activeLeadsCount = Number(activeLeadsResult[0]?.count ?? 0);
    const recentAppointmentsCount = Number(recentAppointmentsResult[0]?.count ?? 0);
    const recoveryQueueSize = Number((recoveryCountResult.rows[0] as { cnt: string } | undefined)?.cnt ?? 0);

    const professionalsWithIncompleteSchedule = professionals.filter(p =>
      !p.workingDays || p.workingDays.trim() === "" ||
      !p.workingHoursStart || p.workingHoursStart.trim() === "" ||
      !p.workingHoursEnd || p.workingHoursEnd.trim() === ""
    ).length;

    const insights: Array<{ priority: number; text: string }> = [];

    if (!whatsappConnected) {
      insights.push({ priority: 1, text: "⚠️ Seu WhatsApp ainda não está conectado — sem isso a IA não atende pacientes automaticamente. Posso te guiar para conectar agora. É só me perguntar \"Como conectar o WhatsApp?\"" });
    }

    if (!hasProcedures) {
      insights.push({ priority: 1, text: "📋 Você não tem procedimentos cadastrados. Sem eles a IA não consegue oferecer agendamentos nem informar preços. Acesse Configurações → Procedimentos → \"+ Novo Procedimento\"." });
    }

    if (recoveryQueueSize > 0 && !recoveryEnabled) {
      insights.push({ priority: 2, text: `🔄 Você tem ${recoveryQueueSize} paciente${recoveryQueueSize > 1 ? "s" : ""} na fila de recuperação, mas o módulo está pausado — eles não estão recebendo mensagens. Ative em Configurações → Automação → "Recuperação ativa".` });
    }

    if (recoveryQueueSize > 10 && recoveryEnabled) {
      insights.push({ priority: 2, text: `📊 Sua fila de recuperação tem ${recoveryQueueSize} pacientes esperando reativação — boa oportunidade de gerar novos agendamentos. Veja em Menu → Recuperação.` });
    }

    if (professionalsWithIncompleteSchedule > 0 && insights.length < 3) {
      insights.push({ priority: 2, text: `📅 ${professionalsWithIncompleteSchedule} profissional${professionalsWithIncompleteSchedule > 1 ? "is com agenda incompleta" : " com agenda incompleta"} — sem horários configurados a IA não consegue agendar consultas com ele${professionalsWithIncompleteSchedule > 1 ? "s" : ""}. Acesse Configurações → Profissionais e configure os dias e horários de atendimento.` });
    }

    if (!hasTelegram && insights.length < 3) {
      insights.push({ priority: 3, text: "📱 Configure o Telegram para receber alertas quando um paciente precisar de atendimento humano. Acesse Configurações → Telegram." });
    }

    if (!hasProfessionals && insights.length < 3) {
      insights.push({ priority: 3, text: "👨‍⚕️ Você ainda não tem profissionais cadastrados. Adicione-os em Configurações → Profissionais para que a IA possa rotear pacientes corretamente." });
    }

    if (activeLeadsCount > 0 && recentAppointmentsCount === 0 && insights.length < 3) {
      insights.push({ priority: 2, text: `📉 Você tem ${activeLeadsCount} lead${activeLeadsCount > 1 ? "s ativos" : " ativo"} mas nenhum agendamento nos últimos 7 dias. Considere revisar sua estratégia de remarketing em Configurações → Automação.` });
    }

    const sorted = insights.sort((a, b) => a.priority - b.priority);
    const tips = sorted.slice(0, 3).map(i => i.text);
    const allConfigured = tips.length === 0;

    if (allConfigured) {
      const statusLines: string[] = [];
      if (activeLeadsCount > 0) statusLines.push(`${activeLeadsCount} lead${activeLeadsCount > 1 ? "s ativos" : " ativo"}`);
      if (recentAppointmentsCount > 0) statusLines.push(`${recentAppointmentsCount} agendamento${recentAppointmentsCount > 1 ? "s" : ""} nos últimos 7 dias`);
      if (recoveryQueueSize > 0) statusLines.push(`${recoveryQueueSize} na fila de recuperação`);

      const statusSummary = statusLines.length > 0 ? ` Resumo rápido: ${statusLines.join(", ")}.` : "";
      tips.push(`🎉 Parabéns! Sua clínica está totalmente configurada.${statusSummary} Posso te mostrar como usar o Remarketing Automático, o Áudio IA (respostas em voz) ou os Relatórios de desempenho da clínica.`);
    }

    res.json({
      tips: tips.slice(0, 3),
      allConfigured,
      diagnostics: {
        activeLeadsCount,
        recentAppointmentsCount,
        recoveryQueueSize,
        recoveryEnabled,
        whatsappConnected,
        hasProcedures,
        professionalsWithIncompleteSchedule,
        hasTelegram,
        professionalCount: professionals.length,
      },
    });
  } catch (err) {
    logger.error({ err }, "Support chat proactive error");
    res.status(500).json({ error: "Erro ao buscar dicas proativas" });
  }
});

router.get("/history", async (req, res) => {
  try {
    const session = await db.query.tutorChatSessionsTable.findFirst({
      where: eq(tutorChatSessionsTable.tenantId, req.tenantId),
    });
    const messages = (session?.messages as Array<{ role: string; content: string }>) ?? [];
    const capped = messages.slice(-30);
    res.json({ messages: capped });
  } catch (err) {
    logger.error({ err }, "Support chat history GET error");
    res.status(500).json({ error: "Erro ao buscar histórico" });
  }
});

router.put("/history", async (req, res) => {
  try {
    const { messages } = req.body as { messages: Array<{ role: string; content: string }> };
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }
    const ALLOWED_ROLES = ["user", "assistant"];
    const valid = messages.every(
      (m) => m && typeof m.role === "string" && ALLOWED_ROLES.includes(m.role) && typeof m.content === "string"
    );
    if (!valid) {
      res.status(400).json({ error: "Each message must have role ('user'|'assistant') and content (string)" });
      return;
    }
    const capped = messages.slice(-30);
    await db
      .insert(tutorChatSessionsTable)
      .values({ tenantId: req.tenantId, messages: capped })
      .onConflictDoUpdate({
        target: tutorChatSessionsTable.tenantId,
        set: { messages: capped, updatedAt: sql`NOW()` },
      });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Support chat history PUT error");
    res.status(500).json({ error: "Erro ao salvar histórico" });
  }
});

router.delete("/history", async (req, res) => {
  try {
    await db.delete(tutorChatSessionsTable).where(eq(tutorChatSessionsTable.tenantId, req.tenantId));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Support chat history DELETE error");
    res.status(500).json({ error: "Erro ao limpar histórico" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { messages } = req.body as { messages: Array<{ role: string; content: string }> };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [settings, tenant, professionals, procedures, activeLeadsResult, recentAppointmentsResult, recoveryCountResult, audioStatus] = await Promise.all([
      getCachedSettings(req.tenantId),
      db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) }),
      db.query.dentalProfessionalsTable.findMany({ where: eq(dentalProfessionalsTable.tenantId, req.tenantId) }),
      db.query.dentalProceduresTable.findMany({ where: eq(dentalProceduresTable.tenantId, req.tenantId) }),
      db.select({ count: count() }).from(dentalLeadsTable).where(
        and(eq(dentalLeadsTable.tenantId, req.tenantId), eq(dentalLeadsTable.status, "active"))
      ),
      db.select({ count: count() }).from(appointmentsTable).where(
        and(eq(appointmentsTable.tenantId, req.tenantId), gte(appointmentsTable.startsAt, sevenDaysAgo))
      ),
      db.execute<{ cnt: string }>(sql`
        SELECT (
          SELECT COUNT(*) FROM patients
          WHERE tenant_id = ${req.tenantId}
            AND (last_visit IS NULL OR last_visit < NOW() - INTERVAL '60 days')
        ) + (
          SELECT COUNT(DISTINCT dl.id) FROM dental_leads dl
          INNER JOIN appointments a ON a.lead_id = dl.id
          WHERE dl.tenant_id = ${req.tenantId}
            AND dl.status = 'active'
            AND a.status = 'no_show'
            AND a.starts_at < NOW() - INTERVAL '14 days'
        ) AS cnt
      `),
      getAudioCreditStatus(req.tenantId).catch(() => null),
    ]);

    const tenantRecord = tenant as Record<string, unknown> | undefined;
    const systemPrompt = buildSystemPrompt({
      clinicName: settings?.clinicName || undefined,
      ownerName: settings?.professionalName ?? null,
      ownerGender: (settings as (typeof settings & { professionalGender?: string | null }) | undefined)?.professionalGender as OwnerGender,
      whatsappConnected: tenantRecord?.whatsappConnected === "true",
      professionalCount: professionals.length,
      procedureCount: procedures.length,
      telegramConfigured: !!(settings?.telegramBotToken && settings?.telegramChatId),
      activeLeadsCount: Number(activeLeadsResult[0]?.count ?? 0),
      recentAppointmentsCount: Number(recentAppointmentsResult[0]?.count ?? 0),
      recoveryQueueSize: Number((recoveryCountResult.rows[0] as { cnt: string } | undefined)?.cnt ?? 0),
      recoveryEnabled: (settings as (typeof settings & { recoveryEnabled?: boolean }) | undefined)?.recoveryEnabled ?? false,
      professionalsWithIncompleteSchedule: professionals.filter(p =>
        !p.workingDays || p.workingDays.trim() === "" ||
        !p.workingHoursStart || p.workingHoursStart.trim() === "" ||
        !p.workingHoursEnd || p.workingHoursEnd.trim() === ""
      ).length,
      audioMode: settings?.audioMode,
      plan: tenantRecord?.plan as string | undefined,
      subscriptionStatus: tenantRecord?.subscriptionStatus as string | undefined,
      subscribedAt: tenantRecord?.subscribedAt as Date | string | undefined,
      subscriptionExpiresAt: tenantRecord?.subscriptionExpiresAt as Date | string | undefined,
      maxProfessionals: tenantRecord?.maxProfessionals as number | undefined,
      audioMonthlyCharsUsed: audioStatus?.monthlyCharsUsed,
      audioMonthlyQuota: audioStatus?.monthlyQuota,
      audioMonthlyCharsRemaining: audioStatus?.monthlyCharsRemaining,
      audioRechargeBalance: audioStatus?.rechargeBalance,
    });

    let client: OpenAI;
    const rawApiKey = tenantRecord?.openaiApiKey as string | undefined;
    const decryptedApiKey = rawApiKey && hasEncryptionKey() ? decryptIfNeeded(rawApiKey) : rawApiKey;
    if (decryptedApiKey) {
      client = new OpenAI({ apiKey: decryptedApiKey });
    } else {
      client = defaultOpenai;
    }

    const completion = await client.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
      max_completion_tokens: 600,
      temperature: 0.4,
    });

    const reply = completion.choices[0]?.message?.content || "Desculpe, não consegui gerar uma resposta. Tente novamente.";

    res.json({ reply });

    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (lastUserMessage.length >= 10) {
      detectAndSaveFeedback(client, req.tenantId, lastUserMessage).catch((err) => {
        logger.warn({ err }, "Feedback detection error (non-fatal)");
      });
    }
  } catch (err) {
    logger.error({ err }, "Support chat error");
    res.status(500).json({ error: "Erro ao processar mensagem" });
  }
});

async function detectAndSaveFeedback(client: OpenAI, tenantId: number, userMessage: string): Promise<void> {
  const detection = await client.chat.completions.create({
    model: "gpt-5.4-nano",
    messages: [
      {
        role: "system",
        content: `Analise a mensagem abaixo de um dentista usando um sistema de secretária virtual. Classifique se ela contém algum desses tipos de feedback acionável:

- "sugestao": o dentista sugere uma nova funcionalidade, melhoria ou mudança no sistema
- "reclamacao": o dentista expressa insatisfação, frustração ou problema com o sistema
- "elogio": o dentista elogia o sistema, equipe ou alguma funcionalidade
- "dica": o dentista compartilha uma dica ou descoberta útil sobre o sistema

Se a mensagem for apenas uma pergunta técnica normal sem opinião ou feedback, responda com tipo "nenhum".

Responda SOMENTE com JSON no formato: {"tipo": "sugestao"|"reclamacao"|"elogio"|"dica"|"outro"|"nenhum", "conteudo": "resumo claro do feedback em uma frase"}

Use "outro" quando há feedback acionável que não se encaixa nas categorias acima.
Se tipo for "nenhum", o campo conteudo pode ser vazio.`,
      },
      { role: "user", content: userMessage },
    ],
    max_completion_tokens: 150,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const raw = detection.choices[0]?.message?.content ?? "{}";
  let parsed: { tipo?: string; conteudo?: string } = {};
  try { parsed = JSON.parse(raw); } catch { return; }

  const ALLOWED_TYPES = ["sugestao", "reclamacao", "elogio", "dica", "outro"];
  if (!parsed.tipo || parsed.tipo === "nenhum" || !parsed.conteudo) return;
  const type = ALLOWED_TYPES.includes(parsed.tipo) ? parsed.tipo : "outro";

  await db.insert(tutorFeedbackTable).values({
    tenantId,
    type,
    content: parsed.conteudo,
    originalMessage: userMessage,
    status: "nova",
  });
}

export default router;

import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { callLogsTable, dentalLeadsTable, patientsTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { logger } from "../../lib/logger";
import { triggerCall, CallTrigger } from "../../lib/call-engine";
import { listPhoneNumbers, listAssistants, resolveVapiKey } from "../../lib/vapi";
import { getCachedSettings } from "../../lib/cache";
import { z } from "zod";

const router = Router();

router.get("/", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page || "1"), 10);
    const limit = Math.min(parseInt(String(req.query.limit || "20"), 10), 100);
    const offset = (page - 1) * limit;
    const directionParam = String(req.query.direction || "");
    const direction = directionParam === "inbound" || directionParam === "outbound" ? directionParam : null;
    const whereClause = direction
      ? and(eq(callLogsTable.tenantId, req.tenantId), eq(callLogsTable.direction, direction))
      : eq(callLogsTable.tenantId, req.tenantId);

    const [logs, total] = await Promise.all([
      db
        .select({
          id: callLogsTable.id,
          vapiCallId: callLogsTable.vapiCallId,
          phone: callLogsTable.phone,
          direction: callLogsTable.direction,
          status: callLogsTable.status,
          trigger: callLogsTable.trigger,
          duration: callLogsTable.duration,
          outcome: callLogsTable.outcome,
          answeredByHuman: callLogsTable.answeredByHuman,
          endedReason: callLogsTable.endedReason,
          summary: callLogsTable.summary,
          cost: callLogsTable.cost,
          startedAt: callLogsTable.startedAt,
          endedAt: callLogsTable.endedAt,
          createdAt: callLogsTable.createdAt,
          leadId: callLogsTable.leadId,
          patientId: callLogsTable.patientId,
          leadName: dentalLeadsTable.name,
          patientName: patientsTable.name,
        })
        .from(callLogsTable)
        .leftJoin(dentalLeadsTable, eq(callLogsTable.leadId, dentalLeadsTable.id))
        .leftJoin(patientsTable, eq(callLogsTable.patientId, patientsTable.id))
        .where(whereClause)
        .orderBy(desc(callLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: count() })
        .from(callLogsTable)
        .where(whereClause),
    ]);

    res.json({
      data: logs,
      pagination: {
        page,
        limit,
        total: Number(total[0]?.count ?? 0),
        pages: Math.ceil(Number(total[0]?.count ?? 0) / limit),
      },
    });
  } catch (err) {
    logger.error({ err }, "Error listing call logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [log] = await db
      .select()
      .from(callLogsTable)
      .where(and(eq(callLogsTable.id, id), eq(callLogsTable.tenantId, req.tenantId)));

    if (!log) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    res.json(log);
  } catch (err) {
    logger.error({ err }, "Error fetching call log");
    res.status(500).json({ error: "Internal server error" });
  }
});

const ManualCallSchema = z.object({
  phone: z.string().min(8),
  trigger: z.enum(["hot_lead_followup", "appointment_confirmation", "patient_recovery"]),
  leadId: z.number().optional(),
  patientId: z.number().optional(),
  patientName: z.string().optional(),
  appointmentDate: z.string().optional(),
});

router.post("/manual", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const body = ManualCallSchema.parse(req.body);

    const result = await triggerCall({
      tenantId: req.tenantId,
      phone: body.phone,
      trigger: body.trigger as CallTrigger,
      leadId: body.leadId,
      patientId: body.patientId,
      patientName: body.patientName,
      appointmentDate: body.appointmentDate,
    });

    if (result.error === "calls_disabled") {
      res.status(400).json({ error: "Ligações não estão habilitadas nas configurações." });
      return;
    }

    if (result.error === "vapi_not_configured") {
      res.status(400).json({ error: "Configure a chave API do Vapi e o número de telefone nas configurações." });
      return;
    }

    if (result.error === "outside_call_window") {
      res.status(400).json({ error: "Fora da janela de horário para ligações." });
      return;
    }

    if (result.error === "daily_limit_reached") {
      res.status(429).json({ error: "Limite diário de ligações atingido." });
      return;
    }

    if (result.error === "recently_called") {
      res.status(409).json({ error: "Este contato já foi chamado recentemente." });
      return;
    }

    if (!result.callId) {
      res.status(500).json({ error: "Falha ao iniciar chamada." });
      return;
    }

    res.json({ callId: result.callId, message: "Chamada iniciada com sucesso." });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    logger.error({ err }, "Error initiating manual call");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/vapi/phone-numbers", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await getCachedSettings(req.tenantId);
    const vapiKey = resolveVapiKey(settings?.vapiApiKey);

    if (!vapiKey) {
      res.status(400).json({ error: "Chave Vapi não configurada." });
      return;
    }

    const numbers = await listPhoneNumbers(vapiKey);
    res.json(numbers);
  } catch (err) {
    logger.error({ err }, "Error listing Vapi phone numbers");
    res.status(500).json({ error: "Erro ao buscar números Vapi." });
  }
});

router.get("/vapi/inbound-config", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await getCachedSettings(req.tenantId);
    let base: string;
    if (process.env.WEBHOOK_BASE_URL) {
      base = process.env.WEBHOOK_BASE_URL.replace(/\/$/, "");
    } else if (process.env.REPLIT_DEPLOYMENT_URL) {
      base = process.env.REPLIT_DEPLOYMENT_URL.replace(/\/$/, "");
    } else if (process.env.REPLIT_DOMAINS) {
      base = `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`;
    } else {
      base = `${req.protocol}://${req.get("host")}`;
    }
    const webhookUrl = `${base}/api/dental/webhook/vapi`;
    res.json({
      webhookUrl,
      vapiInboundPhoneNumberId: settings?.vapiInboundPhoneNumberId || null,
      vapiInboundAssistantId: settings?.vapiInboundAssistantId || null,
      callVoiceId: settings?.callVoiceId || null,
      cartesiaVoiceId: settings?.cartesiaVoiceId || null,
      inboundCallsEnabled: settings?.inboundCallsEnabled || false,
    });
  } catch (err) {
    logger.error({ err }, "Error building inbound config");
    res.status(500).json({ error: "Erro ao montar configuração inbound." });
  }
});

router.post("/vapi/inbound-test", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await getCachedSettings(req.tenantId);
    const vapiKey = resolveVapiKey(settings?.vapiApiKey);
    if (!vapiKey) {
      res.status(400).json({ ok: false, error: "Chave Vapi não configurada." });
      return;
    }
    const phoneNumberId = settings?.vapiInboundPhoneNumberId || settings?.vapiPhoneNumberId;
    if (!phoneNumberId) {
      res.status(400).json({ ok: false, error: "ID do número inbound não configurado." });
      return;
    }
    const numbers = await listPhoneNumbers(vapiKey);
    const found = numbers.find((n) => n.id === phoneNumberId);
    if (!found) {
      res.status(400).json({ ok: false, error: "Número não encontrado na sua conta Vapi. Verifique o ID." });
      return;
    }
    res.json({ ok: true, number: found.number, name: found.name });
  } catch (err) {
    logger.error({ err }, "Error testing inbound config");
    res.status(500).json({ ok: false, error: "Falha ao validar com o Vapi." });
  }
});

router.get("/vapi/assistants", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await getCachedSettings(req.tenantId);
    const vapiKey = resolveVapiKey(settings?.vapiApiKey);

    if (!vapiKey) {
      res.status(400).json({ error: "Chave Vapi não configurada." });
      return;
    }

    const assistants = await listAssistants(vapiKey);
    res.json(assistants);
  } catch (err) {
    logger.error({ err }, "Error listing Vapi assistants");
    res.status(500).json({ error: "Erro ao buscar assistentes Vapi." });
  }
});

export default router;

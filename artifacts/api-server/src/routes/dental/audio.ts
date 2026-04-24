import { Router, Request, Response } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { audioMessagesTable, tenantsTable, dentalAudioCreditsTable, dentalCreditOrdersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { TextToSpeechBody } from "@workspace/api-zod";
import { logger } from "../../lib/logger";
import axios from "axios";
import { listBrazilianVoices, generatePreview, resolveElevenLabsKey } from "../../lib/elevenlabs";
import { listCartesiaVoices, cartesiaTTS, cartesiaPreview, resolveCartesiaKey, getDefaultCartesiaVoiceId } from "../../lib/cartesia";
import { getBalance, addCredits, getTransactions, getAllTransactions, getAudioCreditStatus } from "../../lib/credit-manager";
import { adminMiddleware } from "../../middlewares/admin";
import { CREDIT_PACKAGES, createPixBilling, getPackageById } from "../../lib/abacatepay";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post("/transcribe", tenantMiddleware, upload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const { speechToText } = await import("@workspace/integrations-openai-ai-server/audio");
    const ext = (file.originalname.split(".").pop() || "webm").toLowerCase();
    const format = (["mp3", "wav", "webm"].includes(ext) ? ext : "webm") as "mp3" | "wav" | "webm";

    const transcript = await speechToText(file.buffer, format);

    const [audioMsg] = await db.insert(audioMessagesTable).values({
      tenantId: req.tenantId,
      direction: "inbound",
      mimeType: file.mimetype,
      transcript,
      transcriptionStatus: "completed",
    }).returning();

    res.json({ transcript, audioMessageId: audioMsg.id });
  } catch (err) {
    logger.error({ err }, "Transcription error");
    res.status(500).json({ error: "Transcription failed" });
  }
});

router.post("/tts", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const body = TextToSpeechBody.parse(req.body);
    const { text } = body;
    const voiceId = (req.body as Record<string, unknown>).voiceId as string | undefined;

    const { getTenantWithDecryptedKeys } = await import("../../lib/tenant-helpers");
    const { db: dbImport } = await import("@workspace/db");
    const { dentalSettingsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const tenant = await getTenantWithDecryptedKeys(req.tenantId);
    const elevenLabsKey = resolveElevenLabsKey(tenant?.elevenLabsApiKey);

    const settings = await dbImport.query.dentalSettingsTable.findFirst({
      where: eq(dentalSettingsTable.tenantId, req.tenantId),
    });

    const ttsProvider = settings?.ttsProvider || "cartesia";

    if (elevenLabsKey && ttsProvider === "elevenlabs") {
      const finalVoiceId = voiceId || settings?.elevenLabsVoiceId || "21m00Tcm4TlvDq8ikWAM";
      const elevenResponse = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`,
        { text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.8 } },
        { headers: { "xi-api-key": elevenLabsKey, "Content-Type": "application/json" }, responseType: "arraybuffer" }
      );
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(Buffer.from(elevenResponse.data as ArrayBuffer));
      return;
    }

    const cartesiaKey = resolveCartesiaKey();
    if (cartesiaKey) {
      const finalVoiceId = voiceId || settings?.cartesiaVoiceId || getDefaultCartesiaVoiceId();
      const audioBuffer = await cartesiaTTS(text, finalVoiceId, cartesiaKey);
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(audioBuffer);
      return;
    }

    const { textToSpeech } = await import("@workspace/integrations-openai-ai-server/audio");
    const audioBuffer = await textToSpeech(text, "nova");
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (err) {
    logger.error({ err }, "TTS error");
    res.status(500).json({ error: "TTS failed" });
  }
});

router.get("/voices", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const { getTenantWithDecryptedKeys: getTenant2 } = await import("../../lib/tenant-helpers");
    const tenant = await getTenant2(req.tenantId);
    const apiKey = resolveElevenLabsKey(tenant?.elevenLabsApiKey);
    if (!apiKey) {
      res.json({ voices: [], error: "Nenhuma chave ElevenLabs configurada. Entre em contato com o administrador." });
      return;
    }
    const result = await listBrazilianVoices(apiKey);
    if ("error" in result) {
      res.json({ voices: [], error: result.error });
    } else {
      res.json({ voices: result, error: null });
    }
  } catch (err) {
    logger.error({ err }, "Failed to list voices");
    res.status(500).json({ error: "Failed to list voices" });
  }
});

router.get("/voices/cartesia", tenantMiddleware, async (_req: Request, res: Response) => {
  try {
    const apiKey = resolveCartesiaKey();
    if (!apiKey) {
      res.json({ voices: [], error: "Cartesia não configurado nesta plataforma." });
      return;
    }
    const result = await listCartesiaVoices(apiKey);
    if ("error" in result) {
      res.json({ voices: [], error: result.error });
    } else {
      res.json({ voices: result, error: null, provider: "cartesia" });
    }
  } catch (err) {
    logger.error({ err }, "Failed to list Cartesia voices");
    res.status(500).json({ error: "Failed to list Cartesia voices" });
  }
});

router.post("/preview", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const { voiceId, provider, phrase } = req.body as { voiceId: string; provider?: string; phrase?: string };
    if (!voiceId) {
      res.status(400).json({ error: "voiceId is required" });
      return;
    }

    const ttsProvider = provider || "cartesia";
    const phraseKind: "short" | "long" = phrase === "long" ? "long" : "short";

    if (ttsProvider === "cartesia") {
      const cartesiaKey = resolveCartesiaKey();
      if (!cartesiaKey) {
        res.status(400).json({ error: "Cartesia não configurado." });
        return;
      }
      const audioBuffer = await cartesiaPreview(voiceId, cartesiaKey, phraseKind);
      res.json({ audioBase64: audioBuffer.toString("base64"), mimeType: "audio/mpeg" });
      return;
    }

    const { getTenantWithDecryptedKeys: getTenant3 } = await import("../../lib/tenant-helpers");
    const tenant = await getTenant3(req.tenantId);
    const apiKey = resolveElevenLabsKey(tenant?.elevenLabsApiKey);
    if (!apiKey) {
      res.status(400).json({ error: "ElevenLabs não configurado. Entre em contato com o administrador." });
      return;
    }
    const audioBuffer = await generatePreview(voiceId, apiKey, phraseKind);
    res.json({ audioBase64: audioBuffer.toString("base64"), mimeType: "audio/mpeg" });
  } catch (err) {
    logger.error({ err }, "Voice preview failed");
    res.status(500).json({ error: "Voice preview failed" });
  }
});

router.get("/credits", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const status = await getAudioCreditStatus(req.tenantId);
    res.json({
      tenantId: status.tenantId,
      balance: status.rechargeBalance,
      monthlyCharsUsed: status.monthlyCharsUsed,
      monthlyQuota: status.monthlyQuota,
      monthlyCharsRemaining: status.monthlyCharsRemaining,
      rechargeBalance: status.rechargeBalance,
      totalAvailable: status.totalAvailable,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get credits");
    res.status(500).json({ error: "Failed to get credits" });
  }
});

router.post("/credits/add", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { tenantId, amount, description } = req.body as { tenantId: number; amount: number; description: string };
    if (!tenantId || !amount || !description) {
      res.status(400).json({ error: "tenantId, amount and description are required" });
      return;
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive integer" });
      return;
    }
    const result = await addCredits(tenantId, amount, description);
    res.json({ tenantId, balance: result.newBalance });
  } catch (err) {
    logger.error({ err }, "Failed to add credits");
    res.status(500).json({ error: "Failed to add credits" });
  }
});

router.get("/credits/transactions", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const transactions = await getTransactions(req.tenantId);
    res.json(transactions);
  } catch (err) {
    logger.error({ err }, "Failed to get transactions");
    res.status(500).json({ error: "Failed to get transactions" });
  }
});

router.get("/credits/transactions/all", adminMiddleware, async (_req: Request, res: Response) => {
  try {
    const transactions = await getAllTransactions();
    res.json(transactions);
  } catch (err) {
    logger.error({ err }, "Failed to get all transactions");
    res.status(500).json({ error: "Failed to get all transactions" });
  }
});

router.get("/credits/all", adminMiddleware, async (_req: Request, res: Response) => {
  try {
    const tenants = await db.query.tenantsTable.findMany();
    const results = await Promise.all(
      tenants.map(async (t) => {
        const credit = await db.query.dentalAudioCreditsTable.findFirst({
          where: eq(dentalAudioCreditsTable.tenantId, t.id),
        });
        return {
          tenantId: t.id,
          tenantName: t.name,
          balance: credit?.balance ?? 0,
          monthlyCharsUsed: credit?.monthlyCharsUsed ?? 0,
          monthlyQuota: 27_000,
        };
      })
    );
    res.json(results);
  } catch (err) {
    logger.error({ err }, "Failed to get all credits");
    res.status(500).json({ error: "Failed to get all credits" });
  }
});

router.get("/credits/packages", tenantMiddleware, (_req: Request, res: Response) => {
  res.json(CREDIT_PACKAGES);
});

router.post("/credits/purchase", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const { packageId, taxId } = req.body as { packageId: string; taxId?: string };
    const pkg = getPackageById(packageId);
    if (!pkg) {
      res.status(400).json({ error: "Pacote inválido" });
      return;
    }

    const cleanTaxId = (taxId || "").replace(/\D/g, "");
    if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
      res.status(400).json({ error: "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido." });
      return;
    }

    const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
    if (!tenant) {
      res.status(404).json({ error: "Tenant não encontrado" });
      return;
    }

    const baseUrl = `${req.protocol}://${req.hostname}`;
    const returnUrl = `${baseUrl}/dental-ai/settings?tab=audio&purchase=success`;
    const webhookUrl = `${baseUrl}/api/dental/pixwebhook`;

    const billing = await createPixBilling({
      packageId: pkg.id,
      chars: pkg.chars,
      priceInCents: pkg.priceInCents,
      productName: `DentalAI Audio — Pacote ${pkg.name} (${pkg.chars.toLocaleString("pt-BR")} créditos)`,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantEmail: tenant.email || `tenant${tenant.id}@dentalai.app`,
      tenantTaxId: taxId ?? "",
      returnUrl,
      webhookUrl,
    });

    if ("error" in billing) {
      logger.warn({ tenantId: req.tenantId, packageId: pkg.id, billingError: billing.error }, "AbacatePay billing creation failed");
      res.status(422).json({ error: "Nao foi possivel criar a cobranca. Tente novamente." });
      return;
    }

    const [order] = await db.insert(dentalCreditOrdersTable).values({
      tenantId: req.tenantId,
      packageId: pkg.id,
      chars: pkg.chars,
      priceInCents: pkg.priceInCents,
      billingId: billing.id,
      paymentUrl: billing.url,
      status: "pending",
    }).returning();

    logger.info({ tenantId: req.tenantId, orderId: order.id, packageId: pkg.id }, "Credit purchase order created");
    res.json({ orderId: order.id, paymentUrl: billing.url, package: pkg });
  } catch (err) {
    logger.error({ err }, "Failed to create credit purchase");
    res.status(500).json({ error: "Erro ao criar cobrança" });
  }
});

export default router;

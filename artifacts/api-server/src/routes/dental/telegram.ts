import { Router } from "express";
import { db } from "@workspace/db";
import { dentalSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { validateBotToken, getTelegramUpdates, sendTelegramMessage } from "../../lib/telegram";
import { getCachedSettings } from "../../lib/cache";

const router = Router();
router.use(tenantMiddleware);

router.post("/validate-bot", async (req, res) => {
  const { botToken } = req.body;
  if (!botToken || typeof botToken !== "string") {
    res.status(400).json({ error: "Bot token is required" });
    return;
  }
  const result = await validateBotToken(botToken.trim());
  res.json({ valid: result.valid, botUsername: result.botName?.replace("@", "") });
});

router.post("/find-chat", async (req, res) => {
  const settings = await getCachedSettings(req.tenantId);

  if (!settings?.telegramBotToken) {
    res.status(400).json({ error: "Bot token not configured" });
    return;
  }

  const updates = await getTelegramUpdates(settings.telegramBotToken);
  const chats = updates
    .filter((u) => u.message?.text === "/start" || u.message?.text)
    .map((u) => ({
      chatId: String(u.message!.chat.id),
      name: u.message!.chat.first_name || "Desconhecido",
      lastMessage: u.message!.text || "",
    }));

  const uniqueChats = Array.from(
    new Map(chats.map((c) => [c.chatId, c])).values()
  );

  res.json({ chats: uniqueChats });
});

router.post("/test", async (req, res) => {
  const settings = await getCachedSettings(req.tenantId);

  if (!settings?.telegramBotToken || !settings?.telegramChatId) {
    res.status(400).json({ error: "Telegram not fully configured" });
    return;
  }

  const result = await sendTelegramMessage(
    settings.telegramBotToken,
    settings.telegramChatId,
    `✅ <b>Teste de conexao</b>\n\nSeu Telegram esta conectado ao DentalAI!\nVoce recebera alertas aqui quando a IA precisar de sua ajuda.\n\n⏰ ${new Date(Date.now() - 3 * 3600000).toLocaleString("pt-BR")}`
  );
  res.json({ success: result });
});

export default router;

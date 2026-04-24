import { Router } from "express";
import { tenantMiddleware } from "../../middlewares/tenant";
import tenantsRouter from "./tenants";
import patientsRouter from "./patients";
import proceduresRouter from "./procedures";
import appointmentsRouter from "./appointments";
import leadsRouter from "./leads";
import conversationsRouter from "./conversations";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import settingsRouter from "./settings";
import whatsappRouter from "./whatsapp";
import webhookRouter from "./webhook";
import audioRouter from "./audio";
import treatmentsRouter from "./treatments";
import activityRouter from "./activity";
import subscriptionRouter from "./subscription";
import refundsRouter from "./refunds";
import authRouter from "./auth";
import pixwebhookRouter from "./pixwebhook";
import telegramRouter from "./telegram";
import resetRouter from "./reset";
import aiLearningRouter from "./ai-learning";
import professionalsRouter from "./professionals";
import devSimulatePaymentRouter from "./dev-simulate-payment";
import blockedPeriodsRouter from "./blocked-periods";
import supportChatRouter from "./support-chat";
import lgpdRouter from "./lgpd";
import expensesRouter from "./expenses";
import waitlistRouter from "./waitlist";
import recoveryRouter from "./recovery";
import callsRouter from "./calls";
import vapiWebhookRouter from "./vapi-webhook";
import riskControlRouter from "./risk-control";
import supportRouter from "./support";
import portfolioRouter from "./portfolio";
import conversationsQuotaRouter, { handleConversationRecharge } from "./conversations-quota";
import tosRouter from "./tos";
import { auditMiddleware } from "../../middlewares/audit";
import { tosGateMiddleware } from "../../middlewares/tos-gate";

const router = Router();
router.use(auditMiddleware);
// Task #15 — bloqueia rotas de tenant até o aceite da versão ativa do TOS.
// Roda ANTES dos sub-routers e faz verificação inline do JWT para extrair o
// tenantId (sub-routers ainda rodam seu próprio tenantMiddleware depois,
// que continua sendo a fonte da verdade para autenticação). Rotas de
// webhook/auth/tos/etc. são isentas — ver EXEMPT_PREFIXES no middleware.
router.use(tosGateMiddleware);

router.use("/tenants", tenantsRouter);
router.use("/auth", authRouter);
router.use("/subscription", subscriptionRouter);
router.use("/refund", refundsRouter);
router.use("/patients", patientsRouter);
router.use("/procedures", proceduresRouter);
router.use("/appointments", appointmentsRouter);
router.use("/professionals", professionalsRouter);
router.use("/leads", leadsRouter);
router.use("/conversations", conversationsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/reports", reportsRouter);
router.use("/settings", settingsRouter);
router.use("/whatsapp", whatsappRouter);
router.use("/webhook", webhookRouter);
router.use("/audio", audioRouter);
router.use("/treatments", treatmentsRouter);
router.use("/activity", activityRouter);
router.use("/pixwebhook", pixwebhookRouter);
router.use("/telegram", telegramRouter);
router.use("/reset", resetRouter);
router.use("/ai-learning", aiLearningRouter);
router.use("/dev", devSimulatePaymentRouter);
router.use("/blocked-periods", blockedPeriodsRouter);
router.use("/support-chat", supportChatRouter);
router.use("/lgpd", lgpdRouter);
router.use("/expenses", expensesRouter);
router.use("/waitlist", waitlistRouter);
router.use("/recovery", recoveryRouter);
router.use("/calls", callsRouter);
router.use("/webhook", vapiWebhookRouter);
router.use("/risk-control", riskControlRouter);
router.use("/support", supportRouter);
router.use("/portfolio", portfolioRouter);
router.use("/conversations-quota", conversationsQuotaRouter);
router.use("/tos", tosRouter);
// Spec-aligned paths: /conversations/quota (GET), /conversations/recharge (POST), /conversations/recharge/webhook (POST)
router.use("/conversations/quota", conversationsQuotaRouter);
router.post("/conversations/recharge", tenantMiddleware, handleConversationRecharge);
router.use("/conversations/recharge/webhook", pixwebhookRouter);

export default router;

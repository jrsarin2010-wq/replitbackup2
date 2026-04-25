import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { db, pool } from "@workspace/db";
import { tenantsTable, dentalSettingsTable, dentalProfessionalsTable, passwordResetTokensTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";
import { logger } from "../../lib/logger";
import { sendPasswordResetEmail } from "../../lib/email";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not set");
}

function generateToken(tenantId: number): string {
  return jwt.sign({ tenantId }, JWT_SECRET!, { expiresIn: "30d" });
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const router = Router();

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, password, confirmPassword, clinicPhone, cro, planType } = req.body as {
      name: string; email: string; password: string; confirmPassword: string; clinicPhone?: string; cro: string; planType?: string;
    };

    if (!name || !email || !password || !confirmPassword || !cro) {
      res.status(400).json({ error: "Todos os campos são obrigatórios" });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({ error: "As senhas não coincidem" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "A senha deve ter pelo menos 6 caracteres" });
      return;
    }

    const emailLower = email.toLowerCase().trim();
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(emailLower)) {
      res.status(400).json({ error: "Email inválido" });
      return;
    }

    const croCleaned = cro.toUpperCase().trim();
    if (!/^\d{4,6}$/.test(croCleaned)) {
      res.status(400).json({ error: "CRO deve ter entre 4 e 6 dígitos" });
      return;
    }

    const existing = await db.query.tenantsTable.findFirst({
      where: eq(tenantsTable.email, emailLower),
    });
    if (existing) {
      res.status(409).json({ error: "Este email já está cadastrado" });
      return;
    }

    const existingCro = await db.query.tenantsTable.findFirst({
      where: eq(tenantsTable.cro, croCleaned),
    });
    if (existingCro) {
      res.status(409).json({
        error: "Este CRO já está cadastrado no sistema.",
        code: "CRO_DUPLICATE",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);

    const now = new Date();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const txDb = drizzle(client, { schema });

      // "trial" or "básico" → 7-day free trial, no credit card required (plan = "trial")
      // "essencial" / "pro"  → paid plans, credit card required from day 1
      // anything else (unset or unknown) → trial
      const isTrialBasico = !planType || planType === "trial" || planType === "básico" || planType === "basic";
      const resolvedPlan = isTrialBasico ? "trial" : (planType === "essencial" ? "essencial" : planType === "pro" ? "pro" : "trial");
      const trialEndsAt = isTrialBasico ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) : null;

      const [tenant] = await txDb.insert(tenantsTable).values({
        name,
        slug,
        email: emailLower,
        passwordHash,
        cro: croCleaned,
        plan: resolvedPlan,
        subscriptionStatus: isTrialBasico ? "trial" : "pending_payment",
        subscribedAt: now,
        ...(trialEndsAt ? { subscriptionExpiresAt: trialEndsAt } : {}),
      }).returning();

      await txDb.insert(dentalSettingsTable).values({
        tenantId: tenant.id,
        clinicName: name,
        clinicPhone: clinicPhone || "",
        clinicAddress: "",
        workingHoursStart: "08:00",
        workingHoursEnd: "18:00",
        slotDurationMinutes: 30,
        aiPersonality: "",
        aiLanguage: "pt-BR",
      });

      await txDb.insert(dentalProfessionalsTable).values({
        tenantId: tenant.id,
        name,
        cro: croCleaned,
        specialty: null,
        specialties: null,
        isOwner: true,
        workingDays: "1,2,3,4,5",
        workingHoursStart: "08:00",
        workingHoursEnd: "18:00",
        lunchStart: "12:00",
        lunchEnd: "13:00",
        slotDurationMinutes: 30,
        acceptsInsurance: false,
        consultationFee: null,
      });

      await client.query("COMMIT");

      const token = generateToken(tenant.id);
      logger.info({ tenantId: tenant.id, email: emailLower, plan: tenant.plan }, "New tenant registered");
      res.status(201).json({ tenantId: tenant.id, name: tenant.name, email: tenant.email, plan: tenant.plan, token });
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, "Registration failed");
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email e senha são obrigatórios" });
      return;
    }

    const emailLower = email.toLowerCase().trim();
    const tenant = await db.query.tenantsTable.findFirst({
      where: eq(tenantsTable.email, emailLower),
    });

    if (!tenant || !tenant.passwordHash) {
      res.status(401).json({ error: "Email ou senha incorretos" });
      return;
    }

    const valid = await bcrypt.compare(password, tenant.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Email ou senha incorretos" });
      return;
    }

    const token = generateToken(tenant.id);
    logger.info({ tenantId: tenant.id, email: emailLower }, "Tenant logged in");
    res.json({
      tenantId: tenant.id,
      name: tenant.name,
      email: tenant.email,
      plan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus,
      subscriptionExpiresAt: tenant.subscriptionExpiresAt,
      token,
    });
  } catch (err) {
    logger.error({ err }, "Login failed");
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    if (!email) {
      res.status(400).json({ error: "Email é obrigatório" });
      return;
    }

    const emailLower = email.toLowerCase().trim();
    const tenant = await db.query.tenantsTable.findFirst({
      where: eq(tenantsTable.email, emailLower),
    });

    if (!tenant) {
      res.json({ message: "Se o email estiver cadastrado, você receberá um link para redefinir sua senha." });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.update(passwordResetTokensTable)
      .set({ used: true })
      .where(and(
        eq(passwordResetTokensTable.tenantId, tenant.id),
        eq(passwordResetTokensTable.used, false),
      ));

    await db.insert(passwordResetTokensTable).values({
      tenantId: tenant.id,
      token: tokenHash,
      expiresAt,
    });

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:3000";
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await sendPasswordResetEmail(emailLower, resetUrl, tenant.name);

    res.json({ message: "Se o email estiver cadastrado, você receberá um link para redefinir sua senha." });
  } catch (err) {
    logger.error({ err }, "Forgot password failed");
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, password, confirmPassword } = req.body as {
      token: string; password: string; confirmPassword: string;
    };

    if (!token || !password || !confirmPassword) {
      res.status(400).json({ error: "Todos os campos são obrigatórios" });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({ error: "As senhas não coincidem" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "A senha deve ter pelo menos 6 caracteres" });
      return;
    }

    const tokenHash = hashToken(token);
    const resetToken = await db.query.passwordResetTokensTable.findFirst({
      where: and(
        eq(passwordResetTokensTable.token, tokenHash),
        eq(passwordResetTokensTable.used, false),
        gt(passwordResetTokensTable.expiresAt, new Date()),
      ),
    });

    if (!resetToken) {
      res.status(400).json({ error: "Link inválido ou expirado. Solicite um novo link de redefinição." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db.update(tenantsTable).set({ passwordHash }).where(eq(tenantsTable.id, resetToken.tenantId));
    await db.update(passwordResetTokensTable).set({ used: true }).where(eq(passwordResetTokensTable.id, resetToken.id));

    logger.info({ tenantId: resetToken.tenantId }, "Password reset completed");
    res.json({ message: "Senha redefinida com sucesso. Faça login com sua nova senha." });
  } catch (err) {
    logger.error({ err }, "Password reset failed");
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

export default router;

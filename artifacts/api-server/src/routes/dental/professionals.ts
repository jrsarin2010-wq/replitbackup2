import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { dentalProfessionalsTable, dentalSettingsTable, tenantsTable, professionalSlotOrdersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { createPixBillingGeneric } from "../../lib/abacatepay";
import { professionalsCache, getCachedSettings } from "../../lib/cache";
import { PLAN_MAX_PROFESSIONALS, isManagedPlan } from "../../lib/plan-pricing";

const CreateProfessionalBody = z.object({
  name: z.string().min(1),
  specialty: z.string().nullish(),
  specialties: z.string().nullish(),
  cro: z.string().nullish(),
  workingDays: z.string().default("1,2,3,4,5"),
  workingHoursStart: z.string().default("08:00"),
  workingHoursEnd: z.string().default("18:00"),
  lunchStart: z.string().default("12:00"),
  lunchEnd: z.string().default("13:00"),
  slotDurationMinutes: z.number().int().min(5).default(30),
  acceptsInsurance: z.boolean().default(false),
  consultationFee: z.string().nullish(),
  chargesConsultation: z.boolean().default(true),
  defaultLeadDurationMinutes: z.number().int().default(30),
  defaultPatientDurationMinutes: z.number().int().default(30),
  insurancePlans: z.string().nullish(),
  insuranceDays: z.string().nullish(),
  insuranceHoursStart: z.string().nullish(),
  insuranceHoursEnd: z.string().nullish(),
  instagramUrl: z.string().nullish(),
  profilePhotoUrl: z.string().nullish(),
  welcomeVideoUrl: z.string().nullish(),
  welcomeAudioUrl: z.string().nullish(),
  pixKey: z.string().nullish(),
  pixEnabled: z.boolean().default(false),
  pixMode: z.enum(["optional", "required"]).default("optional"),
  pixBank: z.string().nullish(),
  pixKeyType: z.enum(["cpf", "cnpj", "email", "phone", "random"]).nullish(),
});

const UpdateProfessionalBody = z.object({
  name: z.string().min(1).optional(),
  specialty: z.string().nullish(),
  specialties: z.string().nullish(),
  cro: z.string().nullish(),
  workingDays: z.string().optional(),
  workingHoursStart: z.string().optional(),
  workingHoursEnd: z.string().optional(),
  lunchStart: z.string().optional(),
  lunchEnd: z.string().optional(),
  slotDurationMinutes: z.number().int().min(5).optional(),
  acceptsInsurance: z.boolean().optional(),
  consultationFee: z.string().nullish(),
  chargesConsultation: z.boolean().optional(),
  defaultLeadDurationMinutes: z.number().int().optional(),
  defaultPatientDurationMinutes: z.number().int().optional(),
  insurancePlans: z.string().nullish(),
  insuranceDays: z.string().nullish(),
  insuranceHoursStart: z.string().nullish(),
  insuranceHoursEnd: z.string().nullish(),
  instagramUrl: z.string().nullish(),
  profilePhotoUrl: z.string().nullish(),
  welcomeVideoUrl: z.string().nullish(),
  welcomeAudioUrl: z.string().nullish(),
  pixKey: z.string().nullish(),
  pixEnabled: z.boolean().optional(),
  pixMode: z.enum(["optional", "required"]).optional(),
  pixBank: z.string().nullish(),
  pixKeyType: z.enum(["cpf", "cnpj", "email", "phone", "random"]).nullish(),
  isActive: z.boolean().optional(),
});

const router = Router();
router.use(tenantMiddleware);

router.get("/", async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const conditions = [eq(dentalProfessionalsTable.tenantId, req.tenantId)];
  if (!includeInactive) {
    conditions.push(eq(dentalProfessionalsTable.isActive, true));
  }
  const rows = await db.query.dentalProfessionalsTable.findMany({
    where: and(...conditions),
    orderBy: [desc(dentalProfessionalsTable.isOwner), dentalProfessionalsTable.name],
  });

  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, req.tenantId),
  });

  // Ensure specialties always has a value — fall back to legacy specialty for older rows
  const professionals = rows.map((p) => ({
    ...p,
    specialties: p.specialties ?? p.specialty ?? null,
  }));

  res.json({ professionals, maxProfessionals: tenant?.maxProfessionals ?? 1 });
});

router.post("/", async (req, res) => {
  const body = CreateProfessionalBody.parse(req.body);

  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, req.tenantId),
  });
  const maxProfessionals = tenant?.maxProfessionals ?? 1;

  const existing = await db.query.dentalProfessionalsTable.findMany({
    where: and(
      eq(dentalProfessionalsTable.tenantId, req.tenantId),
      eq(dentalProfessionalsTable.isActive, true),
    ),
  });

  if (existing.length >= maxProfessionals) {
    res.status(403).json({
      error: "Limite de profissionais atingido. Contrate profissionais extras para adicionar mais.",
      currentCount: existing.length,
      maxAllowed: maxProfessionals,
    });
    return;
  }

  const [prof] = await db.insert(dentalProfessionalsTable).values({
    ...body,
    tenantId: req.tenantId,
  }).returning();

  // Invalidate AFTER db.insert — correct order to avoid serving stale data
  await professionalsCache.invalidate(req.tenantId);
  res.status(201).json(prof);
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = UpdateProfessionalBody.parse(req.body);

  const existing = await db.query.dentalProfessionalsTable.findFirst({
    where: and(eq(dentalProfessionalsTable.id, id), eq(dentalProfessionalsTable.tenantId, req.tenantId)),
  });
  if (!existing) { res.status(404).json({ error: "Profissional nao encontrado" }); return; }

  if (body.isActive === true && !existing.isActive) {
    const tenant = await db.query.tenantsTable.findFirst({
      where: eq(tenantsTable.id, req.tenantId),
    });
    const maxProfessionals = tenant?.maxProfessionals ?? 1;

    const activeCount = await db.query.dentalProfessionalsTable.findMany({
      where: and(
        eq(dentalProfessionalsTable.tenantId, req.tenantId),
        eq(dentalProfessionalsTable.isActive, true),
      ),
    });

    if (activeCount.length >= maxProfessionals) {
      res.status(403).json({
        error: "Limite de profissionais atingido. Contrate profissionais extras para adicionar mais.",
        currentCount: activeCount.length,
        maxAllowed: maxProfessionals,
      });
      return;
    }
  }

  const [updated] = await db.update(dentalProfessionalsTable)
    .set(body)
    .where(and(eq(dentalProfessionalsTable.id, id), eq(dentalProfessionalsTable.tenantId, req.tenantId)))
    .returning();

  // Invalidate AFTER db.update — correct order to avoid serving stale data
  await professionalsCache.invalidate(req.tenantId);
  res.json(updated);
});

const SLOT_PRICE_CENTS = 9700;
// Task #31: Only the Pro plan may purchase extra professional slots, and the
// global cap of purchasable extras (beyond what the plan already includes)
// is now 1.
const MAX_EXTRA_PROFESSIONALS = 1;

const PurchaseSlotBody = z.object({
  taxId: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_EXTRA_PROFESSIONALS).default(1),
});

router.post("/purchase-slot", async (req, res) => {
  const body = PurchaseSlotBody.parse(req.body);
  const quantity = body.quantity ?? 1;
  const totalPriceInCents = SLOT_PRICE_CENTS * quantity;

  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, req.tenantId),
  });
  if (!tenant) {
    res.status(404).json({ error: "Tenant não encontrado" });
    return;
  }

  // Task #31: Extra slots are exclusive to the Pro plan. Other plans must
  // upgrade before adding professionals beyond their plan default.
  if (tenant.plan !== "pro") {
    res.status(403).json({
      error: "Profissionais extras estão disponíveis apenas no plano Pro. Faça upgrade para adicionar mais profissionais.",
      requiresUpgrade: true,
      requiredPlan: "pro",
    });
    return;
  }

  const planIncluded = isManagedPlan(tenant.plan) ? PLAN_MAX_PROFESSIONALS[tenant.plan] : 1;
  const currentExtras = Math.max(0, (tenant.maxProfessionals ?? 1) - planIncluded);
  if (currentExtras + quantity > MAX_EXTRA_PROFESSIONALS) {
    const remaining = Math.max(0, MAX_EXTRA_PROFESSIONALS - currentExtras);
    res.status(400).json({
      error: remaining <= 0
        ? "Limite do plano Pro atingido: você já possui o máximo de 1 profissional extra."
        : `Você só pode adicionar mais ${remaining} profissional extra. Ajuste a quantidade e tente novamente.`,
      remainingSlots: remaining,
      maxExtraProfessionals: MAX_EXTRA_PROFESSIONALS,
    });
    return;
  }

  const settings = await getCachedSettings(req.tenantId);

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const returnUrl = `${baseUrl}/settings?tab=professionals&slot_purchased=1`;
  const webhookUrl = `${baseUrl}/api/dental/pixwebhook`;

  const productName = quantity === 1
    ? "Profissional Extra — DentalAI"
    : `${quantity} Profissionais Extras — DentalAI`;

  // In development, bypass AbacatePay and create a simulated billing locally
  let billingResult: { id: string; url: string; status: string };
  if (process.env.NODE_ENV === "development") {
    const devBillingId = `dev-slot-${tenant.id}-${quantity}-${Date.now()}`;
    const devUrl = `${returnUrl}#dev-payment/${devBillingId}`;
    billingResult = { id: devBillingId, url: devUrl, status: "PENDING" };
  } else {
    const result = await createPixBillingGeneric({
      productId: "professional_slot",
      productName,
      priceInCents: totalPriceInCents,
      tenantId: tenant.id,
      tenantName: settings?.clinicName || tenant.name,
      tenantEmail: tenant.email || "",
      tenantTaxId: body.taxId,
      returnUrl,
      webhookUrl,
      metadata: {
        type: "professional_slot",
        tenantId: String(tenant.id),
        quantity: String(quantity),
      },
    });

    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    billingResult = result;
  }

  if (process.env.NODE_ENV === "development") {
    await db.transaction(async (tx) => {
      await tx.insert(professionalSlotOrdersTable).values({
        tenantId: tenant.id,
        priceInCents: totalPriceInCents,
        billingId: billingResult.id,
        paymentUrl: billingResult.url,
        status: "paid",
        paidAt: new Date(),
      });

      await tx
        .update(tenantsTable)
        .set({ maxProfessionals: sql`${tenantsTable.maxProfessionals} + ${quantity}` })
        .where(eq(tenantsTable.id, tenant.id));
    });
  } else {
    await db.insert(professionalSlotOrdersTable).values({
      tenantId: tenant.id,
      priceInCents: totalPriceInCents,
      billingId: billingResult.id,
      paymentUrl: billingResult.url,
      status: "pending",
    });
  }

  res.json({ url: billingResult.url, billingId: billingResult.id, quantity, totalPriceInCents });
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const existing = await db.query.dentalProfessionalsTable.findFirst({
    where: and(eq(dentalProfessionalsTable.id, id), eq(dentalProfessionalsTable.tenantId, req.tenantId)),
  });
  if (!existing) { res.status(404).json({ error: "Profissional nao encontrado" }); return; }

  const [updated] = await db.update(dentalProfessionalsTable)
    .set({ isActive: false })
    .where(and(eq(dentalProfessionalsTable.id, id), eq(dentalProfessionalsTable.tenantId, req.tenantId)))
    .returning();

  // Invalidate AFTER db.update — correct order to avoid serving stale data
  await professionalsCache.invalidate(req.tenantId);
  res.json(updated);
});

export default router;

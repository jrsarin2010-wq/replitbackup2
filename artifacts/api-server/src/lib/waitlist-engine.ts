import { db } from "@workspace/db";
import { dentalWaitlistTable, dentalProfessionalsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { getProviderForTenant } from "./whatsapp-provider";

const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

function formatSlotDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    const days = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
    const day = days[d.getUTCDay()];
    const h = d.getUTCHours().toString().padStart(2, "0");
    const m = d.getUTCMinutes().toString().padStart(2, "0");
    const dd = d.getUTCDate().toString().padStart(2, "0");
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    return `${day}, ${dd}/${mm} as ${h}:${m}`;
  } catch {
    return isoString;
  }
}

function getTimeOfDay(isoString: string): "morning" | "afternoon" {
  try {
    const h = new Date(isoString).getUTCHours();
    return h < 12 ? "morning" : "afternoon";
  } catch {
    return "morning";
  }
}

export async function addToWaitlist(params: {
  tenantId: number;
  contactPhone: string;
  contactName?: string;
  professionalId?: number | null;
  patientId?: number | null;
  leadId?: number | null;
  preferredDate?: string | null;
  preferredTimeSlot?: string | null;
  preferredTimeOfDay?: "morning" | "afternoon" | "any";
  notes?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(dentalWaitlistTable)
    .values({
      tenantId: params.tenantId,
      contactPhone: params.contactPhone,
      contactName: params.contactName ?? null,
      professionalId: params.professionalId ?? null,
      patientId: params.patientId ?? null,
      leadId: params.leadId ?? null,
      preferredDate: params.preferredDate ?? null,
      preferredTimeSlot: params.preferredTimeSlot ?? null,
      preferredTimeOfDay: params.preferredTimeOfDay ?? "any",
      notes: params.notes ?? null,
    })
    .returning({ id: dentalWaitlistTable.id });
  return row.id;
}

export async function getWaitlist(tenantId: number, professionalId?: number | null) {
  const conditions = [eq(dentalWaitlistTable.tenantId, tenantId)];
  if (professionalId != null) {
    conditions.push(eq(dentalWaitlistTable.professionalId, professionalId));
  }
  return db.query.dentalWaitlistTable.findMany({
    where: and(...conditions),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
}

export async function removeFromWaitlist(tenantId: number, id: number): Promise<boolean> {
  const result = await db
    .delete(dentalWaitlistTable)
    .where(and(eq(dentalWaitlistTable.id, id), eq(dentalWaitlistTable.tenantId, tenantId)));
  return (result.rowCount ?? 0) > 0;
}

export async function notifyWaitlistOnCancellation(params: {
  tenantId: number;
  professionalId?: number | null;
  startsAt: Date;
}): Promise<void> {
  try {
    const { tenantId, professionalId, startsAt } = params;
    const cancelledSlot = startsAt.toISOString();
    const cancelledTimeOfDay = getTimeOfDay(cancelledSlot);

    const conditions = [eq(dentalWaitlistTable.tenantId, tenantId)];
    if (professionalId) {
      conditions.push(eq(dentalWaitlistTable.professionalId, professionalId));
    }

    const queue = await db.query.dentalWaitlistTable.findMany({
      where: and(...conditions),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });

    if (queue.length === 0) return;

    const cooldownCutoff = new Date(Date.now() - NOTIFY_COOLDOWN_MS);
    const notCoolingDown = (e: typeof queue[0]) =>
      !e.notifiedAt || e.notifiedAt < cooldownCutoff;

    const cancelledDateStr = startsAt.toISOString().split("T")[0];

    const exactMatch = queue.find(
      (e) =>
        e.preferredTimeSlot &&
        Math.abs(new Date(e.preferredTimeSlot).getTime() - startsAt.getTime()) < 60_000 &&
        notCoolingDown(e),
    );

    const dateMatch = !exactMatch
      ? queue.find(
          (e) =>
            !e.preferredTimeSlot &&
            e.preferredDate === cancelledDateStr &&
            (e.preferredTimeOfDay === cancelledTimeOfDay || e.preferredTimeOfDay === "any") &&
            notCoolingDown(e),
        )
      : null;

    const timeOfDayMatch = !exactMatch && !dateMatch
      ? queue.find(
          (e) =>
            !e.preferredTimeSlot &&
            !e.preferredDate &&
            e.preferredTimeOfDay === cancelledTimeOfDay &&
            notCoolingDown(e),
        )
      : null;

    const generalMatch = !exactMatch && !dateMatch && !timeOfDayMatch
      ? queue.find(
          (e) =>
            !e.preferredTimeSlot &&
            !e.preferredDate &&
            e.preferredTimeOfDay === "any" &&
            notCoolingDown(e),
        )
      : null;

    const target = exactMatch ?? dateMatch ?? timeOfDayMatch ?? generalMatch;
    if (!target) return;

    let professionalName: string | undefined;
    if (professionalId) {
      const prof = await db.query.dentalProfessionalsTable.findFirst({
        where: eq(dentalProfessionalsTable.id, professionalId),
        columns: { name: true },
      });
      professionalName = prof?.name;
    }

    const slotLabel = formatSlotDate(cancelledSlot);
    const profPart = professionalName ? ` com ${professionalName}` : "";
    const namePart = target.contactName ? `, ${target.contactName.split(" ")[0]}` : "";

    const message = `Oi${namePart}! Uma vaga abriu na agenda ${slotLabel}${profPart}. Quer confirmar esse horario? E so me responder aqui!`;

    const { provider, instanceName } = await getProviderForTenant(tenantId);
    await provider.sendMessage(target.contactPhone, message, instanceName);

    await db
      .update(dentalWaitlistTable)
      .set({
        notifiedAt: new Date(),
        notificationCount: target.notificationCount + 1,
      })
      .where(eq(dentalWaitlistTable.id, target.id));

    logger.info(
      { tenantId, waitlistId: target.id, contactPhone: target.contactPhone, slotLabel },
      "Waitlist notification sent",
    );
  } catch (err) {
    logger.error({ err, tenantId: params.tenantId }, "Failed to notify waitlist on cancellation");
  }
}

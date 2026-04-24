import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { appointmentsTable, patientsTable, dentalLeadsTable, dentalSettingsTable, appointmentFollowUpsTable, dentalActivityTable, dentalProfessionalsTable } from "@workspace/db";
import { eq, and, gte, lte, lt, gt, or, desc, notInArray, not } from "drizzle-orm";
import { notifyWaitlistOnCancellation } from "../../lib/waitlist-engine";
import { getCachedSettings } from "../../lib/cache";
import { resolveLeadAppointmentTag, resolvePatientAppointmentTag } from "../../lib/insurance-policy";
import { tenantMiddleware } from "../../middlewares/tenant";
import {
  CreateAppointmentBody, UpdateAppointmentBody, GetAppointmentParams, UpdateAppointmentParams,
  DeleteAppointmentParams, ListAppointmentsQueryParams, CheckAppointmentConflictsQueryParams, GetAvailabilityQueryParams,
} from "@workspace/api-zod";

const PatchAppointmentStatusBody = z.object({
  status: z.enum(["completed", "no_show"]),
});

const CreateAppointmentWithProfessionalBody = CreateAppointmentBody.extend({
  professionalId: z.number().int().nullish(),
});

const UpdateAppointmentWithProfessionalBody = UpdateAppointmentBody.extend({
  professionalId: z.number().int().nullish(),
  pixPaymentStatus: z.enum(["none", "pending", "confirmed_auto", "confirmed_manual"]).optional(),
});

const router = Router();
router.use(tenantMiddleware);

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

function generateSlots(start: string, end: string, slotMin: number, date: string): string[] {
  const slots: string[] = [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMs = sh * 60 + sm;
  const endMs = eh * 60 + em;
  for (let t = startMs; t + slotMin <= endMs; t += slotMin) {
    const h = Math.floor(t / 60).toString().padStart(2, "0");
    const m = (t % 60).toString().padStart(2, "0");
    slots.push(`${date}T${h}:${m}:00.000Z`);
  }
  return slots;
}

async function getProfessionalSchedule(tenantId: number, professionalId: number | null | undefined) {
  if (professionalId) {
    const prof = await db.query.dentalProfessionalsTable.findFirst({
      where: and(eq(dentalProfessionalsTable.id, professionalId), eq(dentalProfessionalsTable.tenantId, tenantId)),
    });
    if (prof) {
      return {
        workingHoursStart: prof.workingHoursStart,
        workingHoursEnd: prof.workingHoursEnd,
        lunchStart: prof.lunchStart,
        lunchEnd: prof.lunchEnd,
        slotDurationMinutes: prof.slotDurationMinutes,
        workingDays: prof.workingDays,
      };
    }
  }
  const settings = await getCachedSettings(tenantId);
  return {
    workingHoursStart: settings?.workingHoursStart || "08:00",
    workingHoursEnd: settings?.workingHoursEnd || "18:00",
    lunchStart: settings?.lunchStart || "12:00",
    lunchEnd: settings?.lunchEnd || "13:00",
    slotDurationMinutes: settings?.slotDurationMinutes || 30,
    workingDays: settings?.workingDays || "1,2,3,4,5",
  };
}

function buildConflictConditions(tenantId: number, startsAt: Date, endsAt: Date, professionalId?: number | null, excludeId?: number) {
  const conditions = [
    eq(appointmentsTable.tenantId, tenantId),
    notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
    or(
      and(gte(appointmentsTable.startsAt, startsAt), lt(appointmentsTable.startsAt, endsAt)),
      and(gt(appointmentsTable.endsAt, startsAt), lte(appointmentsTable.endsAt, endsAt)),
      and(lte(appointmentsTable.startsAt, startsAt), gte(appointmentsTable.endsAt, endsAt))
    ),
  ];
  if (professionalId) {
    conditions.push(eq(appointmentsTable.professionalId, professionalId));
  }
  if (excludeId) {
    conditions.push(not(eq(appointmentsTable.id, excludeId)));
  }
  return and(...conditions);
}

router.get("/", async (req, res) => {
  const query = ListAppointmentsQueryParams.safeParse(req.query);
  const startDate = query.success ? query.data.startDate : undefined;
  const endDate = query.success ? query.data.endDate : undefined;
  const status = query.success ? query.data.status : undefined;
  const patientId = query.success ? query.data.patientId : undefined;
  const professionalId = req.query.professionalId ? parseInt(req.query.professionalId as string, 10) : undefined;

  const conditions = [eq(appointmentsTable.tenantId, req.tenantId)];
  if (startDate) conditions.push(gte(appointmentsTable.startsAt, new Date(startDate)));
  if (endDate) conditions.push(lte(appointmentsTable.startsAt, new Date(endDate)));
  if (status) conditions.push(eq(appointmentsTable.status, status));
  if (patientId) conditions.push(eq(appointmentsTable.patientId, patientId));
  if (professionalId) conditions.push(eq(appointmentsTable.professionalId, professionalId));

  const rows = await db.query.appointmentsTable.findMany({
    where: and(...conditions),
    orderBy: [desc(appointmentsTable.startsAt)],
  });

  const enriched = await Promise.all(
    rows.map(async (a) => {
      let patientName: string | undefined;
      if (a.patientId) {
        const patient = await db.query.patientsTable.findFirst({
          where: and(eq(patientsTable.id, a.patientId), eq(patientsTable.tenantId, req.tenantId)),
        });
        if (patient?.name) {
          const tag = resolvePatientAppointmentTag(patient.patientType);
          patientName = tag ? `${patient.name} (${tag})` : patient.name;
        }
      } else if (a.leadId) {
        const lead = await db.query.dentalLeadsTable.findFirst({
          where: and(eq(dentalLeadsTable.id, a.leadId), eq(dentalLeadsTable.tenantId, req.tenantId)),
        });
        if (lead?.name) {
          const tag = resolveLeadAppointmentTag(lead.paymentType);
          patientName = `${lead.name} (${tag})`;
        }
      }
      let professionalName: string | undefined;
      if (a.professionalId) {
        const prof = await db.query.dentalProfessionalsTable.findFirst({
          where: eq(dentalProfessionalsTable.id, a.professionalId),
        });
        professionalName = prof?.name;
      }
      return { ...a, patientName, professionalName };
    })
  );

  res.json(enriched);
});

router.post("/", async (req, res) => {
  const body = CreateAppointmentWithProfessionalBody.parse(req.body);
  const professionalId = body.professionalId ?? null;
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);

  if (!body.patientId && !body.leadId) {
    res.status(400).json({ error: "Informe patientId ou leadId" });
    return;
  }

  if (body.patientId) {
    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.id, body.patientId), eq(patientsTable.tenantId, req.tenantId)),
    });
    if (!patient) {
      res.status(400).json({ error: "Paciente nao encontrado neste tenant" });
      return;
    }
  }

  if (body.leadId) {
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.id, body.leadId), eq(dentalLeadsTable.tenantId, req.tenantId)),
    });
    if (!lead) {
      res.status(400).json({ error: "Lead nao encontrado neste tenant" });
      return;
    }
  }

  if (professionalId) {
    const prof = await db.query.dentalProfessionalsTable.findFirst({
      where: and(eq(dentalProfessionalsTable.id, professionalId), eq(dentalProfessionalsTable.tenantId, req.tenantId), eq(dentalProfessionalsTable.isActive, true)),
    });
    if (!prof) {
      res.status(400).json({ error: "Profissional nao encontrado ou inativo" });
      return;
    }
  }

  const schedule = await getProfessionalSchedule(req.tenantId, professionalId);
  const [wsH, wsM] = schedule.workingHoursStart.split(":").map(Number);
  const [weH, weM] = schedule.workingHoursEnd.split(":").map(Number);
  const apptStartMinutes = startsAt.getUTCHours() * 60 + startsAt.getUTCMinutes();
  const apptEndMinutes = endsAt.getUTCHours() * 60 + endsAt.getUTCMinutes();
  const workStartMinutes = wsH * 60 + wsM;
  const workEndMinutes = weH * 60 + weM;

  if (apptStartMinutes < workStartMinutes || apptEndMinutes > workEndMinutes) {
    res.status(400).json({ error: `Horario fora do expediente (${schedule.workingHoursStart} - ${schedule.workingHoursEnd})` });
    return;
  }

  const conflict = await db.query.appointmentsTable.findFirst({
    where: buildConflictConditions(req.tenantId, startsAt, endsAt, professionalId),
  });

  if (conflict) {
    res.status(409).json({ error: "Time slot conflict", conflictId: conflict.id });
    return;
  }

  const settings = await getCachedSettings(req.tenantId);
  const [appt] = await db.insert(appointmentsTable).values({
    ...body,
    tenantId: req.tenantId,
    startsAt,
    endsAt,
    professionalId,
  }).returning();

  const hoursB = settings?.reminderHoursBefore ?? 24;
  const postHours = settings?.postAppointmentHoursAfter ?? 1;

  await db.insert(appointmentFollowUpsTable).values([
    { tenantId: req.tenantId, appointmentId: appt.id, type: "reminder_24h", scheduledAt: new Date(startsAt.getTime() - hoursB * 3600000) },
    { tenantId: req.tenantId, appointmentId: appt.id, type: "post_appointment", scheduledAt: new Date(endsAt.getTime() + postHours * 3600000) },
  ]);

  await db.insert(dentalActivityTable).values({
    tenantId: req.tenantId,
    type: "appointment_created",
    description: `Agendamento criado para ${startsAt.toLocaleString("pt-BR")}`,
    entityType: "appointment",
    entityId: appt.id,
  });

  res.status(201).json(appt);
});

router.get("/conflicts", async (req, res) => {
  const query = CheckAppointmentConflictsQueryParams.parse(req.query);
  const startsAt = new Date(query.startsAt);
  const endsAt = new Date(query.endsAt);
  const professionalId = req.query.professionalId ? parseInt(req.query.professionalId as string, 10) : undefined;

  const conflicts = await db.query.appointmentsTable.findMany({
    where: buildConflictConditions(req.tenantId, startsAt, endsAt, professionalId),
  });

  res.json({ hasConflict: conflicts.length > 0, conflicts });
});

router.get("/availability", async (req, res) => {
  const query = GetAvailabilityQueryParams.parse(req.query);
  const { date, durationMinutes } = query;
  const professionalId = req.query.professionalId ? parseInt(req.query.professionalId as string, 10) : undefined;

  const schedule = await getProfessionalSchedule(req.tenantId, professionalId);
  const duration = durationMinutes ?? schedule.slotDurationMinutes;

  const morningSlots = generateSlots(schedule.workingHoursStart, schedule.lunchStart, duration, date);
  const afternoonSlots = generateSlots(schedule.lunchEnd, schedule.workingHoursEnd, duration, date);
  const slots = [...morningSlots, ...afternoonSlots];

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  const bookedConditions = [
    eq(appointmentsTable.tenantId, req.tenantId),
    notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
    gte(appointmentsTable.startsAt, dayStart),
    lte(appointmentsTable.startsAt, dayEnd),
  ];
  if (professionalId) {
    bookedConditions.push(eq(appointmentsTable.professionalId, professionalId));
  }

  const booked = await db.query.appointmentsTable.findMany({
    where: and(...bookedConditions),
  });

  const available = slots.filter((slot) => {
    const slotStart = new Date(slot);
    const slotEnd = addMinutes(slotStart, duration);
    return !booked.some((b) => {
      return !(slotEnd <= b.startsAt || slotStart >= b.endsAt);
    });
  });

  res.json({ date, durationMinutes: duration, professionalId: professionalId || null, availableSlots: available });
});

router.get("/:appointmentId", async (req, res) => {
  const { appointmentId } = GetAppointmentParams.parse(req.params);
  const appt = await db.query.appointmentsTable.findFirst({ where: and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.tenantId, req.tenantId)) });
  if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }
  let patientName: string | undefined;
  if (appt.patientId) {
    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.id, appt.patientId), eq(patientsTable.tenantId, req.tenantId)),
    });
    if (patient?.name) {
      const tag = resolvePatientAppointmentTag(patient.patientType);
      patientName = tag ? `${patient.name} (${tag})` : patient.name;
    }
  } else if (appt.leadId) {
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.id, appt.leadId), eq(dentalLeadsTable.tenantId, req.tenantId)),
    });
    if (lead?.name) {
      const tag = resolveLeadAppointmentTag(lead.paymentType);
      patientName = `${lead.name} (${tag})`;
    }
  }
  let professionalName: string | undefined;
  if (appt.professionalId) {
    const prof = await db.query.dentalProfessionalsTable.findFirst({
      where: eq(dentalProfessionalsTable.id, appt.professionalId),
    });
    professionalName = prof?.name;
  }
  res.json({ ...appt, patientName, professionalName });
});

router.patch("/:appointmentId", async (req, res) => {
  const { appointmentId } = UpdateAppointmentParams.parse(req.params);
  const body = UpdateAppointmentWithProfessionalBody.parse(req.body);
  const professionalId = body.professionalId !== undefined ? (body.professionalId ?? null) : undefined;

  const existing = await db.query.appointmentsTable.findFirst({
    where: and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.tenantId, req.tenantId)),
  });
  if (!existing) { res.status(404).json({ error: "Appointment not found" }); return; }

  if (body.patientId) {
    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.id, body.patientId), eq(patientsTable.tenantId, req.tenantId)),
    });
    if (!patient) {
      res.status(400).json({ error: "Paciente nao encontrado neste tenant" });
      return;
    }
  }

  const updateData: Record<string, unknown> = { ...body };
  const startsAt = body.startsAt ? new Date(body.startsAt) : existing.startsAt;
  const endsAt = body.endsAt ? new Date(body.endsAt) : existing.endsAt;
  if (body.startsAt) updateData.startsAt = startsAt;
  if (body.endsAt) updateData.endsAt = endsAt;
  if (professionalId !== undefined) updateData.professionalId = professionalId;

  const effectiveProfId = professionalId !== undefined ? professionalId : existing.professionalId;

  const needsScheduleCheck = body.startsAt || body.endsAt || (professionalId !== undefined && professionalId !== existing.professionalId);

  if (needsScheduleCheck) {
    const schedule = await getProfessionalSchedule(req.tenantId, effectiveProfId);
    const [wsH, wsM] = schedule.workingHoursStart.split(":").map(Number);
    const [weH, weM] = schedule.workingHoursEnd.split(":").map(Number);
    const apptStartMin = startsAt.getUTCHours() * 60 + startsAt.getUTCMinutes();
    const apptEndMin = endsAt.getUTCHours() * 60 + endsAt.getUTCMinutes();
    if (apptStartMin < wsH * 60 + wsM || apptEndMin > weH * 60 + weM) {
      res.status(400).json({ error: `Horario fora do expediente (${schedule.workingHoursStart} - ${schedule.workingHoursEnd})` });
      return;
    }

    const conflict = await db.query.appointmentsTable.findFirst({
      where: buildConflictConditions(req.tenantId, startsAt, endsAt, effectiveProfId, appointmentId),
    });
    if (conflict) {
      res.status(409).json({ error: "Time slot conflict", conflictId: conflict.id });
      return;
    }
  }

  const [appt] = await db.update(appointmentsTable).set(updateData)
    .where(and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.tenantId, req.tenantId)))
    .returning();

  if (body.status === "cancelled") {
    notifyWaitlistOnCancellation({
      tenantId: req.tenantId,
      professionalId: existing.professionalId,
      startsAt: existing.startsAt,
    }).catch(() => {});
  }

  res.json(appt);
});

router.delete("/:appointmentId", async (req, res) => {
  const { appointmentId } = DeleteAppointmentParams.parse(req.params);
  const existing = await db.query.appointmentsTable.findFirst({
    where: and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.tenantId, req.tenantId)),
    columns: { professionalId: true, startsAt: true },
  });
  await db.delete(appointmentsTable).where(and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.tenantId, req.tenantId)));
  if (existing) {
    notifyWaitlistOnCancellation({
      tenantId: req.tenantId,
      professionalId: existing.professionalId,
      startsAt: existing.startsAt,
    }).catch(() => {});
  }
  res.status(204).send();
});

router.patch("/:appointmentId/status", async (req, res) => {
  const appointmentId = parseInt(req.params.appointmentId, 10);
  if (isNaN(appointmentId)) { res.status(400).json({ error: "Invalid appointment id" }); return; }

  const parsed = PatchAppointmentStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "status must be 'completed' or 'no_show'" });
    return;
  }
  const { status } = parsed.data;

  const existing = await db.query.appointmentsTable.findFirst({
    where: and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.tenantId, req.tenantId)),
  });
  if (!existing) { res.status(404).json({ error: "Appointment not found" }); return; }

  const [updated] = await db.update(appointmentsTable)
    .set({ status })
    .where(and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.tenantId, req.tenantId)))
    .returning();

  if (status === "no_show") {
    const settings = await getCachedSettings(req.tenantId);
    if (settings?.noShowEnabled) {
      const existing = await db.query.appointmentFollowUpsTable.findFirst({
        where: and(
          eq(appointmentFollowUpsTable.appointmentId, appointmentId),
          eq(appointmentFollowUpsTable.type, "no_show_patient_contact"),
        ),
      });
      if (!existing) {
        const hoursAfter = settings.noShowPatientContactHoursAfter ?? 24;
        const scheduledAt = new Date(Date.now() + hoursAfter * 60 * 60 * 1000);
        await db.insert(appointmentFollowUpsTable).values({
          tenantId: req.tenantId,
          appointmentId,
          type: "no_show_patient_contact",
          scheduledAt,
          status: "pending",
          message: settings.noShowPatientMessage || null,
        });
      }
    }
  }

  res.json(updated);
});

export default router;

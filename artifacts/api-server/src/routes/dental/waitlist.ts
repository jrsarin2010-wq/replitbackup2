import { Router } from "express";
import { z } from "zod";
import { tenantMiddleware } from "../../middlewares/tenant";
import { addToWaitlist, getWaitlist, removeFromWaitlist } from "../../lib/waitlist-engine";

const router = Router();
router.use(tenantMiddleware);

const AddToWaitlistBody = z.object({
  contactPhone: z.string().min(1),
  contactName: z.string().optional(),
  professionalId: z.number().int().optional().nullable(),
  patientId: z.number().int().optional().nullable(),
  leadId: z.number().int().optional().nullable(),
  preferredDate: z.string().optional().nullable(),
  preferredTimeSlot: z.string().optional().nullable(),
  preferredTimeOfDay: z.enum(["morning", "afternoon", "any"]).default("any"),
  notes: z.string().optional().nullable(),
});

router.get("/", async (req, res) => {
  let professionalId: number | undefined;
  if (req.query.professionalId !== undefined) {
    professionalId = Number(req.query.professionalId);
    if (isNaN(professionalId)) {
      res.status(400).json({ error: "professionalId must be a valid integer" });
      return;
    }
  }
  const list = await getWaitlist(req.tenantId, professionalId);
  res.json(list);
});

router.post("/", async (req, res) => {
  const body = AddToWaitlistBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.issues });
    return;
  }
  const id = await addToWaitlist({ tenantId: req.tenantId, ...body.data });
  res.status(201).json({ id });
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const removed = await removeFromWaitlist(req.tenantId, id);
  if (!removed) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

export default router;

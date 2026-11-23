/**
 * Medical reviews / follow-up visits (المراجعات الطبية).
 * Each review books an Appointment for the doctor. Completing a review can
 * schedule the next one, building a follow-up chain (previousReviewId).
 */
import { z } from "zod";
import { Prisma, type ReviewStatus } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { conflictError, conflictWithSuggestions, findConflicts, markClientVisited } from "./appointments";
import { reviewCommission } from "./commissions";
import { assertBranchAccess, canSeeClinical, optText, recordBranchScope, requireClient, requireStaff, uuidOpt } from "./common";

export const REASON_TYPES = ["POST_OP", "ROUTINE", "COMPLAINT", "TREATMENT", "RESULT", "OTHER"] as const;
const OUTCOMES = ["IMPROVED", "STABLE", "WORSE", "RESOLVED"] as const;

export const createReviewSchema = z.object({
  clientId: z.string().uuid(),
  branchId: uuidOpt,
  doctorId: z.string().uuid(),
  surgeryId: uuidOpt,
  clientProgramId: uuidOpt,
  reasonType: z.enum(REASON_TYPES).default("ROUTINE"),
  reason: z.string().trim().min(2).max(300),
  scheduledAt: z.coerce.date(),
  durationMin: z.coerce.number().int().min(5).max(240).default(20),
});

export const completeReviewSchema = z.object({
  diagnosis: optText(4000), notes: optText(8000), procedures: optText(4000),
  outcome: z.enum(OUTCOMES).optional().nullable(),
  nextReviewAt: z.coerce.date().optional().nullable(),
  nextReason: z.string().trim().max(300).optional(),
});

const include = {
  client: { select: { id: true, code: true, fullName: true, phone: true } },
  doctor: { select: { id: true, fullName: true } },
  branch: { select: { id: true, name: true } },
  surgery: { select: { id: true, code: true, surgeryType: true } },
  program: { select: { id: true, code: true, name: true } },
} satisfies Prisma.MedicalReviewInclude;
type Row = Prisma.MedicalReviewGetPayload<{ include: typeof include }>;

function shape(r: Row, ctx: Ctx) {
  const clinical = canSeeClinical(ctx);
  const overdue = r.status === "SCHEDULED" && +r.scheduledAt + r.durationMin * 60000 < Date.now();
  return { ...r, diagnosis: clinical ? r.diagnosis : null, notes: clinical ? r.notes : null, procedures: clinical ? r.procedures : null, overdue, clinicalHidden: !clinical };
}

type CreateInput = z.infer<typeof createReviewSchema> & { previousReviewId?: string | null; skipConflicts?: boolean };

/** Internal: used by the API and by surgery completion (auto post-op reviews). */
export async function createReviewTx(
  tx: Tx, ctx: Ctx, tenantId: string,
  d: Omit<CreateInput, "branchId" | "surgeryId" | "clientProgramId"> & { branchId?: string | null; surgeryId?: string | null; clientProgramId?: string | null },
) {
  const client = await requireClient(tx, ctx, tenantId, d.clientId, 400);
  const branchId = d.branchId ?? client.branchId;
  assertBranchAccess(ctx, branchId);
  await requireStaff(tx, tenantId, d.doctorId, branchId);
  if (d.surgeryId && !(await tx.surgery.findFirst({ where: { id: d.surgeryId, tenantId, clientId: d.clientId } }))) throw badRequest("Surgery not found for this client");
  if (d.clientProgramId && !(await tx.clientProgram.findFirst({ where: { id: d.clientProgramId, tenantId, clientId: d.clientId } }))) throw badRequest("Program not found for this client");

  // Find the slot. Auto-created reviews slide forward in 30-min steps to the doctor's next free slot.
  let start = d.scheduledAt;
  for (let attempt = 0; ; attempt++) {
    const slot = { staffId: d.doctorId, roomId: null, startsAt: start, endsAt: new Date(+start + d.durationMin * 60000) };
    const clash = await findConflicts(tx, tenantId, slot);
    if (!clash.length) break;
    if (!d.skipConflicts || attempt >= 24) throw await conflictWithSuggestions(tx, tenantId, clash[0], slot);
    start = new Date(+start + 30 * 60000);
  }
  const appt = await tx.appointment.create({
    data: {
      tenantId, branchId, clientId: d.clientId, staffId: d.doctorId, startsAt: start, endsAt: new Date(+start + d.durationMin * 60000),
      status: "SCHEDULED", notes: d.reason, bookingSource: "review", createdById: ctx.user.id,
    },
  });
  const r = await tx.medicalReview.create({
    data: {
      tenantId, clientId: d.clientId, branchId, doctorId: d.doctorId, surgeryId: d.surgeryId ?? null, clientProgramId: d.clientProgramId ?? null,
      previousReviewId: d.previousReviewId ?? null, appointmentId: appt.id, reasonType: d.reasonType, reason: d.reason,
      scheduledAt: start, durationMin: d.durationMin, createdById: ctx.user.id,
    },
    include,
  });
  await audit(tx, ctx, { action: "review.create", entity: "MedicalReview", entityId: r.id, after: { clientId: d.clientId, scheduledAt: start, reasonType: d.reasonType, surgeryId: d.surgeryId } });
  return r;
}

export async function createReview(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "reviews.create");
  const d = createReviewSchema.parse(raw);
  return withTenant(tenantId, async (tx) => shape(await createReviewTx(tx, ctx, tenantId, d), ctx));
}

export async function listReviews(ctx: Ctx, q: { scope?: string; status?: string; doctorId?: string; clientId?: string; surgeryId?: string } = {}) {
  const tenantId = requireTenant(ctx, "reviews.view");
  const now = new Date();
  const where: Prisma.MedicalReviewWhereInput = { tenantId, ...recordBranchScope(ctx) };
  if (q.status) where.status = q.status as ReviewStatus;
  if (q.scope === "upcoming") { where.status = "SCHEDULED"; where.scheduledAt = { gte: now }; }
  if (q.scope === "overdue") { where.status = "SCHEDULED"; where.scheduledAt = { lt: now }; }
  if (q.scope === "today") { const s = new Date(now); s.setHours(0, 0, 0, 0); where.scheduledAt = { gte: s, lt: new Date(+s + 86400000) }; }
  if (q.doctorId) where.doctorId = q.doctorId;
  if (q.clientId) where.clientId = q.clientId;
  if (q.surgeryId) where.surgeryId = q.surgeryId;
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.medicalReview.findMany({
      where, include, take: 500,
      orderBy: q.scope === "upcoming" || q.scope === "overdue" ? { scheduledAt: "asc" } : { scheduledAt: "desc" },
    });
    return rows.map((r) => shape(r, ctx));
  });
}

export async function getReview(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "reviews.view");
  return withTenant(tenantId, async (tx) => {
    const r = await tx.medicalReview.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) }, include });
    if (!r) throw notFound("Review not found");
    // Full chain for this client (history), newest first
    const history = await tx.medicalReview.findMany({
      where: { tenantId, clientId: r.clientId }, include, orderBy: { scheduledAt: "desc" }, take: 50,
    });
    if (canSeeClinical(ctx)) await audit(tx, ctx, { action: "review.view", entity: "MedicalReview", entityId: id });
    return { ...shape(r, ctx), history: history.map((h) => shape(h, ctx)) };
  });
}

export async function updateReview(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "reviews.update");
  const d = z.object({
    doctorId: z.string().uuid(), scheduledAt: z.coerce.date(), durationMin: z.coerce.number().int().min(5).max(240),
    reason: z.string().trim().min(2).max(300), reasonType: z.enum(REASON_TYPES),
  }).partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const r = await tx.medicalReview.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!r) throw notFound("Review not found");
    if (r.status !== "SCHEDULED") throw conflict("Only scheduled reviews can be changed");
    const doctorId = d.doctorId ?? r.doctorId!;
    if (d.doctorId) await requireStaff(tx, tenantId, d.doctorId, r.branchId);
    const start = d.scheduledAt ?? r.scheduledAt;
    const end = new Date(+start + (d.durationMin ?? r.durationMin) * 60000);
    const slot = { staffId: doctorId, roomId: null, startsAt: start, endsAt: end };
    const clash = await findConflicts(tx, tenantId, slot, r.appointmentId ?? undefined);
    if (clash.length) throw await conflictWithSuggestions(tx, tenantId, clash[0], slot, r.appointmentId ?? undefined);
    if (r.appointmentId) await tx.appointment.update({ where: { id: r.appointmentId }, data: { staffId: doctorId, startsAt: start, endsAt: end, ...(d.reason ? { notes: d.reason } : {}) } });
    const after = await tx.medicalReview.update({ where: { id }, data: { ...d, doctorId, scheduledAt: start }, include });
    await audit(tx, ctx, { action: "review.update", entity: "MedicalReview", entityId: id, after: { changedFields: Object.keys(d), scheduledAt: start } });
    return shape(after, ctx);
  });
}

export async function completeReview(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "reviews.update");
  const d = completeReviewSchema.parse(raw);
  const hasClinical = !!(d.diagnosis || d.notes || d.procedures);
  if (hasClinical && !canSeeClinical(ctx)) throw forbidden("Clinical findings require the 'view medical data' permission");
  return withTenant(tenantId, async (tx) => {
    const r = await tx.medicalReview.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!r) throw notFound("Review not found");
    if (r.status !== "SCHEDULED") throw conflict("Review is not scheduled");
    if (+r.scheduledAt - Date.now() > 2 * 3600000) throw conflict("This review hasn't started yet");
    if (d.nextReviewAt && d.nextReviewAt <= r.scheduledAt) throw badRequest("Next review must be after this one");
    const now = new Date();
    if (r.appointmentId) await tx.appointment.update({ where: { id: r.appointmentId }, data: { status: "COMPLETED", completedAt: now } });
    const after = await tx.medicalReview.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: now, diagnosis: d.diagnosis, notes: d.notes, procedures: d.procedures, outcome: d.outcome ?? null },
      include,
    });
    await markClientVisited(tx, tenantId, r.clientId, r.scheduledAt, "مراجعة طبية", ctx.user.id);
    if (ctx.features.has("commissions")) await reviewCommission(tx, tenantId, r); // Phase 4: fixed per-review commission
    // Recovery tracking on the surgery follows the review outcome.
    if (r.surgeryId && d.outcome) {
      const rec = d.outcome === "RESOLVED" ? "RECOVERED" : d.outcome === "WORSE" ? "NEEDS_ATTENTION" : "STABLE";
      await tx.surgery.update({ where: { id: r.surgeryId }, data: { recoveryStatus: rec } });
    }
    let next = null;
    if (d.nextReviewAt) {
      next = await createReviewTx(tx, ctx, tenantId, {
        clientId: r.clientId, branchId: r.branchId, doctorId: r.doctorId!, surgeryId: r.surgeryId, clientProgramId: r.clientProgramId,
        reasonType: r.reasonType as (typeof REASON_TYPES)[number], reason: d.nextReason || r.reason, scheduledAt: d.nextReviewAt,
        durationMin: r.durationMin, previousReviewId: r.id,
      });
    }
    await audit(tx, ctx, { action: "review.complete", entity: "MedicalReview", entityId: id, after: { outcome: d.outcome, nextReviewId: next?.id ?? null, clinicalFieldsRecorded: hasClinical } });
    return { ...shape(after, ctx), nextReview: next ? shape(next, ctx) : null };
  });
}

export async function setReviewStatus(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "reviews.update");
  const { action, reason } = z.object({ action: z.enum(["MISSED", "CANCEL"]), reason: z.string().trim().max(300).optional() }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const r = await tx.medicalReview.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!r) throw notFound("Review not found");
    if (r.status !== "SCHEDULED") throw conflict("Review is not scheduled");
    if (action === "MISSED" && +r.scheduledAt > Date.now()) throw conflict("Can't mark a future review as missed");
    if (action === "CANCEL" && !reason) throw badRequest("Cancellation reason is required");
    const status = action === "MISSED" ? "MISSED" : "CANCELLED";
    if (r.appointmentId) {
      await tx.appointment.update({
        where: { id: r.appointmentId },
        data: action === "MISSED" ? { status: "NO_SHOW" } : { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
      });
    }
    const after = await tx.medicalReview.update({ where: { id }, data: { status }, include });
    await audit(tx, ctx, { action: `review.${status.toLowerCase()}`, entity: "MedicalReview", entityId: id, after: { status, reason } });
    return shape(after, ctx);
  });
}

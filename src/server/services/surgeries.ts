/**
 * Surgeries (العمليات الجراحية). Each surgery owns an Appointment for the
 * surgeon + operating room, so double-booking is blocked by the same
 * PostgreSQL exclusion constraints as normal bookings. Team members' calendars
 * are checked in the app. Clinical text needs medical.view_data and is never
 * copied into the audit log. Payments are handled by invoices (Phase 4).
 */
import { z } from "zod";
import { Prisma, type SurgeryStatus } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { conflictError, conflictWithSuggestions, findConflicts, markClientVisited } from "./appointments";
import { servicePrice } from "./catalog";
import { assertBranchAccess, canSeeClinical, nextCounter, optText, recordBranchScope, requireClient, requireStaff, uuidOpt } from "./common";
import { createReviewTx } from "./reviews";
import { notifyUsers } from "./notifications";
import { consumeForSurgery } from "./inventory";

const TEAM_ROLES = ["ASSISTANT", "ANESTHETIST", "NURSE", "TECHNICIAN", "OTHER"] as const;
const team = z.array(z.object({ userId: z.string().uuid(), role: z.enum(TEAM_ROLES) })).max(20)
  .refine((t) => new Set(t.map((x) => x.userId)).size === t.length, "Each team member once");

export const createSurgerySchema = z.object({
  clientId: z.string().uuid(),
  branchId: uuidOpt,
  serviceId: uuidOpt,
  surgeryType: z.string().trim().min(2).max(200).optional(),
  surgeonId: z.string().uuid(),
  roomId: uuidOpt,
  scheduledAt: z.coerce.date(),
  durationMin: z.coerce.number().int().min(15).max(24 * 60).optional(),
  price: z.coerce.number().min(0).max(1e10).optional(),
  anesthesiaType: z.string().trim().max(60).optional().nullable().transform((v) => v || null),
  preOpNotes: optText(8000),
  status: z.enum(["PLANNED", "CONFIRMED"]).default("PLANNED"),
  team: team.default([]),
});

export const updateSurgerySchema = z.object({
  surgeryType: z.string().trim().min(2).max(200),
  surgeonId: z.string().uuid(),
  roomId: uuidOpt,
  scheduledAt: z.coerce.date(),
  durationMin: z.coerce.number().int().min(15).max(24 * 60),
  price: z.coerce.number().min(0).max(1e10),
  anesthesiaType: z.string().trim().max(60).nullable().transform((v) => v || null),
  team,
}).partial();

export const clinicalSchema = z.object({
  preOpNotes: optText(8000), postOpNotes: optText(8000), operativeReport: optText(20000), complications: optText(4000),
  recoveryStatus: z.enum(["NOT_STARTED", "STABLE", "NEEDS_ATTENTION", "COMPLICATED", "RECOVERED"]),
}).partial();

const CLINICAL = ["preOpNotes", "postOpNotes", "operativeReport", "complications"] as const;

const include = {
  client: { select: { id: true, code: true, fullName: true, phone: true, gender: true, birthDate: true } },
  surgeon: { select: { id: true, fullName: true } },
  room: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
  team: { include: { user: { select: { id: true, fullName: true, jobTitle: true } } } },
  supplies: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.SurgeryInclude;
type Row = Prisma.SurgeryGetPayload<{ include: typeof include }>;

function shape(s: Row, ctx: Ctx) {
  const clinical = canSeeClinical(ctx);
  const suppliesCost = s.supplies.reduce((t, x) => t + Number(x.quantity) * Number(x.unitCost), 0);
  const out: Record<string, unknown> = { ...s, suppliesCost, clinicalHidden: !clinical };
  if (!clinical) for (const k of CLINICAL) out[k] = null;
  return out as Row & { suppliesCost: number; clinicalHidden: boolean };
}

const apptStatus = (s: SurgeryStatus) => (s === "CONFIRMED" ? "CONFIRMED" : s === "IN_PROGRESS" ? "CHECKED_IN" : s === "COMPLETED" ? "COMPLETED" : s === "CANCELLED" || s === "POSTPONED" ? "CANCELLED" : "SCHEDULED");

async function checkSlot(tx: Tx, tenantId: string, slot: { surgeonId: string; roomId: string | null; start: Date; end: Date; team: { userId: string }[] }, excludeAppointmentId?: string) {
  const main = { staffId: slot.surgeonId, roomId: slot.roomId, startsAt: slot.start, endsAt: slot.end };
  const clash = await findConflicts(tx, tenantId, main, excludeAppointmentId);
  if (clash.length) throw await conflictWithSuggestions(tx, tenantId, clash[0], main, excludeAppointmentId);
  for (const m of slot.team) {
    const s = { staffId: m.userId, roomId: null, startsAt: slot.start, endsAt: slot.end };
    const c = await findConflicts(tx, tenantId, s, excludeAppointmentId);
    if (c.length) throw conflictError(c[0], s);
  }
}

async function checkRoom(tx: Tx, tenantId: string, roomId: string | null | undefined, branchId: string) {
  if (roomId && !(await tx.room.findFirst({ where: { id: roomId, tenantId, branchId, isActive: true } }))) throw badRequest("Room not found in this branch");
}

// ---------------------------------------------------------------- read ----

export async function listSurgeries(ctx: Ctx, q: { status?: string; from?: string; to?: string; surgeonId?: string; clientId?: string; search?: string } = {}) {
  const tenantId = requireTenant(ctx, "surgeries.view");
  const where: Prisma.SurgeryWhereInput = { tenantId, ...recordBranchScope(ctx) };
  if (q.status) where.status = q.status as SurgeryStatus;
  if (q.from || q.to) where.scheduledAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
  if (q.surgeonId) where.surgeonId = q.surgeonId;
  if (q.clientId) where.clientId = q.clientId;
  if (q.search) where.OR = [{ code: q.search.toUpperCase() }, { surgeryType: { contains: q.search, mode: "insensitive" } }, { client: { fullName: { contains: q.search, mode: "insensitive" } } }];
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.surgery.findMany({ where, include: { ...include, _count: { select: { reviews: true } } }, orderBy: { scheduledAt: "desc" }, take: 500 });
    return rows.map((r) => shape(r, ctx));
  });
}

export async function getSurgery(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "surgeries.view");
  return withTenant(tenantId, async (tx) => {
    const s = await tx.surgery.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) }, include });
    if (!s) throw notFound("Surgery not found");
    const reviews = await tx.medicalReview.findMany({
      where: { tenantId, surgeryId: id }, orderBy: { scheduledAt: "asc" },
      select: { id: true, scheduledAt: true, status: true, reason: true, outcome: true, doctor: { select: { fullName: true } } },
    });
    const files = canSeeClinical(ctx) && ctx.permissions.has("medical.view")
      ? await tx.fileObject.findMany({ where: { tenantId, surgeryId: id }, select: { id: true, category: true, originalName: true, mimeType: true, sizeBytes: true, note: true, createdAt: true }, orderBy: { createdAt: "desc" } })
      : [];
    if (canSeeClinical(ctx)) await audit(tx, ctx, { action: "surgery.view", entity: "Surgery", entityId: id });
    return { ...shape(s, ctx), reviews, files };
  });
}

// ---------------------------------------------------------------- write ----

export async function createSurgery(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "surgeries.create");
  const d = createSurgerySchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const client = await requireClient(tx, ctx, tenantId, d.clientId, 400);
    const branchId = d.branchId ?? client.branchId;
    assertBranchAccess(ctx, branchId);
    const service = d.serviceId ? await tx.service.findFirst({ where: { id: d.serviceId, tenantId } }) : null;
    if (d.serviceId && !service) throw badRequest("Service not found");
    const surgeryType = d.surgeryType ?? service?.name;
    if (!surgeryType) throw badRequest("Surgery type is required");
    await requireStaff(tx, tenantId, d.surgeonId, branchId);
    for (const m of d.team) {
      if (m.userId === d.surgeonId) throw badRequest("The surgeon is already on the surgery");
      await requireStaff(tx, tenantId, m.userId);
    }
    await checkRoom(tx, tenantId, d.roomId, branchId);
    const durationMin = d.durationMin ?? service?.durationMin ?? 120;
    const end = new Date(+d.scheduledAt + durationMin * 60000);
    await checkSlot(tx, tenantId, { surgeonId: d.surgeonId, roomId: d.roomId, start: d.scheduledAt, end, team: d.team });
    const price = d.price ?? (service ? Number(await servicePrice(tx, service.id, branchId)) : 0);

    const appt = await tx.appointment.create({
      data: {
        tenantId, branchId, clientId: d.clientId, serviceId: service?.id ?? null, staffId: d.surgeonId, roomId: d.roomId,
        startsAt: d.scheduledAt, endsAt: end, status: apptStatus(d.status), price, notes: surgeryType, bookingSource: "surgery", createdById: ctx.user.id,
      },
    });
    const code = `S-${String(await nextCounter(tx, tenantId, "surgery")).padStart(6, "0")}`;
    const s = await tx.surgery.create({
      data: {
        tenantId, code, clientId: d.clientId, branchId, serviceId: service?.id ?? null, surgeryType, surgeonId: d.surgeonId, roomId: d.roomId,
        appointmentId: appt.id, scheduledAt: d.scheduledAt, durationMin, status: d.status, price, anesthesiaType: d.anesthesiaType,
        preOpNotes: canSeeClinical(ctx) ? d.preOpNotes : null, createdById: ctx.user.id,
        team: { create: d.team.map((m) => ({ tenantId, ...m })) },
      },
      include,
    });
    await tx.clientInteraction.create({ data: { tenantId, clientId: d.clientId, type: "SYSTEM", userId: ctx.user.id, content: `surgery.scheduled:${surgeryType}:${d.scheduledAt.toISOString()}` } });
    await notifyUsers(tx, tenantId, [d.surgeonId, ...d.team.map((m) => m.userId)].filter((u) => u !== ctx.user.id), { type: "surgery.scheduled", title: `عملية جديدة: ${surgeryType}`, body: d.scheduledAt.toISOString().slice(0, 16).replace("T", " "), link: `/surgeries/${s.id}` });
    await audit(tx, ctx, { action: "surgery.create", entity: "Surgery", entityId: s.id, after: { code, surgeryType, clientId: d.clientId, scheduledAt: d.scheduledAt, surgeonId: d.surgeonId, price } });
    return shape(s, ctx);
  });
}

export async function updateSurgery(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "surgeries.update");
  const d = updateSurgerySchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.surgery.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) }, include: { team: true } });
    if (!before) throw notFound("Surgery not found");
    if (["COMPLETED", "CANCELLED", "IN_PROGRESS"].includes(before.status)) throw conflict("This surgery can no longer be edited");
    const next = {
      surgeonId: d.surgeonId ?? before.surgeonId!, roomId: d.roomId !== undefined ? d.roomId : before.roomId,
      start: d.scheduledAt ?? before.scheduledAt, durationMin: d.durationMin ?? before.durationMin,
      team: d.team ?? before.team.map((t) => ({ userId: t.userId, role: t.role as (typeof TEAM_ROLES)[number] })),
    };
    const end = new Date(+next.start + next.durationMin * 60000);
    if (d.surgeonId) await requireStaff(tx, tenantId, d.surgeonId, before.branchId);
    if (d.team) for (const m of d.team) await requireStaff(tx, tenantId, m.userId);
    await checkRoom(tx, tenantId, next.roomId, before.branchId);
    await checkSlot(tx, tenantId, { surgeonId: next.surgeonId, roomId: next.roomId, start: next.start, end, team: next.team }, before.appointmentId ?? undefined);
    // A postponed surgery that gets a new date is planned again.
    const status = before.status === "POSTPONED" && d.scheduledAt ? "PLANNED" : before.status;
    if (before.appointmentId) {
      await tx.appointment.update({
        where: { id: before.appointmentId },
        data: { staffId: next.surgeonId, roomId: next.roomId, startsAt: next.start, endsAt: end, status: apptStatus(status), ...(d.price !== undefined ? { price: d.price } : {}), cancelledAt: null, cancelReason: null },
      });
    }
    if (d.team) {
      await tx.surgeryTeamMember.deleteMany({ where: { tenantId, surgeryId: id } });
      await tx.surgeryTeamMember.createMany({ data: d.team.map((m) => ({ tenantId, surgeryId: id, ...m })) });
    }
    const { team: _t, ...fields } = d;
    const after = await tx.surgery.update({ where: { id }, data: { ...fields, status, scheduledAt: next.start, durationMin: next.durationMin }, include });
    await audit(tx, ctx, { action: +next.start !== +before.scheduledAt ? "surgery.reschedule" : "surgery.update", entity: "Surgery", entityId: id, after: { changedFields: Object.keys(d), scheduledAt: next.start } });
    return shape(after, ctx);
  });
}

export async function updateClinical(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "surgeries.update");
  if (!canSeeClinical(ctx)) throw forbidden("Clinical notes require the 'view medical data' permission");
  const d = clinicalSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.surgery.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!before) throw notFound("Surgery not found");
    const after = await tx.surgery.update({ where: { id }, data: d, include });
    await audit(tx, ctx, { action: "surgery.clinical.update", entity: "Surgery", entityId: id, after: { changedFields: Object.keys(d), recoveryStatus: d.recoveryStatus } });
    return shape(after, ctx);
  });
}

export const surgeryStatusSchema = z.object({
  action: z.enum(["CONFIRM", "START", "COMPLETE", "POSTPONE", "CANCEL"]),
  reason: z.string().trim().max(300).optional(),
  /** On COMPLETE: schedule post-op reviews after N days (e.g. [7, 30]) */
  followUpDays: z.array(z.coerce.number().int().min(1).max(365)).max(5).optional(),
});

export async function setSurgeryStatus(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "surgeries.update");
  const { action, reason, followUpDays } = surgeryStatusSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const s = await tx.surgery.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!s) throw notFound("Surgery not found");
    const now = new Date();
    const allowed: Record<typeof action, SurgeryStatus[]> = {
      CONFIRM: ["PLANNED"], START: ["PLANNED", "CONFIRMED"], COMPLETE: ["IN_PROGRESS"], POSTPONE: ["PLANNED", "CONFIRMED"], CANCEL: ["PLANNED", "CONFIRMED", "POSTPONED"],
    };
    if (!allowed[action].includes(s.status)) throw conflict(`Can't ${action.toLowerCase()} a ${s.status.toLowerCase()} surgery`);
    if ((action === "POSTPONE" || action === "CANCEL") && !reason) throw badRequest("A reason is required");
    if (action === "START" && +s.scheduledAt - +now > 2 * 3600000) throw conflict("The surgery hasn't started yet");

    const status: SurgeryStatus = action === "CONFIRM" ? "CONFIRMED" : action === "START" ? "IN_PROGRESS" : action === "COMPLETE" ? "COMPLETED" : action === "POSTPONE" ? "POSTPONED" : "CANCELLED";
    const data: Prisma.SurgeryUpdateInput = { status };
    if (action === "START") data.startedAt = now;
    if (action === "COMPLETE") { data.completedAt = now; if (s.recoveryStatus === "NOT_STARTED") data.recoveryStatus = "STABLE"; }
    if (action === "CANCEL" || action === "POSTPONE") { data.cancelReason = reason; if (action === "CANCEL") data.cancelledAt = now; }

    if (s.appointmentId) {
      await tx.appointment.update({
        where: { id: s.appointmentId },
        data: {
          status: apptStatus(status),
          ...(action === "START" ? { checkedInAt: now } : {}), ...(action === "COMPLETE" ? { completedAt: now } : {}),
          ...(action === "CANCEL" || action === "POSTPONE" ? { cancelledAt: now, cancelReason: `${action === "POSTPONE" ? "postponed" : "cancelled"}: ${reason}` } : {}),
        },
      });
    }
    const after = await tx.surgery.update({ where: { id }, data, include });
    if (action === "COMPLETE") {
      await markClientVisited(tx, tenantId, s.clientId, s.scheduledAt, s.surgeryType, ctx.user.id);
      await consumeForSurgery(tx, ctx, tenantId, s.id); // Phase 5: deduct linked supplies from stock
      for (const days of s.surgeonId ? followUpDays ?? [] : []) {
        const at = new Date(+s.scheduledAt + days * 86400000);
        at.setUTCHours(s.scheduledAt.getUTCHours() + 2, 0, 0, 0);
        await createReviewTx(tx, ctx, tenantId, {
          clientId: s.clientId, branchId: s.branchId, doctorId: s.surgeonId!, surgeryId: s.id, reasonType: "POST_OP",
          reason: `مراجعة بعد العملية (${days} يوم) — ${s.surgeryType}`, scheduledAt: at, durationMin: 20, skipConflicts: true,
        });
      }
    }
    await audit(tx, ctx, { action: `surgery.${action.toLowerCase()}`, entity: "Surgery", entityId: id, before: { status: s.status }, after: { status, reason, followUpDays } });
    return shape(after, ctx);
  });
}

// -------------------------------------------------------------- supplies ----

export const supplySchema = z.object({
  name: z.string().trim().min(1).max(160),
  quantity: z.coerce.number().positive().max(1e6),
  unitCost: z.coerce.number().min(0).max(1e9).default(0),
  notes: optText(300),
  /** Phase 5: stock item deducted when the surgery completes */
  itemId: uuidOpt,
});

export async function addSupply(ctx: Ctx, surgeryId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "surgeries.update");
  const d = supplySchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const s = await tx.surgery.findFirst({ where: { id: surgeryId, tenantId, ...recordBranchScope(ctx) } });
    if (!s) throw notFound("Surgery not found");
    if (s.status === "CANCELLED") throw conflict("Surgery is cancelled");
    const row = await tx.surgerySupply.create({ data: { ...d, tenantId, surgeryId } });
    await audit(tx, ctx, { action: "surgery.supply.add", entity: "SurgerySupply", entityId: row.id, after: row });
    return row;
  });
}

export async function deleteSupply(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "surgeries.update");
  return withTenant(tenantId, async (tx) => {
    const row = await tx.surgerySupply.findFirst({ where: { id, tenantId, surgery: recordBranchScope(ctx) } });
    if (!row) throw notFound("Supply not found");
    await tx.surgerySupply.delete({ where: { id } });
    await audit(tx, ctx, { action: "surgery.supply.delete", entity: "SurgerySupply", entityId: id, before: row });
    return { ok: true };
  });
}

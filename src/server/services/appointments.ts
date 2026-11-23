/**
 * Appointments & waitlist.
 * Double-booking of a staff member or room is prevented twice:
 *   1. findConflicts() gives a friendly 409 with the clashing booking;
 *   2. PostgreSQL EXCLUDE constraints reject any overlap that slips through
 *      (e.g. two receptionists booking the same slot at the same instant).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type AppointmentStatus } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { assertBranchAccess, optText, recordBranchScope, uuidOpt } from "./common";
import { servicePrice } from "./catalog";
import { addSession, validateProgramBooking } from "./programs";
import { addUsage, validateSubscriptionBooking } from "./subscriptions";
import { onAppointmentCreated } from "./messaging";
import { consumeForAppointment } from "./inventory";

const DAY_MS = 86_400_000;
const ACTIVE: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "COMPLETED"];

export const createAppointmentSchema = z.object({
  clientId: z.string().uuid(),
  branchId: uuidOpt,
  serviceId: uuidOpt,
  staffId: uuidOpt,
  roomId: uuidOpt,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional().nullable(),
  durationMin: z.coerce.number().int().min(5).max(24 * 60).optional().nullable(),
  status: z.enum(["SCHEDULED", "CONFIRMED"]).default("SCHEDULED"),
  notes: optText(2000),
  bookingSource: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  repeat: z.object({ frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]), count: z.coerce.number().int().min(2).max(52) }).optional().nullable(),
  /** Phase 3: charge the visit to a program session or a subscription */
  programItemId: uuidOpt,
  subscriptionId: uuidOpt,
});

export const updateAppointmentSchema = z.object({
  serviceId: uuidOpt.optional(),
  staffId: uuidOpt.optional(),
  roomId: uuidOpt.optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  notes: optText(2000).optional(),
});

export const statusSchema = z.object({
  status: z.enum(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"]),
  reason: z.string().trim().max(300).optional().nullable(),
});

/** Allowed workflow transitions. */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW", "COMPLETED"],
  CONFIRMED: ["SCHEDULED", "CHECKED_IN", "CANCELLED", "NO_SHOW", "COMPLETED"],
  CHECKED_IN: ["COMPLETED", "CANCELLED", "CONFIRMED"],
  COMPLETED: [],
  CANCELLED: ["SCHEDULED"],
  NO_SHOW: ["SCHEDULED"],
};

const include = {
  programItem: { select: { id: true, program: { select: { id: true, code: true, name: true } } } },
  subscription: { select: { id: true, code: true, name: true } },
  surgery: { select: { id: true, code: true } },
  review: { select: { id: true } },
  client: { select: { id: true, code: true, fullName: true, phone: true } },
  service: { select: { id: true, name: true, color: true, kind: true } },
  staff: { select: { id: true, fullName: true } },
  room: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
} satisfies Prisma.AppointmentInclude;

type Slot = { staffId: string | null; roomId: string | null; startsAt: Date; endsAt: Date };

export async function findConflicts(tx: Tx, tenantId: string, s: Slot, excludeId?: string) {
  if (!s.staffId && !s.roomId) return [];
  return tx.appointment.findMany({
    where: {
      tenantId, status: { in: ACTIVE }, startsAt: { lt: s.endsAt }, endsAt: { gt: s.startsAt },
      OR: [...(s.staffId ? [{ staffId: s.staffId }] : []), ...(s.roomId ? [{ roomId: s.roomId }] : [])],
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    include: { client: { select: { fullName: true } }, staff: { select: { fullName: true } }, room: { select: { name: true } } },
    take: 3,
  });
}

export function conflictError(c: Awaited<ReturnType<typeof findConflicts>>[number], s: Slot, suggestions: string[] = []) {
  const byStaff = !!(c.staffId && c.staffId === s.staffId);
  const who = byStaff ? c.staff?.fullName : c.room?.name;
  return new AppError(409, "SLOT_CONFLICT", `Time slot conflicts with another booking for ${who ?? "this resource"} (${c.client.fullName})`, {
    conflictId: c.id, startsAt: c.startsAt, endsAt: c.endsAt,
    who: who ?? null, whoKind: byStaff ? "staff" : "room", clientName: c.client.fullName,
    suggestions,
  });
}

/**
 * Nearest free start times for the same staff member / room and the same
 * duration: 15-minute grid, closest first on the same day (07:00-22:00 in the
 * clinic's timezone), then the next days. Never suggests a time in the past
 * unless the request itself was in the past (recording an earlier visit).
 */
export async function suggestSlots(tx: Tx, tenantId: string, s: Slot, excludeId?: string, max = 4): Promise<string[]> {
  if (!s.staffId && !s.roomId) return [];
  const dur = +s.endsAt - +s.startsAt;
  const step = 15 * 60000;
  const tz = (await tx.tenant.findFirst({ where: { id: tenantId }, select: { timezone: true } }))?.timezone || "Asia/Baghdad";
  const from = new Date(+s.startsAt - DAY_MS), to = new Date(+s.startsAt + 4 * DAY_MS);
  const busy = await tx.appointment.findMany({
    where: {
      tenantId, status: { in: ACTIVE }, startsAt: { lt: to }, endsAt: { gt: from },
      OR: [...(s.staffId ? [{ staffId: s.staffId }] : []), ...(s.roomId ? [{ roomId: s.roomId }] : [])],
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { startsAt: true, endsAt: true },
  });
  let fmt: Intl.DateTimeFormat;
  try { fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  catch { fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  const local = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) + Number(p.minute) / 60 };
  };
  const now = Date.now();
  const allowPast = +s.startsAt < now - 60 * 60000;
  const free = (t: number) => {
    if (!allowPast && t < now) return false;
    const a = local(t), b = local(t + dur);
    if (a.day !== b.day || a.hour < 7 || b.hour > 22) return false;
    return !busy.some((x) => +x.startsAt < t + dur && +x.endsAt > t);
  };
  const base = Math.round(+s.startsAt / step) * step;
  const sameDay = local(+s.startsAt).day;
  // Same day: the closest free times before AND after the requested one,
  // so the receptionist can offer "a bit earlier" or "a bit later".
  const before: number[] = [], after: number[] = [];
  for (let k = 1; k <= 64; k++) {
    const a = base + k * step, b = base - k * step;
    if (after.length < max && local(a).day === sameDay && free(a)) after.push(a);
    if (before.length < max && local(b).day === sameDay && free(b)) before.push(b);
  }
  const half = Math.ceil(max / 2);
  const out = [...after.slice(0, half), ...before.slice(0, half)];
  for (const t of [...after.slice(half), ...before.slice(half)]) if (out.length < max) out.push(t);
  // Not enough that day: the earliest free times on the next days.
  for (let t = base + step; out.length < max && t < +to; t += step) {
    if (local(t).day !== sameDay && free(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, max).sort((a, b) => a - b).map((t) => new Date(t).toISOString());
}

/** conflictError plus the nearest free times, for booking forms. */
export async function conflictWithSuggestions(tx: Tx, tenantId: string, c: Awaited<ReturnType<typeof findConflicts>>[number], s: Slot, excludeId?: string) {
  let suggestions: string[] = [];
  try { suggestions = await suggestSlots(tx, tenantId, s, excludeId); } catch { /* suggestions are a convenience */ }
  return conflictError(c, s, suggestions);
}

async function validateResources(tx: Tx, tenantId: string, branchId: string, d: { serviceId?: string | null; staffId?: string | null; roomId?: string | null }) {
  let service = null;
  if (d.serviceId) {
    service = await tx.service.findFirst({ where: { id: d.serviceId, tenantId }, include: { staff: { select: { userId: true } } } });
    if (!service || !service.isActive) throw badRequest("Service not found or inactive");
  }
  if (d.staffId) {
    const staff = await tx.user.findFirst({ where: { id: d.staffId, tenantId, status: "ACTIVE" }, include: { branchAccess: true } });
    if (!staff) throw badRequest("Staff member not found");
    if (!staff.allBranches && !staff.branchAccess.some((b) => b.branchId === branchId)) throw badRequest("This staff member doesn't work in this branch");
    if (service && service.staff.length && !service.staff.some((x) => x.userId === d.staffId)) {
      throw badRequest("This staff member is not qualified for the selected service");
    }
  }
  if (d.roomId) {
    const room = await tx.room.findFirst({ where: { id: d.roomId, tenantId, branchId, isActive: true } });
    if (!room) throw badRequest("Room not found in this branch");
  }
  return service;
}

function addInterval(d: Date, f: "DAILY" | "WEEKLY" | "MONTHLY", n: number) {
  const x = new Date(d);
  if (f === "DAILY") x.setDate(x.getDate() + n);
  else if (f === "WEEKLY") x.setDate(x.getDate() + 7 * n);
  else x.setMonth(x.getMonth() + n);
  return x;
}

// ----------------------------------------------------------------- read ----

export async function listAppointments(ctx: Ctx, q: { from: string; to: string; branchId?: string; staffId?: string; roomId?: string; clientId?: string; status?: string }) {
  const tenantId = requireTenant(ctx, "appointments.view");
  const from = new Date(q.from), to = new Date(q.to);
  if (isNaN(+from) || isNaN(+to) || to <= from) throw badRequest("Invalid date range");
  if (+to - +from > 93 * 86400000) throw badRequest("Range too large (max 93 days)");
  const where: Prisma.AppointmentWhereInput = {
    tenantId, startsAt: { lt: to }, endsAt: { gt: from }, ...recordBranchScope(ctx),
    ...(q.staffId ? { staffId: q.staffId } : {}), ...(q.roomId ? { roomId: q.roomId } : {}), ...(q.clientId ? { clientId: q.clientId } : {}),
    ...(q.status ? { status: q.status as AppointmentStatus } : {}),
  };
  if (q.branchId) where.AND = [{ branchId: q.branchId }];
  return withTenant(tenantId, (tx) => tx.appointment.findMany({ where, include, orderBy: { startsAt: "asc" }, take: 3000 }));
}

export async function clientAppointments(ctx: Ctx, clientId: string) {
  const tenantId = requireTenant(ctx, "appointments.view");
  return withTenant(tenantId, (tx) =>
    tx.appointment.findMany({ where: { tenantId, clientId, ...recordBranchScope(ctx) }, include, orderBy: { startsAt: "desc" }, take: 300 }),
  );
}

// ---------------------------------------------------------------- write ----

export async function createAppointment(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "appointments.create");
  const d = createAppointmentSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const client = await tx.client.findFirst({ where: { id: d.clientId, tenantId, deletedAt: null, ...recordBranchScope(ctx) } });
    if (!client) throw badRequest("Client not found");
    if (client.status === "BLOCKED") throw conflict("This client is blocked");
    const branchId = d.branchId ?? client.branchId;
    assertBranchAccess(ctx, branchId);
    if (!(await tx.branch.findFirst({ where: { id: branchId, tenantId, isActive: true } }))) throw badRequest("Branch not found or inactive");
    if (d.programItemId && d.subscriptionId) throw badRequest("Charge the visit to a program or a subscription, not both");
    if (d.programItemId) {
      // Program sessions are for the program's service.
      const v = await validateProgramBooking(tx, tenantId, d.clientId, d.programItemId, 1);
      if (d.serviceId && d.serviceId !== v.serviceId) throw badRequest("Service doesn't match the program session");
      d.serviceId = v.serviceId;
    }
    const service = await validateResources(tx, tenantId, branchId, d);

    const minutes = d.endsAt ? (+d.endsAt - +d.startsAt) / 60000 : d.durationMin ?? service?.durationMin ?? 30;
    if (minutes < 5) throw badRequest("End time must be after start time");
    // Prepaid visits (program / subscription) carry no per-visit price.
    const price = d.programItemId || d.subscriptionId ? null : d.serviceId ? await servicePrice(tx, d.serviceId, branchId) : null;
    const count = d.repeat?.count ?? 1;
    const recurrenceGroupId = count > 1 ? randomUUID() : null;

    const created = [];
    for (let i = 0; i < count; i++) {
      const startsAt = i === 0 ? d.startsAt : addInterval(d.startsAt, d.repeat!.frequency, i);
      const slot = { staffId: d.staffId, roomId: d.roomId, startsAt, endsAt: new Date(+startsAt + minutes * 60000) };
      const clash = await findConflicts(tx, tenantId, slot);
      if (clash.length) throw await conflictWithSuggestions(tx, tenantId, clash[0], slot);
      // Balance is re-checked per occurrence: earlier ones in this series are already reserved.
      if (d.programItemId && i > 0) await validateProgramBooking(tx, tenantId, d.clientId, d.programItemId, 1);
      if (d.subscriptionId) await validateSubscriptionBooking(tx, tenantId, d.clientId, d.subscriptionId, d.serviceId ?? null, slot.startsAt, 1);
      created.push(await tx.appointment.create({
        data: {
          programItemId: d.programItemId, subscriptionId: d.subscriptionId,
          tenantId, branchId, clientId: d.clientId, serviceId: d.serviceId, staffId: d.staffId, roomId: d.roomId,
          startsAt: slot.startsAt, endsAt: slot.endsAt, status: d.status, price, notes: d.notes, bookingSource: d.bookingSource,
          recurrenceGroupId, confirmedAt: d.status === "CONFIRMED" ? new Date() : null, createdById: ctx.user.id,
        },
        include,
      }));
    }
    await tx.clientInteraction.create({
      data: { tenantId, clientId: d.clientId, type: "SYSTEM", userId: ctx.user.id,
        content: `appointment.booked:${service?.name ?? "-"}:${d.startsAt.toISOString()}${count > 1 ? `:x${count}` : ""}` },
    });
    await audit(tx, ctx, { action: "appointment.create", entity: "Appointment", entityId: created[0].id, after: { ...created[0], occurrences: count } });
    await onAppointmentCreated(tx, ctx, tenantId, created[0].id); // Phase 6: confirmation + staff notification
    return count > 1 ? { items: created, recurrenceGroupId } : created[0];
  });
}

export async function updateAppointment(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "appointments.update");
  const d = updateAppointmentSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.appointment.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!before) throw notFound("Appointment not found");
    await assertNotManaged(tx, id);
    if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(before.status) && (d.startsAt || d.endsAt || d.staffId !== undefined || d.roomId !== undefined)) {
      throw conflict("Closed appointments can't be rescheduled");
    }
    const next = {
      serviceId: d.serviceId !== undefined ? d.serviceId : before.serviceId,
      staffId: d.staffId !== undefined ? d.staffId : before.staffId,
      roomId: d.roomId !== undefined ? d.roomId : before.roomId,
      startsAt: d.startsAt ?? before.startsAt,
      endsAt: d.endsAt ?? (d.startsAt ? new Date(+d.startsAt + (+before.endsAt - +before.startsAt)) : before.endsAt),
    };
    if (next.endsAt <= next.startsAt) throw badRequest("End time must be after start time");
    if (before.programItemId && next.serviceId !== before.serviceId) throw conflict("A program session's service can't be changed");
    if (before.subscriptionId && +next.startsAt !== +before.startsAt) {
      await validateSubscriptionBooking(tx, tenantId, before.clientId, before.subscriptionId, next.serviceId, next.startsAt, 1, id);
    }
    await validateResources(tx, tenantId, before.branchId, {
      serviceId: d.serviceId !== undefined ? next.serviceId : undefined, staffId: next.staffId, roomId: next.roomId,
    });
    const clash = await findConflicts(tx, tenantId, next, id);
    if (clash.length) throw await conflictWithSuggestions(tx, tenantId, clash[0], next, id);
    const price = next.serviceId && next.serviceId !== before.serviceId ? await servicePrice(tx, next.serviceId, before.branchId) : undefined;
    const after = await tx.appointment.update({ where: { id }, data: { ...next, ...(price !== undefined ? { price } : {}), ...(d.notes !== undefined ? { notes: d.notes } : {}) }, include });
    const rescheduled = +next.startsAt !== +before.startsAt;
    if (rescheduled) {
      await tx.clientInteraction.create({ data: { tenantId, clientId: before.clientId, type: "SYSTEM", userId: ctx.user.id, content: `appointment.rescheduled:${next.startsAt.toISOString()}` } });
    }
    await audit(tx, ctx, { action: rescheduled ? "appointment.reschedule" : "appointment.update", entity: "Appointment", entityId: id, before, after });
    return after;
  });
}

/** Visit side effects shared by appointments, surgeries and reviews. */
export async function markClientVisited(tx: Tx, tenantId: string, clientId: string, at: Date, label: string, userId: string) {
  const c = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
  await tx.client.update({
    where: { id: c.id },
    data: { lastVisitAt: at > (c.lastVisitAt ?? new Date(0)) ? at : c.lastVisitAt,
      ...(c.status === "LEAD" || c.status === "INACTIVE" ? { status: "ACTIVE", convertedAt: c.convertedAt ?? new Date() } : {}) },
  });
  await tx.clientInteraction.create({ data: { tenantId, clientId, type: "VISIT", userId, content: `visit.completed:${label}` } });
}

/** Surgery/review slots are driven from their own pages, not the calendar. */
async function assertNotManaged(tx: Tx, id: string) {
  const [s, r] = await Promise.all([tx.surgery.findFirst({ where: { appointmentId: id }, select: { code: true } }), tx.medicalReview.findFirst({ where: { appointmentId: id }, select: { id: true } })]);
  if (s) throw new AppError(409, "MANAGED_BY_SURGERY", `This slot belongs to surgery ${s.code} — manage it from the surgeries page`);
  if (r) throw new AppError(409, "MANAGED_BY_REVIEW", "This slot belongs to a medical review — manage it from the reviews page");
}

export async function setAppointmentStatus(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "appointments.update");
  const { status, reason } = statusSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.appointment.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) }, include: { service: true } });
    if (!before) throw notFound("Appointment not found");
    await assertNotManaged(tx, id);
    if (before.status === status) return tx.appointment.findUniqueOrThrow({ where: { id }, include });
    if (!TRANSITIONS[before.status].includes(status)) throw conflict(`Cannot change status from ${before.status} to ${status}`);
    if (status === "CANCELLED" && !reason) throw badRequest("Cancellation reason is required");
    // A visit can't be checked-in/completed (or missed) before it happens. 2h grace for early arrivals.
    const early = +before.startsAt - Date.now();
    if ((status === "CHECKED_IN" || status === "COMPLETED") && early > 2 * 3600000) throw conflict("This appointment hasn't started yet");
    if (status === "NO_SHOW" && early > 0) throw conflict("Can't mark a future appointment as no-show");
    if (status === "SCHEDULED" && ["CANCELLED", "NO_SHOW"].includes(before.status)) {
      const clash = await findConflicts(tx, tenantId, before, id);
      if (clash.length) throw conflictError(clash[0], before);
    }
    const now = new Date();
    const stamp: Prisma.AppointmentUpdateInput =
      status === "CONFIRMED" ? { confirmedAt: now } :
      status === "CHECKED_IN" ? { checkedInAt: now } :
      status === "COMPLETED" ? { completedAt: now } :
      status === "CANCELLED" ? { cancelledAt: now, cancelReason: reason } : {};
    const after = await tx.appointment.update({ where: { id }, data: { status, ...stamp }, include });

    if (status === "COMPLETED") {
      await markClientVisited(tx, tenantId, before.clientId, before.startsAt, before.service?.name ?? "-", ctx.user.id);
      await consumeForAppointment(tx, ctx, tenantId, before); // Phase 5: deduct service materials
      // Phase 3: consume a program session / subscription visit
      if (before.programItemId) {
        await addSession(tx, tenantId, before.programItemId, { performedAt: before.startsAt, performedById: before.staffId, appointmentId: id });
      }
      if (before.subscriptionId) {
        await addUsage(tx, tenantId, before.subscriptionId, { serviceId: before.serviceId, usedAt: before.startsAt, appointmentId: id, recordedById: ctx.user.id });
      }
    } else if (status === "CANCELLED" || status === "NO_SHOW") {
      await tx.clientInteraction.create({ data: { tenantId, clientId: before.clientId, type: "SYSTEM", userId: ctx.user.id, content: `appointment.${status.toLowerCase()}${reason ? `:${reason}` : ""}` } });
    }
    await audit(tx, ctx, { action: `appointment.status.${status.toLowerCase()}`, entity: "Appointment", entityId: id, before: { status: before.status }, after: { status, reason } });
    return after;
  });
}

export async function deleteAppointment(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "appointments.delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.appointment.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!before) throw notFound("Appointment not found");
    await assertNotManaged(tx, id);
    if (before.status === "COMPLETED") throw conflict("Completed visits can't be deleted");
    await tx.appointment.delete({ where: { id } });
    await audit(tx, ctx, { action: "appointment.delete", entity: "Appointment", entityId: id, before });
    return { ok: true };
  });
}

// ------------------------------------------------------------- waitlist ----

export const waitlistSchema = z.object({
  clientId: z.string().uuid(),
  branchId: uuidOpt,
  serviceId: uuidOpt,
  staffId: uuidOpt,
  preferredDate: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)),
  preferredTime: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  notes: optText(500),
});

export async function listWaitlist(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "appointments.view");
  return withTenant(tenantId, (tx) =>
    tx.waitlistEntry.findMany({
      where: { tenantId, status: "WAITING", ...recordBranchScope(ctx) },
      include: { client: { select: { id: true, fullName: true, phone: true } }, service: { select: { name: true } }, staff: { select: { fullName: true } }, branch: { select: { name: true } } },
      orderBy: [{ preferredDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    }),
  );
}

export async function addWaitlist(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "appointments.create");
  const d = waitlistSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const client = await tx.client.findFirst({ where: { id: d.clientId, tenantId, deletedAt: null, ...recordBranchScope(ctx) } });
    if (!client) throw badRequest("Client not found");
    const branchId = d.branchId ?? client.branchId;
    assertBranchAccess(ctx, branchId);
    const w = await tx.waitlistEntry.create({ data: { ...d, branchId, tenantId } });
    await audit(tx, ctx, { action: "waitlist.add", entity: "WaitlistEntry", entityId: w.id, after: w });
    return w;
  });
}

export async function setWaitlistStatus(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "appointments.update");
  const { status } = z.object({ status: z.enum(["WAITING", "BOOKED", "REMOVED"]) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.waitlistEntry.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!before) throw notFound("Waitlist entry not found");
    const after = await tx.waitlistEntry.update({ where: { id }, data: { status } });
    await audit(tx, ctx, { action: `waitlist.${status.toLowerCase()}`, entity: "WaitlistEntry", entityId: id, before, after });
    return after;
  });
}

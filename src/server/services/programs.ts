/**
 * Treatment programs (البرامج العلاجية).
 * Template → assigned to a client as a ClientProgram with item snapshots.
 * Sessions are consumed when a linked appointment is completed (see
 * appointments.setAppointmentStatus) or recorded manually.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import {
  ACTIVE_APPT, addDaysUTC, assertBranchAccess, calendarDaysBetween, canSeeClinical, nextCounter, optText, recordBranchScope, requireClient, requireStaff, todayDate, uuidOpt,
} from "./common";

const money = z.coerce.number().min(0).max(1e10);
const itemSchema = z.object({ serviceId: z.string().uuid(), sessions: z.coerce.number().int().min(1).max(200) });
const items = z.array(itemSchema).min(1).max(30).refine((a) => new Set(a.map((x) => x.serviceId)).size === a.length, "Each service once");

export const templateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  nameEn: z.string().trim().max(160).optional().nullable().transform((v) => v || null),
  description: optText(2000),
  price: money,
  validityDays: z.coerce.number().int().min(1).max(3650).optional().nullable().or(z.literal("").transform(() => null)),
  intervalDays: z.coerce.number().int().min(1).max(365).optional().nullable().or(z.literal("").transform(() => null)),
  isActive: z.boolean().default(true),
  items,
});

export const assignSchema = z.object({
  clientId: z.string().uuid(),
  templateId: uuidOpt,
  name: z.string().trim().min(2).max(160).optional(),
  price: money.optional(),
  items: items.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional().nullable(),
  intervalDays: z.coerce.number().int().min(1).max(365).optional().nullable(),
  doctorId: uuidOpt,
  branchId: uuidOpt,
  notes: optText(2000),
});

const tplInclude = { items: { include: { service: { select: { id: true, name: true, durationMin: true } } } }, _count: { select: { programs: true } } } satisfies Prisma.ProgramTemplateInclude;

async function checkServices(tx: Tx, tenantId: string, ids: string[]) {
  if ((await tx.service.count({ where: { tenantId, id: { in: ids } } })) !== new Set(ids).size) throw badRequest("Service not found");
}

// ------------------------------------------------------------ templates ----

export async function listTemplates(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "programs.view");
  return withTenant(tenantId, (tx) => tx.programTemplate.findMany({ where: { tenantId }, include: tplInclude, orderBy: { name: "asc" } }));
}

export async function createTemplate(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "programs.create");
  const { items: its, ...d } = templateSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await checkServices(tx, tenantId, its.map((i) => i.serviceId));
    const t = await tx.programTemplate.create({ data: { ...d, tenantId, items: { create: its.map((i) => ({ ...i, tenantId })) } }, include: tplInclude });
    await audit(tx, ctx, { action: "program_template.create", entity: "ProgramTemplate", entityId: t.id, after: t });
    return t;
  });
}

export async function updateTemplate(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "programs.update");
  const { items: its, ...d } = templateSchema.partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.programTemplate.findFirst({ where: { id, tenantId }, include: tplInclude });
    if (!before) throw notFound("Program template not found");
    if (its) {
      await checkServices(tx, tenantId, its.map((i) => i.serviceId));
      // Already-sold programs keep their own item snapshot — safe to replace.
      await tx.programTemplateItem.deleteMany({ where: { tenantId, templateId: id } });
      await tx.programTemplateItem.createMany({ data: its.map((i) => ({ ...i, tenantId, templateId: id })) });
    }
    const after = await tx.programTemplate.update({ where: { id }, data: d, include: tplInclude });
    await audit(tx, ctx, { action: "program_template.update", entity: "ProgramTemplate", entityId: id, before, after });
    return after;
  });
}

export async function deleteTemplate(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "programs.delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.programTemplate.findFirst({ where: { id, tenantId }, include: tplInclude });
    if (!before) throw notFound("Program template not found");
    if (before._count.programs) throw conflict("This template was assigned to clients — deactivate it instead");
    await tx.programTemplate.delete({ where: { id } });
    await audit(tx, ctx, { action: "program_template.delete", entity: "ProgramTemplate", entityId: id, before });
    return { ok: true };
  });
}

// ------------------------------------------------------- client programs ----

const progInclude = {
  client: { select: { id: true, code: true, fullName: true, phone: true } },
  doctor: { select: { id: true, fullName: true } },
  branch: { select: { id: true, name: true } },
  items: {
    include: {
      service: { select: { id: true, name: true, durationMin: true } },
      _count: { select: { sessions: true } },
      appointments: { where: { status: { in: [...ACTIVE_APPT] } }, select: { id: true, startsAt: true, status: true }, orderBy: { startsAt: "asc" as const } },
    },
  },
  sessions: { orderBy: { performedAt: "desc" as const }, take: 1, select: { performedAt: true } },
} satisfies Prisma.ClientProgramInclude;

type ProgRow = Prisma.ClientProgramGetPayload<{ include: typeof progInclude }>;

function shape(p: ProgRow, ctx: Ctx) {
  const its = p.items.map(({ _count, appointments, ...i }) => ({
    ...i, used: _count.sessions, booked: appointments.length, remaining: Math.max(0, i.sessionsTotal - _count.sessions),
    nextAppointment: appointments[0] ?? null,
  }));
  const total = its.reduce((s, i) => s + i.sessionsTotal, 0);
  const used = its.reduce((s, i) => s + i.used, 0);
  const lastSessionAt = p.sessions[0]?.performedAt ?? null;
  const ref = lastSessionAt ?? p.startDate;
  const stalled = p.status === "ACTIVE" && used < total && Date.now() - +ref > 30 * 86400000 && !its.some((i) => i.booked);
  const { sessions: _s, ...rest } = p;
  return {
    ...rest, results: canSeeClinical(ctx) ? p.results : null, items: its,
    progress: { total, used, remaining: total - used, percent: total ? Math.round((used / total) * 100) : 0 }, lastSessionAt, stalled,
  };
}

/** Lazily flips programs past their end date to EXPIRED. */
async function refreshExpired(tx: Tx, tenantId: string) {
  await tx.clientProgram.updateMany({ where: { tenantId, status: { in: ["ACTIVE", "PAUSED"] }, endDate: { lt: todayDate() } }, data: { status: "EXPIRED" } });
}

export async function listPrograms(ctx: Ctx, q: { status?: string; stalled?: boolean; clientId?: string; search?: string } = {}) {
  const tenantId = requireTenant(ctx, "programs.view");
  return withTenant(tenantId, async (tx) => {
    await refreshExpired(tx, tenantId);
    const where: Prisma.ClientProgramWhereInput = { tenantId, ...recordBranchScope(ctx) };
    if (q.status && ["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "EXPIRED"].includes(q.status)) where.status = q.status as never;
    if (q.stalled) where.status = "ACTIVE";
    if (q.clientId) where.clientId = q.clientId;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: "insensitive" } }, { code: q.search.toUpperCase() }, { client: { fullName: { contains: q.search, mode: "insensitive" } } }];
    const rows = await tx.clientProgram.findMany({ where, include: progInclude, orderBy: { createdAt: "desc" }, take: 500 });
    const out = rows.map((r) => shape(r, ctx));
    return q.stalled ? out.filter((r) => r.stalled) : out;
  });
}

export async function getProgram(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "programs.view");
  return withTenant(tenantId, async (tx) => {
    await refreshExpired(tx, tenantId);
    const p = await tx.clientProgram.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) }, include: progInclude });
    if (!p) throw notFound("Program not found");
    const clinical = canSeeClinical(ctx);
    const sessions = await tx.programSession.findMany({
      where: { tenantId, clientProgramId: id }, orderBy: [{ performedAt: "desc" }],
      include: { item: { select: { service: { select: { name: true } } } }, appointment: { select: { id: true, staff: { select: { fullName: true } } } } },
    });
    const performers = await tx.user.findMany({ where: { tenantId, id: { in: sessions.map((s) => s.performedById).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
    const reviews = await tx.medicalReview.findMany({ where: { tenantId, clientProgramId: id }, select: { id: true, scheduledAt: true, status: true, reason: true }, orderBy: { scheduledAt: "desc" } });
    return {
      ...shape(p, ctx),
      sessions: sessions.map((s) => ({
        ...s, notes: clinical ? s.notes : null, result: clinical ? s.result : null,
        performedBy: performers.find((u) => u.id === s.performedById)?.fullName ?? s.appointment?.staff?.fullName ?? null,
      })),
      reviews,
    };
  });
}

export async function assignProgram(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "programs.create");
  const d = assignSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const client = await requireClient(tx, ctx, tenantId, d.clientId, 400);
    const tpl = d.templateId ? await tx.programTemplate.findFirst({ where: { id: d.templateId, tenantId }, include: { items: true } }) : null;
    if (d.templateId && (!tpl || !tpl.isActive)) throw badRequest("Program template not found or inactive");
    const its = d.items ?? tpl?.items.map((i) => ({ serviceId: i.serviceId, sessions: i.sessions }));
    if (!its?.length) throw badRequest("A program needs at least one service");
    await checkServices(tx, tenantId, its.map((i) => i.serviceId));
    const branchId = d.branchId ?? client.branchId;
    assertBranchAccess(ctx, branchId);
    if (d.doctorId) await requireStaff(tx, tenantId, d.doctorId, branchId);
    const startDate = d.startDate ?? todayDate();
    const endDate = d.endDate !== undefined ? d.endDate : tpl?.validityDays ? addDaysUTC(startDate, tpl.validityDays) : null;
    const code = `P-${String(await nextCounter(tx, tenantId, "program")).padStart(6, "0")}`;
    const p = await tx.clientProgram.create({
      data: {
        tenantId, code, clientId: d.clientId, branchId, templateId: tpl?.id ?? null, doctorId: d.doctorId,
        name: d.name ?? tpl?.name ?? "برنامج علاجي", price: d.price ?? tpl?.price ?? 0, startDate, endDate,
        intervalDays: d.intervalDays ?? tpl?.intervalDays ?? null, notes: d.notes, createdById: ctx.user.id,
        items: { create: its.map((i) => ({ tenantId, serviceId: i.serviceId, sessionsTotal: i.sessions })) },
      },
      include: progInclude,
    });
    await tx.clientInteraction.create({ data: { tenantId, clientId: d.clientId, type: "SYSTEM", userId: ctx.user.id, content: `program.assigned:${p.name}` } });
    await audit(tx, ctx, { action: "program.assign", entity: "ClientProgram", entityId: p.id, after: { code, name: p.name, clientId: d.clientId, items: its, price: p.price } });
    return shape(p, ctx);
  });
}

export const updateProgramSchema = z.object({
  name: z.string().trim().min(2).max(160),
  doctorId: uuidOpt,
  endDate: z.coerce.date().nullable().or(z.literal("").transform(() => null)),
  intervalDays: z.coerce.number().int().min(1).max(365).nullable().or(z.literal("").transform(() => null)),
  notes: optText(2000),
  results: optText(4000),
}).partial();

export async function updateProgram(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "programs.update");
  const d = updateProgramSchema.parse(raw);
  if (d.results !== undefined && !canSeeClinical(ctx)) delete d.results;
  return withTenant(tenantId, async (tx) => {
    const before = await tx.clientProgram.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!before) throw notFound("Program not found");
    if (d.doctorId) await requireStaff(tx, tenantId, d.doctorId, before.branchId);
    const after = await tx.clientProgram.update({ where: { id }, data: d });
    await audit(tx, ctx, { action: "program.update", entity: "ClientProgram", entityId: id, after: { changedFields: Object.keys(d) } });
    return after;
  });
}

export async function setProgramStatus(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "programs.update");
  const { action, reason } = z.object({ action: z.enum(["PAUSE", "RESUME", "CANCEL", "COMPLETE"]), reason: z.string().trim().max(300).optional() }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const p = await tx.clientProgram.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!p) throw notFound("Program not found");
    const now = new Date();
    let data: Prisma.ClientProgramUpdateInput;
    if (action === "PAUSE") {
      if (p.status !== "ACTIVE") throw conflict("Only active programs can be paused");
      data = { status: "PAUSED", pausedAt: now };
    } else if (action === "RESUME") {
      if (p.status !== "PAUSED") throw conflict("Program is not paused");
      // The paused time doesn't count against the validity period.
      const pausedDays = p.pausedAt ? calendarDaysBetween(p.pausedAt, now) : 0;
      data = { status: "ACTIVE", pausedAt: null, ...(p.endDate ? { endDate: addDaysUTC(p.endDate, pausedDays) } : {}) };
    } else if (action === "CANCEL") {
      if (["COMPLETED", "CANCELLED"].includes(p.status)) throw conflict("Program is already closed");
      if (!reason) throw badRequest("Cancellation reason is required");
      data = { status: "CANCELLED", cancelledAt: now, cancelReason: reason };
      await cancelLinkedAppointments(tx, tenantId, { programItem: { clientProgramId: id } }, `program cancelled: ${reason}`);
    } else {
      if (!["ACTIVE", "PAUSED", "EXPIRED"].includes(p.status)) throw conflict("Program can't be completed from this status");
      data = { status: "COMPLETED", completedAt: now };
    }
    const after = await tx.clientProgram.update({ where: { id }, data });
    await audit(tx, ctx, { action: `program.${action.toLowerCase()}`, entity: "ClientProgram", entityId: id, before: { status: p.status }, after: { status: after.status, reason } });
    return after;
  });
}

async function cancelLinkedAppointments(tx: Tx, tenantId: string, where: Prisma.AppointmentWhereInput, reason: string) {
  await tx.appointment.updateMany({
    where: { tenantId, ...where, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gte: new Date() } },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.slice(0, 300) },
  });
}

export async function renewProgram(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "programs.create");
  const d = z.object({ startDate: z.coerce.date().optional(), price: money.optional() }).parse(raw ?? {});
  return withTenant(tenantId, async (tx) => {
    const old = await tx.clientProgram.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) }, include: { items: true, template: true } });
    if (!old) throw notFound("Program not found");
    const startDate = d.startDate ?? todayDate();
    const validity = old.template?.validityDays ?? (old.endDate ? Math.round((+old.endDate - +old.startDate) / 86400000) : null);
    const code = `P-${String(await nextCounter(tx, tenantId, "program")).padStart(6, "0")}`;
    const p = await tx.clientProgram.create({
      data: {
        tenantId, code, clientId: old.clientId, branchId: old.branchId, templateId: old.templateId, doctorId: old.doctorId, name: old.name,
        price: d.price ?? old.price, startDate, endDate: validity ? addDaysUTC(startDate, validity) : null, intervalDays: old.intervalDays,
        renewedFromId: old.id, createdById: ctx.user.id,
        items: { create: old.items.map((i) => ({ tenantId, serviceId: i.serviceId, sessionsTotal: i.sessionsTotal })) },
      },
      include: progInclude,
    });
    if (["ACTIVE", "PAUSED", "EXPIRED"].includes(old.status)) await tx.clientProgram.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await tx.clientInteraction.create({ data: { tenantId, clientId: old.clientId, type: "SYSTEM", userId: ctx.user.id, content: `program.renewed:${old.name}` } });
    await audit(tx, ctx, { action: "program.renew", entity: "ClientProgram", entityId: p.id, before: { from: old.code }, after: { code } });
    return shape(p, ctx);
  });
}

// -------------------------------------------------------------- sessions ----

export const sessionSchema = z.object({
  itemId: z.string().uuid(),
  performedAt: z.coerce.date().default(() => new Date()),
  performedById: uuidOpt,
  notes: optText(4000),
  result: optText(2000),
});

/** Shared by manual recording and appointment completion. */
export async function addSession(tx: Tx, tenantId: string, itemId: string, data: { performedAt: Date; performedById?: string | null; appointmentId?: string | null; notes?: string | null; result?: string | null }) {
  const item = await tx.clientProgramItem.findFirst({ where: { id: itemId, tenantId }, include: { program: true, _count: { select: { sessions: true } } } });
  if (!item) throw badRequest("Program item not found");
  if (item.program.status !== "ACTIVE") throw conflict(`Program is ${item.program.status.toLowerCase()}`);
  if (item._count.sessions >= item.sessionsTotal) throw conflict("All sessions of this service are already used");
  const s = await tx.programSession.create({
    data: { tenantId, clientProgramId: item.clientProgramId, itemId, sessionNo: item._count.sessions + 1, ...data },
  });
  // Auto-complete the program when every item is fully used.
  const all = await tx.clientProgramItem.findMany({ where: { clientProgramId: item.clientProgramId }, include: { _count: { select: { sessions: true } } } });
  if (all.every((i) => i._count.sessions >= i.sessionsTotal)) {
    await tx.clientProgram.update({ where: { id: item.clientProgramId }, data: { status: "COMPLETED", completedAt: new Date() } });
  }
  return s;
}

export async function recordSession(ctx: Ctx, programId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "programs.update");
  const d = sessionSchema.parse(raw);
  if (!canSeeClinical(ctx)) { d.notes = null; d.result = null; }
  return withTenant(tenantId, async (tx) => {
    const p = await tx.clientProgram.findFirst({ where: { id: programId, tenantId, ...recordBranchScope(ctx) }, include: { items: { select: { id: true } } } });
    if (!p) throw notFound("Program not found");
    if (!p.items.some((i) => i.id === d.itemId)) throw badRequest("Item doesn't belong to this program");
    if (d.performedAt > new Date(Date.now() + 3600000)) throw badRequest("A session can't be recorded in the future");
    const s = await addSession(tx, tenantId, d.itemId, { performedAt: d.performedAt, performedById: d.performedById ?? ctx.user.id, notes: d.notes, result: d.result });
    await audit(tx, ctx, { action: "program.session.record", entity: "ProgramSession", entityId: s.id, after: { programId, itemId: d.itemId, sessionNo: s.sessionNo } });
    return s;
  });
}

export async function updateSession(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "programs.update");
  if (!canSeeClinical(ctx)) throw badRequest("Session notes require the 'view medical data' permission");
  const d = z.object({ notes: optText(4000), result: optText(2000) }).partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const s = await tx.programSession.findFirst({ where: { id, tenantId, program: recordBranchScope(ctx) } });
    if (!s) throw notFound("Session not found");
    const after = await tx.programSession.update({ where: { id }, data: d });
    await audit(tx, ctx, { action: "program.session.update", entity: "ProgramSession", entityId: id, after: { changedFields: Object.keys(d) } });
    return after;
  });
}

// ------------------------------------------------- booking integration ----

/** Validates that `count` more sessions of a program item can be booked; returns its service. */
export async function validateProgramBooking(tx: Tx, tenantId: string, clientId: string, itemId: string, count: number, excludeAppointmentId?: string) {
  const item = await tx.clientProgramItem.findFirst({
    where: { id: itemId, tenantId },
    include: { program: true, _count: { select: { sessions: true } }, appointments: { where: { status: { in: [...ACTIVE_APPT] }, ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}) }, select: { id: true } } },
  });
  if (!item || item.program.clientId !== clientId) throw badRequest("Program session not found for this client");
  if (item.program.status !== "ACTIVE") throw conflict(`Program is ${item.program.status.toLowerCase()}`);
  const free = item.sessionsTotal - item._count.sessions - item.appointments.length;
  if (count > free) throw conflict(`Only ${Math.max(0, free)} session(s) left to book in this program`);
  return { serviceId: item.serviceId, program: item.program };
}

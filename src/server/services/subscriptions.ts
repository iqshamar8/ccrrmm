/**
 * Client subscriptions (اشتراكات العملاء) — the clinic's own memberships and
 * visit packages, fully separate from the platform's SaaS subscriptions.
 * Coverage and limits are snapshotted at sale time.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { ACTIVE_APPT, addDaysUTC, assertBranchAccess, calendarDaysBetween, nextCounter, optText, recordBranchScope, requireClient, todayDate, uuidOpt } from "./common";

const money = z.coerce.number().min(0).max(1e10);

export const planSchema = z.object({
  name: z.string().trim().min(2).max(160),
  nameEn: z.string().trim().max(160).optional().nullable().transform((v) => v || null),
  description: optText(2000),
  kind: z.enum(["TIME", "VISITS", "SESSIONS"]),
  price: money,
  durationDays: z.coerce.number().int().min(1).max(3650),
  visitsLimit: z.coerce.number().int().min(1).max(10000).optional().nullable().or(z.literal("").transform(() => null)),
  maxFreezeDays: z.coerce.number().int().min(0).max(365).default(0),
  allServices: z.boolean().default(true),
  serviceIds: z.array(z.string().uuid()).max(500).default([]),
  isActive: z.boolean().default(true),
}).refine((p) => p.kind === "TIME" || (p.visitsLimit ?? 0) > 0, { message: "Visits/sessions limit is required", path: ["visitsLimit"] })
  .refine((p) => p.allServices || p.serviceIds.length > 0, { message: "Select covered services", path: ["serviceIds"] });

const planInclude = { services: { select: { serviceId: true, service: { select: { name: true } } } }, _count: { select: { subscriptions: true } } } satisfies Prisma.SubscriptionPlanInclude;

// ------------------------------------------------------------------ plans ----

export async function listPlans(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "subscriptions.view");
  return withTenant(tenantId, (tx) => tx.subscriptionPlan.findMany({ where: { tenantId }, include: planInclude, orderBy: [{ isActive: "desc" }, { name: "asc" }] }));
}

async function checkServices(tx: Tx, tenantId: string, ids: string[]) {
  if (ids.length && (await tx.service.count({ where: { tenantId, id: { in: ids } } })) !== new Set(ids).size) throw badRequest("Service not found");
}

export async function createPlan(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "subscriptions.create");
  const { serviceIds, ...d } = planSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await checkServices(tx, tenantId, serviceIds);
    const p = await tx.subscriptionPlan.create({
      data: { ...d, visitsLimit: d.kind === "TIME" ? null : d.visitsLimit, tenantId, services: { create: d.allServices ? [] : serviceIds.map((serviceId) => ({ tenantId, serviceId })) } },
      include: planInclude,
    });
    await audit(tx, ctx, { action: "subscription_plan.create", entity: "SubscriptionPlan", entityId: p.id, after: p });
    return p;
  });
}

export async function updatePlan(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "subscriptions.update");
  const { serviceIds, ...d } = planSchema.parse(raw); // full object: refinements need all fields
  return withTenant(tenantId, async (tx) => {
    const before = await tx.subscriptionPlan.findFirst({ where: { id, tenantId }, include: planInclude });
    if (!before) throw notFound("Plan not found");
    await checkServices(tx, tenantId, serviceIds);
    await tx.subscriptionPlanService.deleteMany({ where: { tenantId, planId: id } });
    if (!d.allServices) await tx.subscriptionPlanService.createMany({ data: serviceIds.map((serviceId) => ({ tenantId, planId: id, serviceId })) });
    const after = await tx.subscriptionPlan.update({ where: { id }, data: { ...d, visitsLimit: d.kind === "TIME" ? null : d.visitsLimit }, include: planInclude });
    await audit(tx, ctx, { action: "subscription_plan.update", entity: "SubscriptionPlan", entityId: id, before, after });
    return after;
  });
}

export async function deletePlan(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "subscriptions.delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.subscriptionPlan.findFirst({ where: { id, tenantId }, include: planInclude });
    if (!before) throw notFound("Plan not found");
    if (before._count.subscriptions) throw conflict("This plan has been sold — deactivate it instead");
    await tx.subscriptionPlan.delete({ where: { id } });
    await audit(tx, ctx, { action: "subscription_plan.delete", entity: "SubscriptionPlan", entityId: id, before });
    return { ok: true };
  });
}

// -------------------------------------------------- client subscriptions ----

const subInclude = {
  client: { select: { id: true, code: true, fullName: true, phone: true } },
  branch: { select: { id: true, name: true } },
  _count: { select: { usages: true } },
  appointments: { where: { status: { in: [...ACTIVE_APPT] } }, select: { id: true } },
} satisfies Prisma.ClientSubscriptionInclude;
type SubRow = Prisma.ClientSubscriptionGetPayload<{ include: typeof subInclude }>;

function shape(s: SubRow) {
  const { _count, appointments, ...rest } = s;
  const used = _count.usages;
  const remaining = s.visitsTotal === null ? null : Math.max(0, s.visitsTotal - used);
  const daysLeft = Math.ceil((+s.endDate - +todayDate()) / 86400000);
  return { ...rest, used, booked: appointments.length, remaining, daysLeft };
}

async function refreshExpired(tx: Tx, tenantId: string) {
  await tx.clientSubscription.updateMany({ where: { tenantId, status: "ACTIVE", endDate: { lt: todayDate() } }, data: { status: "EXPIRED" } });
}

export async function listSubscriptions(ctx: Ctx, q: { status?: string; expiringDays?: number; clientId?: string; search?: string } = {}) {
  const tenantId = requireTenant(ctx, "subscriptions.view");
  return withTenant(tenantId, async (tx) => {
    await refreshExpired(tx, tenantId);
    const where: Prisma.ClientSubscriptionWhereInput = { tenantId, ...recordBranchScope(ctx) };
    if (q.status && ["ACTIVE", "FROZEN", "CANCELLED", "EXPIRED"].includes(q.status)) where.status = q.status as never;
    if (q.expiringDays) { where.status = "ACTIVE"; where.endDate = { gte: todayDate(), lte: addDaysUTC(todayDate(), q.expiringDays) }; }
    if (q.clientId) where.clientId = q.clientId;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: "insensitive" } }, { code: q.search.toUpperCase() }, { client: { fullName: { contains: q.search, mode: "insensitive" } } }];
    const rows = await tx.clientSubscription.findMany({ where, include: subInclude, orderBy: q.expiringDays ? { endDate: "asc" } : { createdAt: "desc" }, take: 500 });
    return rows.map(shape);
  });
}

export async function getSubscription(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "subscriptions.view");
  return withTenant(tenantId, async (tx) => {
    await refreshExpired(tx, tenantId);
    const s = await tx.clientSubscription.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) }, include: subInclude });
    if (!s) throw notFound("Subscription not found");
    const usages = await tx.subscriptionUsage.findMany({ where: { tenantId, subscriptionId: id }, orderBy: { usedAt: "desc" }, include: { appointment: { select: { id: true, service: { select: { name: true } }, staff: { select: { fullName: true } } } } } });
    const services = s.allServices ? [] : await tx.service.findMany({ where: { tenantId, id: { in: s.coveredServiceIds } }, select: { id: true, name: true } });
    return { ...shape(s), usages, services };
  });
}

export const sellSchema = z.object({
  clientId: z.string().uuid(),
  planId: z.string().uuid(),
  startDate: z.coerce.date().optional(),
  price: money.optional(),
  branchId: uuidOpt,
});

async function createFromPlan(tx: Tx, ctx: Ctx, tenantId: string, a: { clientId: string; branchId: string; plan: { id: string | null; name: string; kind: "TIME" | "VISITS" | "SESSIONS"; price: Prisma.Decimal | number; durationDays: number; visitsLimit: number | null; maxFreezeDays: number; allServices: boolean; serviceIds: string[] }; startDate: Date; renewedFromId?: string }) {
  const code = `SUB-${String(await nextCounter(tx, tenantId, "subscription")).padStart(6, "0")}`;
  return tx.clientSubscription.create({
    data: {
      tenantId, code, clientId: a.clientId, branchId: a.branchId, planId: a.plan.id, name: a.plan.name, kind: a.plan.kind, price: a.plan.price,
      startDate: a.startDate, endDate: addDaysUTC(a.startDate, a.plan.durationDays - 1), visitsTotal: a.plan.kind === "TIME" ? null : a.plan.visitsLimit,
      allServices: a.plan.allServices, coveredServiceIds: a.plan.allServices ? [] : a.plan.serviceIds, maxFreezeDays: a.plan.maxFreezeDays,
      renewedFromId: a.renewedFromId ?? null, createdById: ctx.user.id,
    },
    include: subInclude,
  });
}

export async function sellSubscription(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "subscriptions.create");
  const d = sellSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const client = await requireClient(tx, ctx, tenantId, d.clientId, 400);
    const plan = await tx.subscriptionPlan.findFirst({ where: { id: d.planId, tenantId }, include: { services: true } });
    if (!plan || !plan.isActive) throw badRequest("Plan not found or inactive");
    const branchId = d.branchId ?? client.branchId;
    assertBranchAccess(ctx, branchId);
    const s = await createFromPlan(tx, ctx, tenantId, {
      clientId: d.clientId, branchId, startDate: d.startDate ?? todayDate(),
      plan: { ...plan, price: d.price ?? plan.price, serviceIds: plan.services.map((x) => x.serviceId) },
    });
    await tx.clientInteraction.create({ data: { tenantId, clientId: d.clientId, type: "SYSTEM", userId: ctx.user.id, content: `subscription.sold:${plan.name}` } });
    await audit(tx, ctx, { action: "subscription.sell", entity: "ClientSubscription", entityId: s.id, after: { code: s.code, plan: plan.name, price: s.price, clientId: d.clientId } });
    return shape(s);
  });
}

export async function renewSubscription(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "subscriptions.create");
  const d = z.object({ startDate: z.coerce.date().optional(), price: money.optional() }).parse(raw ?? {});
  return withTenant(tenantId, async (tx) => {
    const old = await tx.clientSubscription.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) }, include: { plan: true } });
    if (!old) throw notFound("Subscription not found");
    // Continue right after the current period if it's still running.
    const startDate = d.startDate ?? (old.status === "ACTIVE" && old.endDate >= todayDate() ? addDaysUTC(old.endDate, 1) : todayDate());
    const durationDays = old.plan?.durationDays ?? Math.round((+old.endDate - +old.startDate) / 86400000) + 1;
    const s = await createFromPlan(tx, ctx, tenantId, {
      clientId: old.clientId, branchId: old.branchId, startDate, renewedFromId: old.id,
      plan: {
        id: old.planId, name: old.name, kind: old.kind, price: d.price ?? old.plan?.price ?? old.price, durationDays,
        visitsLimit: old.plan?.visitsLimit ?? old.visitsTotal, maxFreezeDays: old.plan?.maxFreezeDays ?? old.maxFreezeDays,
        allServices: old.allServices, serviceIds: old.coveredServiceIds,
      },
    });
    await tx.clientInteraction.create({ data: { tenantId, clientId: old.clientId, type: "SYSTEM", userId: ctx.user.id, content: `subscription.renewed:${old.name}` } });
    await audit(tx, ctx, { action: "subscription.renew", entity: "ClientSubscription", entityId: s.id, before: { from: old.code }, after: { code: s.code, startDate } });
    return shape(s);
  });
}

export async function setSubscriptionStatus(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "subscriptions.update");
  const { action, reason } = z.object({ action: z.enum(["FREEZE", "UNFREEZE", "CANCEL"]), reason: z.string().trim().max(300).optional() }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    await refreshExpired(tx, tenantId);
    const s = await tx.clientSubscription.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!s) throw notFound("Subscription not found");
    const now = new Date();
    let data: Prisma.ClientSubscriptionUpdateInput;
    if (action === "FREEZE") {
      if (s.status !== "ACTIVE") throw conflict("Only active subscriptions can be frozen");
      if (s.frozenDaysUsed >= s.maxFreezeDays) throw conflict(s.maxFreezeDays ? `Freeze allowance (${s.maxFreezeDays} days) is used up` : "This plan doesn't allow freezing");
      data = { status: "FROZEN", frozenAt: now };
    } else if (action === "UNFREEZE") {
      if (s.status !== "FROZEN" || !s.frozenAt) throw conflict("Subscription is not frozen");
      // Frozen days are added back to the end date, capped at the remaining allowance.
      const days = Math.min(Math.max(1, calendarDaysBetween(s.frozenAt, now)), s.maxFreezeDays - s.frozenDaysUsed);
      data = { status: "ACTIVE", frozenAt: null, frozenDaysUsed: s.frozenDaysUsed + days, endDate: addDaysUTC(s.endDate, days) };
    } else {
      if (["CANCELLED", "EXPIRED"].includes(s.status)) throw conflict("Subscription is already closed");
      if (!reason) throw badRequest("Cancellation reason is required");
      data = { status: "CANCELLED", cancelledAt: now, cancelReason: reason };
      await tx.appointment.updateMany({
        where: { tenantId, subscriptionId: id, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gte: now } },
        data: { subscriptionId: null }, // keep the bookings, just stop charging them to the subscription
      });
    }
    const after = await tx.clientSubscription.update({ where: { id }, data });
    await audit(tx, ctx, { action: `subscription.${action.toLowerCase()}`, entity: "ClientSubscription", entityId: id, before: { status: s.status, endDate: s.endDate }, after: { status: after.status, endDate: after.endDate, reason } });
    return after;
  });
}

// ---------------------------------------------------------------- usage ----

/** Shared by manual recording and appointment completion. */
export async function addUsage(tx: Tx, tenantId: string, subscriptionId: string, data: { serviceId?: string | null; usedAt: Date; appointmentId?: string | null; note?: string | null; recordedById?: string | null }) {
  const s = await assertUsable(tx, tenantId, subscriptionId, data.serviceId ?? null, data.usedAt, 1);
  const u = await tx.subscriptionUsage.create({ data: { tenantId, subscriptionId, ...data } });
  // Exhausted visit packages close automatically.
  if (s.visitsTotal !== null && s._count.usages + 1 >= s.visitsTotal) {
    await tx.clientSubscription.update({ where: { id: subscriptionId }, data: { status: "EXPIRED" } });
  }
  return u;
}

async function assertUsable(tx: Tx, tenantId: string, subscriptionId: string, serviceId: string | null, at: Date, count: number, excludeAppointmentId?: string, reserved = false) {
  const s = await tx.clientSubscription.findFirst({
    where: { id: subscriptionId, tenantId },
    include: { _count: { select: { usages: true } }, appointments: { where: { status: { in: [...ACTIVE_APPT] }, ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}) }, select: { id: true } } },
  });
  if (!s) throw badRequest("Subscription not found");
  if (s.status !== "ACTIVE") throw conflict(`Subscription is ${s.status.toLowerCase()}`);
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (day < s.startDate || day > s.endDate) throw conflict("Date is outside the subscription period");
  if (!s.allServices && (!serviceId || !s.coveredServiceIds.includes(serviceId))) throw conflict("This service is not covered by the subscription");
  if (s.visitsTotal !== null) {
    const free = s.visitsTotal - s._count.usages - (reserved ? s.appointments.length : 0);
    if (count > free) throw conflict(`Only ${Math.max(0, free)} visit(s) left on this subscription`);
  }
  return s;
}

/** Booking-time check: counts already-booked visits as reserved. */
export async function validateSubscriptionBooking(tx: Tx, tenantId: string, clientId: string, subscriptionId: string, serviceId: string | null, at: Date, count: number, excludeAppointmentId?: string) {
  const owner = await tx.clientSubscription.findFirst({ where: { id: subscriptionId, tenantId, clientId }, select: { id: true } });
  if (!owner) throw badRequest("Subscription not found for this client");
  return assertUsable(tx, tenantId, subscriptionId, serviceId, at, count, excludeAppointmentId, true);
}

export async function recordUsage(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "subscriptions.update");
  const d = z.object({ serviceId: uuidOpt, usedAt: z.coerce.date().default(() => new Date()), note: optText(300) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const s = await tx.clientSubscription.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!s) throw notFound("Subscription not found");
    const u = await addUsage(tx, tenantId, id, { ...d, recordedById: ctx.user.id });
    await audit(tx, ctx, { action: "subscription.usage", entity: "SubscriptionUsage", entityId: u.id, after: u });
    return u;
  });
}

// ------------------------------------------------------- coverage lookup ----

/** What can this client's booking be charged to? Used by the booking form. */
export async function clientCoverage(ctx: Ctx, clientId: string) {
  const tenantId = requireTenant(ctx, "appointments.view");
  return withTenant(tenantId, async (tx) => {
    await requireClient(tx, ctx, tenantId, clientId);
    const [programs, subs] = await Promise.all([
      ctx.permissions.has("programs.view")
        ? tx.clientProgram.findMany({
            where: { tenantId, clientId, status: "ACTIVE" },
            include: { items: { include: { service: { select: { id: true, name: true, durationMin: true } }, _count: { select: { sessions: true } }, appointments: { where: { status: { in: [...ACTIVE_APPT] } }, select: { id: true } } } } },
          })
        : [],
      ctx.permissions.has("subscriptions.view")
        ? tx.clientSubscription.findMany({ where: { tenantId, clientId, status: "ACTIVE", endDate: { gte: todayDate() } }, include: subInclude })
        : [],
    ]);
    return {
      programs: programs.map((p) => ({
        id: p.id, code: p.code, name: p.name,
        items: p.items.map((i) => ({ id: i.id, serviceId: i.serviceId, service: i.service, total: i.sessionsTotal, used: i._count.sessions, booked: i.appointments.length, free: i.sessionsTotal - i._count.sessions - i.appointments.length })),
      })),
      subscriptions: subs.map(shape).map((s) => ({ id: s.id, code: s.code, name: s.name, kind: s.kind, endDate: s.endDate, allServices: s.allServices, coveredServiceIds: s.coveredServiceIds, remaining: s.remaining, booked: s.booked })),
    };
  });
}

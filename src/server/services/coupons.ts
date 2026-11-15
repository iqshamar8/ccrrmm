/** Discount coupons: CRUD, validation/evaluation at checkout, usage stats. */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { D, min, r2, ZERO } from "./money";

const optMoney = z.coerce.number().min(0).max(1e10).optional().nullable().or(z.literal("").transform(() => null));
export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(30).regex(/^[A-Z0-9_-]+$/, "A-Z, 0-9, _ and - only"),
  name: z.string().trim().min(2).max(120),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.coerce.number().positive().max(1e10),
  maxDiscount: optMoney,
  minAmount: optMoney,
  startsAt: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)),
  endsAt: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)),
  usageLimit: z.coerce.number().int().min(1).optional().nullable().or(z.literal("").transform(() => null)),
  perClientLimit: z.coerce.number().int().min(1).optional().nullable().or(z.literal("").transform(() => null)),
  allServices: z.boolean().default(true),
  serviceIds: z.array(z.string().uuid()).max(500).default([]),
  clientIds: z.array(z.string().uuid()).max(5000).default([]),
  ownerUserId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
  commissionType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
  commissionValue: z.coerce.number().min(0).max(1e10).default(0),
  isActive: z.boolean().default(true),
}).refine((c) => c.type !== "PERCENT" || c.value <= 100, { message: "Percentage cannot exceed 100", path: ["value"] })
  .refine((c) => !c.startsAt || !c.endsAt || c.endsAt > c.startsAt, { message: "End must be after start", path: ["endsAt"] });

export async function listCoupons(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "coupons.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.coupon.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    const stats = await tx.couponRedemption.groupBy({ by: ["couponId"], where: { tenantId }, _count: true, _sum: { discount: true } });
    const owners = await tx.user.findMany({ where: { tenantId, id: { in: rows.map((r) => r.ownerUserId).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
    return rows.map((c) => {
      const s = stats.find((x) => x.couponId === c.id);
      return { ...c, used: s?._count ?? 0, totalDiscount: s?._sum.discount ?? ZERO, owner: owners.find((o) => o.id === c.ownerUserId) ?? null };
    });
  });
}

async function validateRefs(tx: Tx, tenantId: string, d: z.infer<typeof couponSchema>) {
  if (d.serviceIds.length && (await tx.service.count({ where: { tenantId, id: { in: d.serviceIds } } })) !== new Set(d.serviceIds).size) throw badRequest("Service not found");
  if (d.clientIds.length && (await tx.client.count({ where: { tenantId, id: { in: d.clientIds } } })) !== new Set(d.clientIds).size) throw badRequest("Client not found");
  if (d.ownerUserId && !(await tx.user.findFirst({ where: { tenantId, id: d.ownerUserId } }))) throw badRequest("Staff member not found");
}

export async function createCoupon(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "coupons.create");
  const d = couponSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await validateRefs(tx, tenantId, d);
    if (await tx.coupon.findFirst({ where: { tenantId, code: d.code } })) throw conflict("Coupon code already exists");
    const c = await tx.coupon.create({ data: { ...d, tenantId, serviceIds: d.allServices ? [] : d.serviceIds } });
    await audit(tx, ctx, { action: "coupon.create", entity: "Coupon", entityId: c.id, after: c });
    return c;
  });
}

export async function updateCoupon(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "coupons.update");
  const d = couponSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.coupon.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Coupon not found");
    await validateRefs(tx, tenantId, d);
    if (d.code !== before.code && (await tx.coupon.findFirst({ where: { tenantId, code: d.code } }))) throw conflict("Coupon code already exists");
    const after = await tx.coupon.update({ where: { id }, data: { ...d, serviceIds: d.allServices ? [] : d.serviceIds } });
    await audit(tx, ctx, { action: "coupon.update", entity: "Coupon", entityId: id, before, after });
    return after;
  });
}

export async function deleteCoupon(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "coupons.delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.coupon.findFirst({ where: { id, tenantId }, include: { _count: { select: { redemptions: true } } } });
    if (!before) throw notFound("Coupon not found");
    if (before._count.redemptions) throw conflict("This coupon has been used — deactivate it instead");
    await tx.coupon.delete({ where: { id } });
    await audit(tx, ctx, { action: "coupon.delete", entity: "Coupon", entityId: id, before });
    return { ok: true };
  });
}

type EvalLine = { kind: string; serviceId: string | null; lineTotal: Prisma.Decimal };

/**
 * Validates a coupon for a cart and returns the discount. Throws 409 with a
 * clear reason if it can't be used. `excludeInvoiceId` skips the invoice's own redemption.
 */
export async function evaluateCoupon(tx: Tx, tenantId: string, code: string, a: { clientId: string | null; lines: EvalLine[]; subtotal: Prisma.Decimal; cap: Prisma.Decimal; excludeInvoiceId?: string }) {
  const c = await tx.coupon.findFirst({ where: { tenantId, code: code.trim().toUpperCase() } });
  const bad = (m: string) => new AppError(409, "COUPON_INVALID", m);
  if (!c || !c.isActive) throw bad("Coupon not found or inactive");
  const now = new Date();
  if (c.startsAt && c.startsAt > now) throw bad("Coupon is not active yet");
  if (c.endsAt && c.endsAt < now) throw bad("Coupon has expired");
  if (c.clientIds.length && (!a.clientId || !c.clientIds.includes(a.clientId))) throw bad("Coupon is not valid for this client");
  if (c.minAmount && a.subtotal.lessThan(c.minAmount)) throw bad(`Minimum invoice amount is ${c.minAmount}`);
  const notThis = a.excludeInvoiceId ? { invoiceId: { not: a.excludeInvoiceId } } : {};
  if (c.usageLimit && (await tx.couponRedemption.count({ where: { tenantId, couponId: c.id, ...notThis } })) >= c.usageLimit) throw bad("Coupon usage limit reached");
  if (c.perClientLimit) {
    if (!a.clientId) throw bad("Select a client to use this coupon");
    if ((await tx.couponRedemption.count({ where: { tenantId, couponId: c.id, clientId: a.clientId, ...notThis } })) >= c.perClientLimit) throw bad("Client already used this coupon");
  }
  const eligible = a.lines.filter((l) => c.allServices || (l.serviceId && c.serviceIds.includes(l.serviceId)));
  const base = eligible.reduce((s, l) => s.plus(l.lineTotal), D(0));
  if (base.isZero()) throw bad("No items in this invoice are covered by the coupon");
  let discount = c.type === "PERCENT" ? r2(base.times(c.value).dividedBy(100)) : D(c.value);
  if (c.maxDiscount) discount = min(discount, D(c.maxDiscount));
  discount = min(min(discount, base), a.cap);
  return { coupon: c, discount: r2(discount) };
}

/** Public check used by the POS before checkout. */
export async function checkCoupon(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "invoices.view");
  const d = z.object({ code: z.string().min(1), clientId: z.string().uuid().nullable().optional(), lines: z.array(z.object({ serviceId: z.string().uuid().nullable().optional(), kind: z.string(), amount: z.coerce.number() })) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const lines = d.lines.map((l) => ({ kind: l.kind, serviceId: l.serviceId ?? null, lineTotal: D(l.amount) }));
    const subtotal = lines.reduce((s, l) => s.plus(l.lineTotal), D(0));
    const { coupon, discount } = await evaluateCoupon(tx, tenantId, d.code, { clientId: d.clientId ?? null, lines, subtotal, cap: subtotal });
    return { code: coupon.code, name: coupon.name, discount };
  });
}

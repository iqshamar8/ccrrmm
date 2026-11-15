/**
 * Commissions are generated when an invoice becomes PAID (money actually
 * collected), from the rules on each service / coupon / settings:
 *   SERVICE_EXEC      line.performedBy  × service.execCommission
 *   SERVICE_MARKETING invoice.salesStaff × service.marketingCommission
 *   SURGERY           surgeon           × surgery service execCommission
 *   PRODUCT_SALE      invoice.salesStaff × settings.productCommissionPercent (products, programs, subscriptions)
 *   COUPON            coupon.owner      × coupon.commission
 *   REVIEW            review doctor     × settings.reviewCommissionAmount (on completion)
 * Refunds create proportional negative entries (or VOID unpaid ones on full refund).
 */
import { z } from "zod";
import { Prisma, type CommissionSource } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest } from "../errors";
import { applyRate, D, r2, ZERO } from "./money";
import { settingsTx } from "./settings";

type Line = Prisma.InvoiceLineGetPayload<{ include: { service: true } }>;

/** Net share of a line after invoice-level discounts (what was really charged, pre-tax). */
export function lineNet(line: { lineTotal: Prisma.Decimal }, inv: { subtotal: Prisma.Decimal; discountAmount: Prisma.Decimal; couponDiscount: Prisma.Decimal; loyaltyDiscount: Prisma.Decimal; corporateDiscount?: Prisma.Decimal }) {
  if (D(inv.subtotal).isZero()) return ZERO;
  const disc = D(inv.discountAmount).plus(inv.couponDiscount).plus(inv.loyaltyDiscount).plus(inv.corporateDiscount ?? 0);
  return r2(D(line.lineTotal).times(D(1).minus(disc.dividedBy(inv.subtotal))));
}

export async function generateForInvoice(tx: Tx, tenantId: string, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { where: { voided: false }, include: { service: true } }, coupon: true } });
  const s = await settingsTx(tx, tenantId);
  const rows: Prisma.CommissionEntryCreateManyInput[] = [];
  const add = (userId: string | null, source: CommissionSource, line: Line | null, base: Prisma.Decimal, type: "NONE" | "PERCENT" | "FIXED", value: Prisma.Decimal.Value, qty: Prisma.Decimal.Value = 1) => {
    if (!userId || type === "NONE") return;
    const amount = applyRate(type, value, base, qty);
    if (amount.lessThanOrEqualTo(0)) return;
    rows.push({ tenantId, userId, source, invoiceId, invoiceLineId: line?.id ?? null, baseAmount: base, rateType: type, rateValue: D(value), amount, earnedAt: new Date() });
  };
  for (const l of inv.lines) {
    const base = lineNet(l, inv);
    if (l.kind === "SERVICE" && l.service) {
      add(l.performedById, "SERVICE_EXEC", l, base, l.service.execCommissionType, l.service.execCommissionValue, l.quantity);
      add(inv.salesStaffId, "SERVICE_MARKETING", l, base, l.service.marketingCommissionType, l.service.marketingCommissionValue, l.quantity);
    } else if (l.kind === "SURGERY" && l.service) {
      add(l.performedById, "SURGERY", l, base, l.service.execCommissionType, l.service.execCommissionValue);
    } else if (["PRODUCT", "PROGRAM", "SUBSCRIPTION"].includes(l.kind) && D(s.productCommissionPercent).greaterThan(0)) {
      add(inv.salesStaffId, "PRODUCT_SALE", l, base, "PERCENT", s.productCommissionPercent);
    }
  }
  if (inv.coupon?.ownerUserId && inv.coupon.commissionType !== "NONE" && !(await tx.commissionEntry.findFirst({ where: { tenantId, invoiceId, source: "COUPON" } }))) {
    add(inv.coupon.ownerUserId, "COUPON", null, D(inv.total).minus(inv.taxTotal), inv.coupon.commissionType, inv.coupon.commissionValue);
  }
  if (rows.length) await tx.commissionEntry.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}

/** Proportional reversal after a refund (ratio of the invoice total refunded). */
export async function reverseForInvoice(tx: Tx, tenantId: string, invoiceId: string, ratio: number) {
  const entries = await tx.commissionEntry.findMany({ where: { tenantId, invoiceId, amount: { gt: 0 }, status: { not: "VOID" } } });
  for (const e of entries) {
    if (ratio >= 0.9999 && e.status !== "PAID") {
      await tx.commissionEntry.update({ where: { id: e.id }, data: { status: "VOID", note: "invoice fully refunded" } });
    } else {
      const amount = r2(D(e.amount).times(ratio)).negated();
      if (!amount.isZero()) {
        await tx.commissionEntry.create({ data: {
          tenantId, userId: e.userId, source: e.source, invoiceId, invoiceLineId: e.invoiceLineId, baseAmount: e.baseAmount, rateType: e.rateType,
          rateValue: e.rateValue, amount, earnedAt: new Date(), note: `refund reversal (${Math.round(ratio * 100)}%)`,
        } });
      }
    }
  }
}

export async function voidForInvoice(tx: Tx, tenantId: string, invoiceId: string) {
  await tx.commissionEntry.updateMany({ where: { tenantId, invoiceId, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "VOID", note: "invoice cancelled" } });
}

/** Fixed commission for the doctor of a completed review (settings.reviewCommissionAmount). */
export async function reviewCommission(tx: Tx, tenantId: string, review: { id: string; doctorId: string | null }) {
  if (!review.doctorId) return;
  const s = await settingsTx(tx, tenantId);
  if (D(s.reviewCommissionAmount).lessThanOrEqualTo(0)) return;
  if (await tx.commissionEntry.findFirst({ where: { tenantId, reviewId: review.id } })) return;
  await tx.commissionEntry.create({ data: {
    tenantId, userId: review.doctorId, source: "REVIEW", reviewId: review.id, baseAmount: s.reviewCommissionAmount, rateType: "FIXED",
    rateValue: s.reviewCommissionAmount, amount: s.reviewCommissionAmount, earnedAt: new Date(),
  } });
}

// ------------------------------------------------------------------ API ----

export async function listCommissions(ctx: Ctx, q: { userId?: string; status?: string; source?: string; from?: string; to?: string } = {}) {
  const tenantId = requireTenant(ctx, "commissions.view");
  // Staff without approve rights only see their own commissions.
  const own = !ctx.permissions.has("commissions.approve") && ctx.user.roleKey !== "tenant_admin";
  const where: Prisma.CommissionEntryWhereInput = { tenantId, ...(own ? { userId: ctx.user.id } : q.userId ? { userId: q.userId } : {}) };
  if (q.status) where.status = q.status as never;
  if (q.source) where.source = q.source as never;
  if (q.from || q.to) where.earnedAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
  return withTenant(tenantId, async (tx) => {
    const [items, byUser] = await Promise.all([
      tx.commissionEntry.findMany({ where, orderBy: { earnedAt: "desc" }, take: 1000, include: { user: { select: { id: true, fullName: true } }, invoice: { select: { id: true, code: true } } } }),
      tx.commissionEntry.groupBy({ by: ["userId", "status"], where: { ...where, status: undefined, ...(q.status ? { status: q.status as never } : {}) }, _sum: { amount: true } }),
    ]);
    const users = await tx.user.findMany({ where: { tenantId, id: { in: [...new Set(byUser.map((b) => b.userId))] } }, select: { id: true, fullName: true } });
    const summary = users.map((u) => {
      const s = (st: string) => byUser.filter((b) => b.userId === u.id && b.status === st).reduce((a, b) => a.plus(b._sum.amount ?? 0), D(0));
      return { user: u, pending: s("PENDING"), approved: s("APPROVED"), paid: s("PAID") };
    }).sort((a, b) => b.pending.plus(b.approved).minus(a.pending.plus(a.approved)).toNumber());
    return { items, summary, ownOnly: own };
  });
}

export async function setCommissionStatus(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "commissions.approve");
  const d = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000), action: z.enum(["APPROVE", "VOID"]), note: z.string().trim().max(300).optional() }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const now = new Date();
    const from = d.action === "APPROVE" ? ["PENDING"] : ["PENDING", "APPROVED"];
    const r = await tx.commissionEntry.updateMany({
      where: { tenantId, id: { in: d.ids }, status: { in: from as never } },
      data: d.action === "APPROVE" ? { status: "APPROVED", approvedById: ctx.user.id, approvedAt: now } : { status: "VOID", note: d.note ?? "voided" },
    });
    await audit(tx, ctx, { action: `commission.${d.action.toLowerCase()}`, entity: "CommissionEntry", after: { count: r.count, ids: d.ids.slice(0, 50) } });
    return { updated: r.count };
  });
}

export async function addAdjustment(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "commissions.create");
  const d = z.object({ userId: z.string().uuid(), amount: z.coerce.number().refine((n) => n !== 0), note: z.string().trim().min(2).max(300) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.user.findFirst({ where: { id: d.userId, tenantId } }))) throw badRequest("Staff member not found");
    const e = await tx.commissionEntry.create({ data: { tenantId, userId: d.userId, source: "ADJUSTMENT", baseAmount: 0, rateType: "FIXED", rateValue: d.amount, amount: d.amount, earnedAt: new Date(), note: d.note } });
    await audit(tx, ctx, { action: "commission.adjust", entity: "CommissionEntry", entityId: e.id, after: e });
    return e;
  });
}

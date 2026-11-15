import { Prisma } from "@prisma/client";
import { z } from "zod";
import { audit } from "../audit";
import { type Ctx, requirePlatform } from "../context";
import { type Tx, withPlatform, withTenant } from "../db";
import { AppError, badRequest, notFound } from "../errors";

const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "OTHER"]),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});
const reviewSchema = z.object({ status: z.enum(["CONFIRMED", "REJECTED"]), note: z.string().trim().max(500).optional().nullable() });

function requireBillingTenant(ctx: Ctx) {
  if (!ctx.tenant) throw new AppError(403, "FORBIDDEN", "This action requires an organization account");
  if (["SUSPENDED", "CANCELLED"].includes(ctx.tenant.status)) {
    throw new AppError(403, "TENANT_SUSPENDED", "Organization is suspended");
  }
  if (!ctx.permissions.has("settings.view")) throw new AppError(403, "FORBIDDEN", "Organization administrator access required");
  // Deliberately allow expired subscriptions to view invoices and submit renewal payments.
  return ctx.tenant.id;
}

const addCycle = (d: Date, cycle: "MONTHLY" | "YEARLY") => {
  const n = new Date(d);
  if (cycle === "MONTHLY") n.setMonth(n.getMonth() + 1);
  else n.setFullYear(n.getFullYear() + 1);
  return n;
};

function money(value: Prisma.Decimal | number) {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

/** Issue one immutable-priced SaaS invoice for a subscription period. Safe to retry. */
export async function issueSubscriptionInvoice(
  ctx: Ctx | null, tenantId: string, subscriptionId: string, kind: "NEW" | "RENEWAL" = "NEW", opts: { now?: Date } = {},
) {
  return issueInvoiceCore(requirePlatform(ctx), tenantId, subscriptionId, kind, opts);
}

/**
 * System (cron) variant: no user actor, audited with a null user. Only call from trusted
 * server code such as the subscription lifecycle job — never expose it to a request handler directly.
 */
export async function issueSystemSubscriptionInvoice(
  tenantId: string, subscriptionId: string, kind: "NEW" | "RENEWAL", opts: { now?: Date } = {},
) {
  return issueInvoiceCore(null, tenantId, subscriptionId, kind, opts);
}

async function issueInvoiceCore(
  actor: Ctx | null, tenantId: string, subscriptionId: string, kind: "NEW" | "RENEWAL", opts: { now?: Date },
) {
  if (!["NEW", "RENEWAL"].includes(kind)) throw badRequest("Unsupported subscription invoice kind");
  const now = opts.now ?? new Date();
  return withPlatform(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${subscriptionId}, 0))`;
    const sub = await tx.tenantSubscription.findFirst({
      where: { id: subscriptionId, tenantId },
      include: { plan: true, coupon: true, tenant: { select: { name: true } } },
    });
    if (!sub) throw notFound("Subscription not found");

    let periodStart: Date;
    if (kind === "RENEWAL") {
      if (!sub.endsAt) throw badRequest("A trial must be converted to a new subscription period first");
      periodStart = sub.endsAt;
    } else {
      periodStart = sub.status === "TRIALING" ? (sub.trialEndsAt ?? sub.startsAt) : sub.startsAt;
    }
    const existing = await tx.platformInvoice.findFirst({ where: { subscriptionId, periodStart, kind, status: { not: "VOID" } } });
    if (existing) return existing;

    const periodEnd = addCycle(periodStart, sub.billingCycle);
    const settings = await tx.platformSettings.findUnique({ where: { id: 1 } });
    const subtotal = money(sub.billingCycle === "MONTHLY" ? sub.plan.priceMonthly : sub.plan.priceYearly);
    // A subscription coupon applies while it is active, in its validity window, valid for this plan,
    // and has cycles left (durationCycles = null means every invoice).
    const c = sub.coupon;
    const couponApplies = !!c && c.isActive
      && (!c.validFrom || c.validFrom <= now) && (!c.validUntil || c.validUntil >= now)
      && (c.planIds.length === 0 || c.planIds.includes(sub.planId))
      && (c.durationCycles == null || sub.couponCyclesUsed < c.durationCycles);
    let discount = money(0);
    if (couponApplies && c) {
      discount = c.type === "PERCENT"
        ? money(subtotal.mul(Prisma.Decimal.min(c.value, 100)).div(100))
        : money(Prisma.Decimal.min(c.value, subtotal));
    }
    const taxable = subtotal.minus(discount);
    const tax = money(taxable.mul(settings?.taxRate ?? 0).div(100));
    const total = money(taxable.plus(tax));
    const sequence = await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('platform_invoice_seq') AS seq`;
    const year = periodStart.getUTCFullYear();
    const number = `SUB-${year}-${String(sequence[0].seq).padStart(6, "0")}`;
    const dueDate = new Date(now.getTime() + (settings?.graceDays ?? 7) * 86400000);

    try {
      const invoice = await tx.platformInvoice.create({
        data: {
          number, tenantId, subscriptionId, planId: sub.planId, kind, cycle: sub.billingCycle,
          periodStart, periodEnd, currency: sub.plan.currency, subtotal, discount, tax, total, dueDate,
          couponId: couponApplies && c ? c.id : null,
          notes: `Subscription invoice for ${sub.tenant.name}`,
        },
      });
      if (couponApplies) {
        await tx.tenantSubscription.update({ where: { id: sub.id }, data: { couponCyclesUsed: { increment: 1 } } });
      }
      await audit(tx, actor, { tenantId, action: "platform_invoice.issue", entity: "PlatformInvoice", entityId: invoice.id, after: invoice });
      return invoice;
    } catch (error) {
      // Concurrent retries race on the database's partial unique index. Return the winner.
      const raced = await tx.platformInvoice.findFirst({ where: { subscriptionId, periodStart, kind, status: { not: "VOID" } } });
      if (raced) return raced;
      throw error;
    }
  });
}

export async function listPlatformInvoices(ctx: Ctx) {
  if (ctx.user.isPlatformAdmin) {
    return withPlatform((tx) => tx.platformInvoice.findMany({
      orderBy: [{ issuedAt: "desc" }, { number: "desc" }], take: 500,
      include: { tenant: { select: { name: true, slug: true } }, plan: { select: { nameAr: true, nameEn: true } }, payments: { orderBy: { createdAt: "desc" } } },
    }));
  }
  const tenantId = requireBillingTenant(ctx);
  return withTenant(tenantId, (tx) => tx.platformInvoice.findMany({
    where: { tenantId }, orderBy: [{ issuedAt: "desc" }, { number: "desc" }], take: 100,
    include: { plan: { select: { nameAr: true, nameEn: true } }, payments: { orderBy: { createdAt: "desc" } } },
  }));
}

export async function submitPlatformPayment(ctx: Ctx, invoiceId: string, raw: unknown) {
  const tenantId = requireBillingTenant(ctx);
  const input = paymentSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    // An advisory transaction lock serializes payment submissions even though the tenant role is read-only on billing tables.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${invoiceId}, 0))`;
    const invoice = await tx.platformInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw notFound("Invoice not found");
    if (invoice.status !== "ISSUED") throw badRequest("Only issued invoices can receive payments");
    const payments = await tx.platformPayment.aggregate({
      where: { invoiceId, tenantId, status: { in: ["PENDING", "CONFIRMED"] } }, _sum: { amount: true },
    });
    const reserved = payments._sum.amount ?? new Prisma.Decimal(0);
    const amount = money(input.amount);
    if (amount.lte(0) || reserved.plus(amount).gt(invoice.total)) throw badRequest("Payment exceeds the invoice's remaining balance");
    const payment = await tx.platformPayment.create({
      data: {
        tenantId, invoiceId, amount, method: input.method, reference: input.reference || null,
        note: input.note || null, submittedById: ctx.user.id,
      },
    });
    await audit(tx, ctx, { action: "platform_payment.submit", entity: "PlatformPayment", entityId: payment.id, after: { ...payment, reference: input.reference || null } });
    return payment;
  });
}

export async function reviewPlatformPayment(ctx: Ctx | null, paymentId: string, raw: unknown) {
  const actor = requirePlatform(ctx);
  const input = reviewSchema.parse(raw);
  return withPlatform(async (tx) => {
    const payment = await tx.platformPayment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!payment) throw notFound("Payment not found");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${payment.invoiceId}, 0))`;
    const fresh = await tx.platformPayment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!fresh) throw notFound("Payment not found");
    if (fresh.status !== "PENDING") throw badRequest("Only pending payments can be reviewed");
    if (fresh.invoice.status !== "ISSUED") throw badRequest("Only issued invoices can receive payments");
    const currentPayment = fresh;
    if (input.status === "CONFIRMED") {
      const confirmed = await tx.platformPayment.aggregate({
        where: { invoiceId: currentPayment.invoiceId, status: "CONFIRMED" }, _sum: { amount: true },
      });
      const paid = (confirmed._sum.amount ?? new Prisma.Decimal(0)).plus(currentPayment.amount);
      if (paid.gt(currentPayment.invoice.total)) throw badRequest("Confirmed payments would exceed the invoice total");
      await tx.platformPayment.update({ where: { id: currentPayment.id }, data: { status: "CONFIRMED", confirmedById: actor.user.id, confirmedAt: new Date(), note: input.note ?? currentPayment.note } });
      if (paid.gte(currentPayment.invoice.total)) {
        await tx.platformInvoice.update({ where: { id: currentPayment.invoiceId }, data: { status: "PAID", paidAt: new Date() } });
        if (currentPayment.invoice.subscriptionId) {
          await tx.tenantSubscription.update({
            where: { id: currentPayment.invoice.subscriptionId },
            data: { status: "ACTIVE", startsAt: currentPayment.invoice.periodStart, endsAt: currentPayment.invoice.periodEnd, trialEndsAt: null, pastDueSince: null },
          });
          await tx.tenant.update({ where: { id: currentPayment.tenantId }, data: { status: "ACTIVE" } });
        }
      }
    } else {
      await tx.platformPayment.update({ where: { id: currentPayment.id }, data: { status: "REJECTED", confirmedById: actor.user.id, confirmedAt: new Date(), note: input.note ?? currentPayment.note } });
    }
    const updated = await tx.platformPayment.findUniqueOrThrow({ where: { id: currentPayment.id } });
    await audit(tx, actor, { tenantId: currentPayment.tenantId, action: `platform_payment.${input.status.toLowerCase()}`, entity: "PlatformPayment", entityId: currentPayment.id, before: currentPayment, after: updated });
    return updated;
  });
}

export async function updatePlatformBillingSettings(ctx: Ctx | null, raw: unknown) {
  const actor = requirePlatform(ctx);
  const input = z.object({
    companyName: z.string().trim().min(2).max(120), companyAddress: z.string().trim().max(300).nullable().optional(),
    taxNo: z.string().trim().max(80).nullable().optional(), taxRate: z.coerce.number().min(0).max(100),
    bankDetails: z.string().trim().max(1000).nullable().optional(), invoiceFooter: z.string().trim().max(1000).nullable().optional(),
    supportEmail: z.string().trim().email().max(160).nullable().optional(), graceDays: z.coerce.number().int().min(0).max(90),
    renewalLeadDays: z.coerce.number().int().min(0).max(90), reminderDays: z.array(z.coerce.number().int().min(0).max(365)).max(12), allowSignup: z.boolean(),
  }).parse(raw);
  return withPlatform(async (tx) => {
    const before = await tx.platformSettings.findUnique({ where: { id: 1 } });
    const after = await tx.platformSettings.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: input });
    await audit(tx, actor, { tenantId: null, action: "platform.billing_settings.update", entity: "PlatformSettings", entityId: "1", before, after });
    return after;
  });
}

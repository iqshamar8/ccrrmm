/**
 * Invoices, payments, refunds, installments, receivables, POS checkout.
 *
 * Lifecycle: DRAFT (editable) → ISSUED (number assigned, immutable lines)
 *   → PARTIALLY_PAID → PAID  (loyalty earned + commissions generated)
 *   → REFUNDED (fully refunded)        ISSUED/… with nothing paid → CANCELLED
 * Totals: lineTotal = qty×price − lineDiscount; subtotal = Σ lineTotal;
 *   invoice discounts (manual → coupon → loyalty) are spread pro-rata for tax;
 *   total = subtotal − discounts + tax.  All math in exact decimals.
 * A source (appointment, program, subscription, surgery) can be billed once:
 *   app check + partial unique indexes on live (non-voided) lines.
 */
import { z } from "zod";
import { Prisma, type InvoiceType, type LineKind } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { addDaysUTC, assertBranchAccess, defaultBranchId, nextCounter, optText, recordBranchScope, requireClient, todayDate, uuidOpt } from "./common";
import { evaluateCoupon } from "./coupons";
import { earnForInvoice, redemptionValue, reverseForInvoice as reverseLoyalty } from "./loyalty";
import { generateForInvoice, reverseForInvoice as reverseCommissions, voidForInvoice } from "./commissions";
import { influencerForInvoice, reverseInfluencerForInvoice, voidInfluencerForInvoice } from "./marketing";
import { D, max0, min, r2, sum, ZERO } from "./money";
import { settingsTx } from "./settings";
import { postInvoiceIssue, postPayment, reverseSource } from "./accounting";
import { returnForInvoice, stockForInvoice } from "./inventory";
import { corporateDiscountFor } from "./corporate";

const LINE_KINDS = ["SERVICE", "PRODUCT", "PROGRAM", "SUBSCRIPTION", "SURGERY", "OTHER"] as const;
const money = z.coerce.number().min(0).max(1e10);

export const lineSchema = z.object({
  kind: z.enum(LINE_KINDS),
  description: z.string().trim().max(300).optional().nullable(),
  quantity: z.coerce.number().positive().max(1e6).default(1),
  unitPrice: money.optional().nullable(),
  discount: money.default(0),
  taxRate: z.coerce.number().min(0).max(100).optional().nullable(),
  serviceId: uuidOpt, productId: uuidOpt, appointmentId: uuidOpt, clientProgramId: uuidOpt, subscriptionId: uuidOpt, surgeryId: uuidOpt, performedById: uuidOpt,
});

export const invoiceSchema = z.object({
  clientId: uuidOpt,
  branchId: uuidOpt,
  lines: z.array(lineSchema).min(1).max(200),
  discountAmount: money.default(0),
  couponCode: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  redeemPoints: z.coerce.number().int().min(0).max(1e9).default(0),
  salesStaffId: uuidOpt,
  notes: optText(2000),
  dueDate: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)),
  installments: z.array(z.object({ dueDate: z.coerce.date(), amount: z.coerce.number().positive() })).max(60).optional().nullable(),
});
type InvoiceInput = z.infer<typeof invoiceSchema>;

type Resolved = {
  kind: LineKind; description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; discount: Prisma.Decimal; taxRate: Prisma.Decimal; lineTotal: Prisma.Decimal;
  serviceId: string | null; productId: string | null; appointmentId: string | null; clientProgramId: string | null; subscriptionId: string | null; surgeryId: string | null; performedById: string | null;
};

const SOURCE_KEYS = ["appointmentId", "clientProgramId", "subscriptionId", "surgeryId"] as const;

async function assertNotBilled(tx: Tx, tenantId: string, key: (typeof SOURCE_KEYS)[number], id: string, excludeInvoiceId?: string) {
  const l = await tx.invoiceLine.findFirst({
    where: { tenantId, [key]: id, voided: false, ...(excludeInvoiceId ? { invoiceId: { not: excludeInvoiceId } } : {}) },
    include: { invoice: { select: { code: true, status: true } } },
  });
  if (l) throw new AppError(409, "ALREADY_BILLED", `Already billed on ${l.invoice.code ?? "a draft invoice"}`, { invoiceId: l.invoiceId });
}

async function resolveLines(tx: Tx, tenantId: string, clientId: string | null, lines: InvoiceInput["lines"], defaultTax: Prisma.Decimal, excludeInvoiceId?: string) {
  const out: Resolved[] = [];
  const needClient = (what: string) => { if (!clientId) throw badRequest(`Select a client to bill ${what}`); };
  for (const [i, l] of lines.entries()) {
    let description = l.description ?? "";
    let price: Prisma.Decimal | null = l.unitPrice != null ? D(l.unitPrice) : null;
    let serviceId = l.serviceId, productId = l.productId, performedById = l.performedById;
    let taxRate = l.taxRate != null ? D(l.taxRate) : defaultTax;
    for (const k of SOURCE_KEYS) if (l[k]) await assertNotBilled(tx, tenantId, k, l[k]!, excludeInvoiceId);

    if (l.kind === "SERVICE") {
      if (l.appointmentId) {
        needClient("an appointment");
        const a = await tx.appointment.findFirst({ where: { id: l.appointmentId, tenantId }, include: { service: true } });
        if (!a || a.clientId !== clientId) throw badRequest("Appointment not found for this client");
        if (!["COMPLETED", "CHECKED_IN"].includes(a.status)) throw conflict("Only attended appointments can be billed");
        if (a.programItemId || a.subscriptionId) throw conflict("This visit is prepaid by a program/subscription");
        serviceId = serviceId ?? a.serviceId;
        performedById = performedById ?? a.staffId;
        price = price ?? (a.price ? D(a.price) : a.service ? D(a.service.price) : null);
        description = description || a.service?.name || "زيارة";
      }
      if (!serviceId && !description) throw badRequest(`Line ${i + 1}: choose a service`);
      if (serviceId) {
        const s = await tx.service.findFirst({ where: { id: serviceId, tenantId } });
        if (!s) throw badRequest("Service not found");
        price = price ?? D(s.price);
        description = description || s.name;
      }
    } else if (l.kind === "PRODUCT") {
      const p = l.productId ? await tx.product.findFirst({ where: { id: l.productId, tenantId } }) : null;
      if (!p || !p.isActive) throw badRequest(`Line ${i + 1}: product not found or inactive`);
      if (!p.isSellable) throw badRequest(`Line ${i + 1}: ${p.name} is a material, not for sale`);
      price = price ?? D(p.price);
      description = description || p.name;
      if (l.taxRate == null && p.taxRate != null) taxRate = D(p.taxRate);
    } else if (l.kind === "PROGRAM") {
      needClient("a program");
      const p = l.clientProgramId ? await tx.clientProgram.findFirst({ where: { id: l.clientProgramId, tenantId } }) : null;
      if (!p || p.clientId !== clientId) throw badRequest("Program not found for this client");
      if (p.status === "CANCELLED") throw conflict("Program is cancelled");
      price = price ?? D(p.price);
      description = description || `${p.name} (${p.code})`;
    } else if (l.kind === "SUBSCRIPTION") {
      needClient("a subscription");
      const s = l.subscriptionId ? await tx.clientSubscription.findFirst({ where: { id: l.subscriptionId, tenantId } }) : null;
      if (!s || s.clientId !== clientId) throw badRequest("Subscription not found for this client");
      if (s.status === "CANCELLED") throw conflict("Subscription is cancelled");
      price = price ?? D(s.price);
      description = description || `${s.name} (${s.code})`;
    } else if (l.kind === "SURGERY") {
      needClient("a surgery");
      const s = l.surgeryId ? await tx.surgery.findFirst({ where: { id: l.surgeryId, tenantId } }) : null;
      if (!s || s.clientId !== clientId) throw badRequest("Surgery not found for this client");
      if (s.status === "CANCELLED") throw conflict("Surgery is cancelled");
      price = price ?? D(s.price);
      serviceId = serviceId ?? s.serviceId;
      performedById = performedById ?? s.surgeonId;
      description = description || `${s.surgeryType} (${s.code})`;
    } else if (!description || price == null) {
      throw badRequest(`Line ${i + 1}: description and price are required`);
    }
    if (performedById && !(await tx.user.findFirst({ where: { id: performedById, tenantId } }))) throw badRequest("Staff member not found");
    const qty = D(l.quantity);
    const gross = r2(qty.times(price ?? 0));
    const discount = D(l.discount);
    if (discount.greaterThan(gross)) throw badRequest(`Line ${i + 1}: discount exceeds the line amount`);
    out.push({
      kind: l.kind, description: description.slice(0, 300), quantity: qty, unitPrice: D(price ?? 0), discount, taxRate, lineTotal: gross.minus(discount),
      serviceId: serviceId ?? null, productId: productId ?? null, appointmentId: l.appointmentId ?? null, clientProgramId: l.clientProgramId ?? null,
      subscriptionId: l.subscriptionId ?? null, surgeryId: l.surgeryId ?? null, performedById: performedById ?? null,
    });
  }
  return out;
}

function invoiceType(lines: Resolved[]): InvoiceType {
  const map: Record<LineKind, InvoiceType> = { SERVICE: "SERVICE", OTHER: "SERVICE", PRODUCT: "SALE", PROGRAM: "PROGRAM", SUBSCRIPTION: "SUBSCRIPTION", SURGERY: "SURGERY" };
  const kinds = new Set(lines.map((l) => map[l.kind]));
  return kinds.size === 1 ? [...kinds][0] : "MIXED";
}

/** Builds everything that gets persisted; validates coupon & points. */
async function build(tx: Tx, ctx: Ctx, tenantId: string, d: InvoiceInput, excludeInvoiceId?: string) {
  const s = await settingsTx(tx, tenantId);
  const client = d.clientId ? await requireClient(tx, ctx, tenantId, d.clientId, 400) : null;
  const branchId = d.branchId ?? client?.branchId ?? (await defaultBranchId(tx, ctx, tenantId));
  assertBranchAccess(ctx, branchId);
  if (d.salesStaffId && !(await tx.user.findFirst({ where: { id: d.salesStaffId, tenantId } }))) throw badRequest("Sales staff not found");
  const lines = await resolveLines(tx, tenantId, d.clientId ?? null, d.lines, D(s.defaultTaxRate), excludeInvoiceId);

  // Plan gating: coupons / loyalty only if the tenant's plan includes those modules.
  if (d.couponCode && !ctx.features.has("coupons")) throw new AppError(403, "FEATURE_DISABLED", "Coupons are not included in your plan");
  if (d.redeemPoints && !ctx.features.has("loyalty")) throw new AppError(403, "FEATURE_DISABLED", "Loyalty is not included in your plan");
  const subtotal = sum(lines.map((l) => l.lineTotal));
  // Phase 5: corporate agreement discount comes first (automatic for eligible members).
  const corp = ctx.features.has("corporate") ? await corporateDiscountFor(tx, tenantId, d.clientId ?? null, lines, new Date()) : null;
  const corporateDiscount = corp?.discount ?? ZERO;
  if (corp && d.couponCode && !corp.agreement.allowCoupons) throw new AppError(409, "COUPON_INVALID", "Coupons can't be combined with this client's corporate agreement");
  const afterCorp = subtotal.minus(corporateDiscount);
  const manual = D(d.discountAmount);
  if (manual.greaterThan(afterCorp)) throw badRequest("Discount exceeds the invoice subtotal");
  let couponId: string | null = null, couponDiscount = ZERO;
  if (d.couponCode) {
    const ev = await evaluateCoupon(tx, tenantId, d.couponCode, { clientId: d.clientId ?? null, lines, subtotal, cap: afterCorp.minus(manual), excludeInvoiceId });
    couponId = ev.coupon.id; couponDiscount = ev.discount;
  }
  let loyaltyDiscount = ZERO;
  if (d.redeemPoints) {
    loyaltyDiscount = r2(min(await redemptionValue(tx, tenantId, d.clientId ?? null, d.redeemPoints), max0(afterCorp.minus(manual).minus(couponDiscount))));
  }
  const discounts = corporateDiscount.plus(manual).plus(couponDiscount).plus(loyaltyDiscount);
  const factor = subtotal.isZero() ? ZERO : D(1).minus(discounts.dividedBy(subtotal));
  const taxed = lines.map((l) => ({ ...l, taxAmount: r2(l.lineTotal.times(factor).times(l.taxRate).dividedBy(100)) }));
  const taxTotal = sum(taxed.map((l) => l.taxAmount));
  const total = r2(subtotal.minus(discounts).plus(taxTotal));
  return {
    branchId, lines: taxed, settings: s,
    header: {
      clientId: d.clientId ?? null, branchId, type: invoiceType(lines), subtotal, discountAmount: manual, couponDiscount, loyaltyDiscount, taxTotal, total,
      couponId, loyaltyPointsRedeemed: d.redeemPoints, salesStaffId: d.salesStaffId ?? null, notes: d.notes ?? null, dueDate: d.dueDate ?? null,
      corporateDiscount, corporateAgreementId: corp?.agreement.id ?? null,
    },
  };
}

const lineRows = (tenantId: string, invoiceId: string, lines: Awaited<ReturnType<typeof build>>["lines"]) =>
  lines.map((l, i) => ({ ...l, tenantId, invoiceId, sortOrder: i }));

// --------------------------------------------------------------- write ----

async function persist(tx: Tx, ctx: Ctx, tenantId: string, d: InvoiceInput, opts: { id?: string; issue: boolean }) {
  const b = await build(tx, ctx, tenantId, d, opts.id);
  const currency = (await tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { baseCurrency: true } })).baseCurrency;
  let inv;
  if (opts.id) {
    await tx.invoiceLine.deleteMany({ where: { tenantId, invoiceId: opts.id } });
    inv = await tx.invoice.update({ where: { id: opts.id }, data: { ...b.header, lines: { createMany: { data: lineRows(tenantId, opts.id, b.lines).map(({ invoiceId: _i, ...r }) => r) } } } });
  } else {
    inv = await tx.invoice.create({ data: { ...b.header, tenantId, currency, createdById: ctx.user.id } });
    await tx.invoiceLine.createMany({ data: lineRows(tenantId, inv.id, b.lines) });
  }
  if (opts.issue) inv = await issueTx(tx, ctx, tenantId, inv.id, d.installments ?? null, b.settings.invoiceDueDays);
  return inv;
}

async function issueTx(tx: Tx, ctx: Ctx, tenantId: string, id: string, installments: { dueDate: Date; amount: number }[] | null, dueDays: number) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
  const code = `INV-${String(await nextCounter(tx, tenantId, "invoice")).padStart(6, "0")}`;
  const now = new Date();
  if (installments?.length) {
    const total = sum(installments.map((x) => D(x.amount)));
    if (!r2(total).equals(D(inv.total))) throw badRequest(`Installments must add up to the invoice total (${inv.total})`);
    const sorted = [...installments].sort((a, b) => +a.dueDate - +b.dueDate);
    await tx.invoiceInstallment.createMany({ data: sorted.map((x, i) => ({ tenantId, invoiceId: id, seq: i + 1, dueDate: x.dueDate, amount: D(x.amount) })) });
  }
  if (inv.couponId) await tx.couponRedemption.create({ data: { tenantId, couponId: inv.couponId, invoiceId: id, clientId: inv.clientId, discount: inv.couponDiscount } });
  if (inv.loyaltyPointsRedeemed && inv.clientId) {
    await tx.loyaltyTransaction.create({ data: { tenantId, clientId: inv.clientId, type: "REDEEM", points: -inv.loyaltyPointsRedeemed, invoiceId: id, createdById: ctx.user.id } });
  }
  const dueDate = inv.dueDate ?? (installments?.length ? null : addDaysUTC(todayDate(), dueDays));
  let issued = await tx.invoice.update({ where: { id }, data: { code, status: "ISSUED", issuedAt: now, dueDate } });
  // Phase 5: ledger entry (Dr AR / Cr revenue + tax) and stock deduction for sold products.
  await postInvoiceIssue(tx, tenantId, id, ctx.user.id);
  await stockForInvoice(tx, ctx, tenantId, id);
  if (D(issued.total).isZero()) {
    issued = await tx.invoice.update({ where: { id }, data: { status: "PAID" } });
    await onPaid(tx, ctx, tenantId, id);
  }
  await audit(tx, ctx, { action: "invoice.issue", entity: "Invoice", entityId: id, after: { code, total: issued.total, clientId: issued.clientId } });
  return issued;
}

async function onPaid(tx: Tx, ctx: Ctx, tenantId: string, id: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
  if (ctx.features.has("loyalty")) await earnForInvoice(tx, tenantId, inv, ctx.user.id);
  if (ctx.features.has("commissions")) await generateForInvoice(tx, tenantId, id);
  if (ctx.features.has("marketing")) await influencerForInvoice(tx, tenantId, id);
}

export async function createInvoice(ctx: Ctx, raw: unknown, opts: { issue?: boolean } = {}) {
  const tenantId = requireTenant(ctx, "invoices.create");
  const d = invoiceSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const inv = await persist(tx, ctx, tenantId, d, { issue: !!opts.issue });
    if (!opts.issue) await audit(tx, ctx, { action: "invoice.draft", entity: "Invoice", entityId: inv.id, after: { total: inv.total } });
    return inv;
  });
}

export async function updateDraft(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "invoices.update");
  const d = invoiceSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!inv) throw notFound("Invoice not found");
    if (inv.status !== "DRAFT") throw conflict("Issued invoices can't be edited — cancel or refund instead");
    return persist(tx, ctx, tenantId, d, { id, issue: false });
  });
}

export async function issueInvoice(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "invoices.create");
  const { installments } = z.object({ installments: invoiceSchema.shape.installments }).parse(raw ?? {});
  return withTenant(tenantId, async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) }, include: { lines: true, coupon: true } });
    if (!inv) throw notFound("Invoice not found");
    if (inv.status !== "DRAFT") throw conflict("Invoice is already issued");
    // Re-validate everything (prices, coupon, points, billing sources) at issue time.
    const d = invoiceSchema.parse({
      clientId: inv.clientId, branchId: inv.branchId, discountAmount: inv.discountAmount, couponCode: inv.coupon?.code ?? null, redeemPoints: inv.loyaltyPointsRedeemed,
      salesStaffId: inv.salesStaffId, notes: inv.notes, dueDate: inv.dueDate, installments,
      lines: inv.lines.sort((a, b) => a.sortOrder - b.sortOrder).map((l) => ({ ...l, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discount: Number(l.discount), taxRate: Number(l.taxRate) })),
    });
    return persist(tx, ctx, tenantId, d, { id, issue: true });
  });
}

export async function deleteDraft(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "invoices.delete");
  return withTenant(tenantId, async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!inv) throw notFound("Invoice not found");
    if (inv.status !== "DRAFT") throw conflict("Only drafts can be deleted — cancel issued invoices");
    await tx.invoice.delete({ where: { id } });
    await audit(tx, ctx, { action: "invoice.draft.delete", entity: "Invoice", entityId: id, before: inv });
    return { ok: true };
  });
}

export const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(1e10),
  method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]),
  reference: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  note: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  paidAt: z.coerce.date().optional(),
  /** cash box / bank receiving the money; default = branch box (cash) or main bank */
  cashAccountId: uuidOpt,
});

async function addPaymentTx(tx: Tx, ctx: Ctx, tenantId: string, id: string, p: z.infer<typeof paymentSchema>) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
  if (!["ISSUED", "PARTIALLY_PAID"].includes(inv.status)) throw conflict(inv.status === "DRAFT" ? "Issue the invoice before taking payment" : `Invoice is ${inv.status.toLowerCase()}`);
  const amount = r2(D(p.amount));
  const balance = D(inv.total).minus(inv.paidTotal);
  if (amount.greaterThan(balance)) throw badRequest(`Amount exceeds the balance due (${balance})`);
  const receiptNo = `RCPT-${String(await nextCounter(tx, tenantId, "receipt")).padStart(6, "0")}`;
  const pay = await tx.payment.create({ data: { tenantId, invoiceId: id, kind: "PAYMENT", receiptNo, amount, method: p.method, reference: p.reference, note: p.note, paidAt: p.paidAt ?? new Date(), receivedById: ctx.user.id, cashAccountId: p.cashAccountId } });
  await postPayment(tx, tenantId, pay.id, ctx.user.id);
  const paidTotal = D(inv.paidTotal).plus(amount);
  const paid = paidTotal.equals(D(inv.total));
  await tx.invoice.update({ where: { id }, data: { paidTotal, status: paid ? "PAID" : "PARTIALLY_PAID" } });
  if (paid) await onPaid(tx, ctx, tenantId, id);
  await audit(tx, ctx, { action: "invoice.payment", entity: "Payment", entityId: pay.id, after: { invoice: inv.code, receiptNo, amount, method: p.method } });
  return pay;
}

export async function addPayment(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "invoices.create");
  const p = paymentSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.invoice.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } }))) throw notFound("Invoice not found");
    return addPaymentTx(tx, ctx, tenantId, id, p);
  });
}

export async function refundInvoice(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "invoices.approve");
  const r = z.object({ amount: z.coerce.number().positive(), method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]), reason: z.string().trim().min(2).max(300), cashAccountId: uuidOpt }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!inv) throw notFound("Invoice not found");
    const amount = r2(D(r.amount));
    if (amount.greaterThan(inv.paidTotal)) throw badRequest(`Refund exceeds the amount paid (${inv.paidTotal})`);
    const wasPaid = inv.status === "PAID";
    const receiptNo = `RFND-${String(await nextCounter(tx, tenantId, "refund")).padStart(6, "0")}`;
    const pay = await tx.payment.create({ data: { tenantId, invoiceId: id, kind: "REFUND", receiptNo, amount, method: r.method, note: r.reason, receivedById: ctx.user.id, cashAccountId: r.cashAccountId } });
    await postPayment(tx, tenantId, pay.id, ctx.user.id);
    const paidTotal = D(inv.paidTotal).minus(amount);
    const after = await tx.invoice.update({
      where: { id },
      data: { paidTotal, refundedTotal: D(inv.refundedTotal).plus(amount), status: paidTotal.isZero() ? "REFUNDED" : "PARTIALLY_PAID" },
    });
    // Earned loyalty & commissions exist only once an invoice was fully paid.
    const ratio = D(inv.total).isZero() ? 0 : amount.dividedBy(inv.total).toNumber();
    if (wasPaid || (await tx.commissionEntry.count({ where: { tenantId, invoiceId: id } }))) {
      await reverseCommissions(tx, tenantId, id, ratio);
      await reverseInfluencerForInvoice(tx, tenantId, id, ratio);
      await reverseLoyalty(tx, tenantId, id, ratio, { restoreRedeemed: paidTotal.isZero() }, ctx.user.id);
    }
    await audit(tx, ctx, { action: "invoice.refund", entity: "Payment", entityId: pay.id, after: { invoice: inv.code, receiptNo, amount, reason: r.reason } });
    return after;
  });
}

export async function cancelInvoice(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "invoices.approve");
  const { reason } = z.object({ reason: z.string().trim().min(2).max(300) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!inv) throw notFound("Invoice not found");
    if (inv.status === "DRAFT") throw conflict("Delete drafts instead of cancelling");
    if (inv.status === "CANCELLED") throw conflict("Invoice is already cancelled");
    if (D(inv.paidTotal).greaterThan(0)) throw conflict("Refund the payments before cancelling");
    await tx.invoiceLine.updateMany({ where: { tenantId, invoiceId: id }, data: { voided: true } }); // frees sources for re-billing
    await tx.couponRedemption.deleteMany({ where: { tenantId, invoiceId: id } });
    await reverseLoyalty(tx, tenantId, id, 1, { restoreRedeemed: true }, ctx.user.id);
    await voidForInvoice(tx, tenantId, id);
    await voidInfluencerForInvoice(tx, tenantId, id);
    await reverseSource(tx, tenantId, "INVOICE", id, "INVOICE_CANCEL", ctx.user.id, `إلغاء فاتورة ${inv.code}`);
    await returnForInvoice(tx, ctx, tenantId, id);
    const after = await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
    await audit(tx, ctx, { action: "invoice.cancel", entity: "Invoice", entityId: id, before: { status: inv.status }, after: { status: "CANCELLED", reason } });
    return after;
  });
}

// ---------------------------------------------------------------- read ----

const listInclude = { client: { select: { id: true, code: true, fullName: true, phone: true } }, branch: { select: { name: true } } } satisfies Prisma.InvoiceInclude;

export async function listInvoices(ctx: Ctx, q: { status?: string; type?: string; clientId?: string; from?: string; to?: string; search?: string; unpaid?: boolean; page?: number } = {}) {
  const tenantId = requireTenant(ctx, "invoices.view");
  const where: Prisma.InvoiceWhereInput = { tenantId, ...recordBranchScope(ctx) };
  if (q.status) where.status = q.status as never;
  if (q.unpaid) where.status = { in: ["ISSUED", "PARTIALLY_PAID"] };
  if (q.type) where.type = q.type as never;
  if (q.clientId) where.clientId = q.clientId;
  if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
  if (q.search) where.OR = [{ code: { contains: q.search.toUpperCase() } }, { client: { fullName: { contains: q.search, mode: "insensitive" } } }, { client: { phone: { contains: q.search } } }];
  const page = Math.max(1, q.page ?? 1);
  return withTenant(tenantId, async (tx) => {
    const [items, total, agg] = await Promise.all([
      tx.invoice.findMany({ where, include: listInclude, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
      tx.invoice.count({ where }),
      tx.invoice.aggregate({ where: { ...where, status: q.unpaid ? where.status : { notIn: ["DRAFT", "CANCELLED"] } }, _sum: { total: true, paidTotal: true } }),
    ]);
    return { items: items.map((i) => ({ ...i, balance: D(i.total).minus(i.paidTotal) })), total, page, sums: { total: agg._sum.total ?? ZERO, paid: agg._sum.paidTotal ?? ZERO } };
  });
}

export async function getInvoice(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "invoices.view");
  return withTenant(tenantId, async (tx) => {
    const inv = await tx.invoice.findFirst({
      where: { id, tenantId, ...recordBranchScope(ctx) },
      include: {
        ...listInclude, branch: { select: { name: true, phone: true, address: true } }, coupon: { select: { code: true, name: true } },
        salesStaff: { select: { fullName: true } },
        lines: { orderBy: { sortOrder: "asc" }, include: { performedBy: { select: { fullName: true } } } },
        payments: { orderBy: { paidAt: "asc" } }, installments: { orderBy: { seq: "asc" } },
      },
    });
    if (!inv) throw notFound("Invoice not found");
    // Installment status: allocate paid amount in due-date order.
    let left = D(inv.paidTotal);
    const today = todayDate();
    const installments = inv.installments.map((x) => {
      const paid = min(left, D(x.amount)); left = left.minus(paid);
      const due = D(x.amount).minus(paid);
      return { ...x, paid, due, status: due.isZero() ? "PAID" : x.dueDate < today ? "OVERDUE" : paid.greaterThan(0) ? "PARTIAL" : "DUE" };
    });
    const [tenant, settings, loyalty, commissions] = await Promise.all([
      tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { name: true, logoUrl: true, contactPhone: true, address: true, contactEmail: true } }),
      settingsTx(tx, tenantId),
      tx.loyaltyTransaction.findMany({ where: { tenantId, invoiceId: id }, orderBy: { createdAt: "asc" } }),
      ctx.permissions.has("commissions.view") ? tx.commissionEntry.findMany({ where: { tenantId, invoiceId: id }, include: { user: { select: { fullName: true } } } }) : [],
    ]);
    return { ...inv, installments, balance: D(inv.total).minus(inv.paidTotal), tenant, taxName: settings.taxName, footer: settings.invoiceFooter, loyalty, commissions };
  });
}

/** Unpaid invoices with aging and per-client totals. */
export async function receivables(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "invoices.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.invoice.findMany({
      where: { tenantId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, ...recordBranchScope(ctx) },
      include: { ...listInclude, installments: { orderBy: { seq: "asc" } } }, orderBy: { dueDate: "asc" },
    });
    const today = todayDate();
    const buckets = { current: ZERO, d1_30: ZERO, d31_60: ZERO, d61_90: ZERO, d90p: ZERO };
    const items = rows.map((r) => {
      const balance = D(r.total).minus(r.paidTotal);
      // first unpaid installment's date, else invoice due date
      let left = D(r.paidTotal), due = r.dueDate;
      for (const x of r.installments) { const p = min(left, D(x.amount)); left = left.minus(p); if (D(x.amount).greaterThan(p)) { due = x.dueDate; break; } }
      const daysOverdue = due ? Math.floor((+today - +due) / 86400000) : 0;
      const k = daysOverdue <= 0 ? "current" : daysOverdue <= 30 ? "d1_30" : daysOverdue <= 60 ? "d31_60" : daysOverdue <= 90 ? "d61_90" : "d90p";
      buckets[k] = buckets[k].plus(balance);
      return { id: r.id, code: r.code, client: r.client, branch: r.branch, total: r.total, paidTotal: r.paidTotal, balance, dueDate: due, daysOverdue: Math.max(0, daysOverdue), installments: r.installments.length };
    });
    const byClient = Object.values(items.reduce<Record<string, { client: (typeof items)[number]["client"]; balance: Prisma.Decimal; invoices: number; maxOverdue: number }>>((m, i) => {
      const k = i.client?.id ?? "walk-in";
      m[k] ??= { client: i.client, balance: ZERO, invoices: 0, maxOverdue: 0 };
      m[k].balance = m[k].balance.plus(i.balance); m[k].invoices++; m[k].maxOverdue = Math.max(m[k].maxOverdue, i.daysOverdue);
      return m;
    }, {})).sort((a, b) => b.balance.minus(a.balance).toNumber());
    return { items, byClient, buckets, total: sum(items.map((i) => i.balance)) };
  });
}

// ---------------------------------------------------- bill a source ----

export async function billSource(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "invoices.create");
  const d = z.object({ source: z.enum(["appointment", "program", "subscription", "surgery"]), id: z.string().uuid() }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    let clientId: string | null = null; let line: InvoiceInput["lines"][number];
    const base = { quantity: 1, discount: 0, serviceId: null, productId: null, appointmentId: null, clientProgramId: null, subscriptionId: null, surgeryId: null, performedById: null };
    if (d.source === "appointment") {
      const a = await tx.appointment.findFirst({ where: { id: d.id, tenantId } });
      if (!a) throw notFound("Appointment not found");
      clientId = a.clientId; line = { ...base, kind: "SERVICE", appointmentId: a.id };
    } else if (d.source === "program") {
      const p = await tx.clientProgram.findFirst({ where: { id: d.id, tenantId } });
      if (!p) throw notFound("Program not found");
      clientId = p.clientId; line = { ...base, kind: "PROGRAM", clientProgramId: p.id };
    } else if (d.source === "subscription") {
      const s = await tx.clientSubscription.findFirst({ where: { id: d.id, tenantId } });
      if (!s) throw notFound("Subscription not found");
      clientId = s.clientId; line = { ...base, kind: "SUBSCRIPTION", subscriptionId: s.id };
    } else {
      const s = await tx.surgery.findFirst({ where: { id: d.id, tenantId } });
      if (!s) throw notFound("Surgery not found");
      clientId = s.clientId; line = { ...base, kind: "SURGERY", surgeryId: s.id };
    }
    const inv = await persist(tx, ctx, tenantId, invoiceSchema.parse({ clientId, lines: [line] }), { issue: false });
    await audit(tx, ctx, { action: `invoice.from.${d.source}`, entity: "Invoice", entityId: inv.id, after: { sourceId: d.id } });
    return inv;
  });
}

/** Which sources of this client are already billed (for "bill" buttons). */
export async function billedSources(ctx: Ctx, clientId: string) {
  const tenantId = requireTenant(ctx, "invoices.view");
  return withTenant(tenantId, async (tx) => {
    const lines = await tx.invoiceLine.findMany({ where: { tenantId, voided: false, invoice: { clientId } }, select: { appointmentId: true, clientProgramId: true, subscriptionId: true, surgeryId: true, invoiceId: true } });
    return lines;
  });
}

// ------------------------------------------------------------------ POS ----

export const checkoutSchema = invoiceSchema.extend({
  payments: z.array(paymentSchema.omit({ paidAt: true })).max(10).default([]),
});

/** One-step sale: build + issue + take payments in a single transaction. */
export async function posCheckout(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "pos.create");
  if (!ctx.permissions.has("invoices.create")) throw new AppError(403, "FORBIDDEN", "POS checkout also needs invoices.create");
  const d = checkoutSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const inv = await persist(tx, ctx, tenantId, d, { issue: true });
    const paid = sum(d.payments.map((p) => D(p.amount)));
    if (paid.greaterThan(inv.total)) throw badRequest(`Payments (${paid}) exceed the total (${inv.total})`);
    if (!inv.clientId && paid.lessThan(inv.total)) throw badRequest("Walk-in sales must be paid in full — select a client to leave a balance");
    for (const p of d.payments) if (p.amount > 0) await addPaymentTx(tx, ctx, tenantId, inv.id, p);
    return tx.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { payments: true } });
  });
}

// -------------------------------------------------------------- products ----

export const productSchema = z.object({
  name: z.string().trim().min(1).max(160), nameEn: z.string().trim().max(160).optional().nullable().transform((v) => v || null),
  sku: z.string().trim().max(60).optional().nullable().transform((v) => v || null), barcode: z.string().trim().max(60).optional().nullable().transform((v) => v || null),
  unit: z.string().trim().max(20).default("قطعة"), price: money, cost: money.default(0),
  taxRate: z.coerce.number().min(0).max(100).optional().nullable().or(z.literal("").transform(() => null)), isActive: z.boolean().default(true),
  trackStock: z.boolean().default(false), isSellable: z.boolean().default(true), isConsumable: z.boolean().default(false), expiryTracking: z.boolean().default(false),
  minStock: z.coerce.number().min(0).default(0), groupId: uuidOpt,
});

export async function listProducts(ctx: Ctx, activeOnly = false) {
  const tenantId = requireTenant(ctx, ctx.permissions.has("services.view") ? "services.view" : "pos.view");
  return withTenant(tenantId, (tx) => tx.product.findMany({ where: { tenantId, ...(activeOnly ? { isActive: true } : {}) }, orderBy: { name: "asc" } }));
}
export async function saveProduct(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "services.update" : "services.create");
  const d = productSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = id ? await tx.product.findFirst({ where: { id, tenantId } }) : null;
    if (id && !before) throw notFound("Product not found");
    const p = id ? await tx.product.update({ where: { id }, data: d }) : await tx.product.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "product.update" : "product.create", entity: "Product", entityId: p.id, before, after: p });
    return p;
  });
}

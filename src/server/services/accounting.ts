/**
 * Double-entry accounting.
 *  - A default chart of accounts is created lazily per tenant (ensureChart).
 *  - Every cash box / bank account has its own ledger account.
 *  - Business operations post journal entries IN THE SAME TRANSACTION:
 *      invoice issue   Dr AR / Cr revenue (by line kind, net of discounts) / Cr tax
 *      payment         Dr cash|bank / Cr AR          refund  Dr revenue+tax / Cr cash|bank
 *      invoice cancel  reversal of the issue entry
 *      stock           receipt Dr inventory / Cr AP|cash; sale & consumption Dr COGS / Cr inventory …
 *      payroll         Dr salaries + commissions / Cr advances + salaries payable; paid Dr payable / Cr cash
 *  - Entries are immutable (app role has no UPDATE/DELETE); corrections are reversals.
 *  - A deferred DB trigger rejects any unbalanced entry at commit.
 */
import { z } from "zod";
import { Prisma, type AccountType, type JournalSource, type LineKind } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { nextCounter, optText, recordBranchScope, uuidOpt } from "./common";
import { D, r2, sum, ZERO } from "./money";

type Def = { code: string; name: string; nameEn: string; type: AccountType; parent?: string; group?: boolean; key?: string };
export const DEFAULT_CHART: Def[] = [
  { code: "1", name: "الأصول", nameEn: "Assets", type: "ASSET", group: true },
  { code: "11", name: "الأصول المتداولة", nameEn: "Current assets", type: "ASSET", parent: "1", group: true },
  { code: "1101", name: "النقد في الصناديق", nameEn: "Cash on hand", type: "ASSET", parent: "11", group: true, key: "CASH_GROUP" },
  { code: "1102", name: "النقد في البنوك", nameEn: "Cash at banks", type: "ASSET", parent: "11", group: true, key: "BANK_GROUP" },
  { code: "1103", name: "الذمم المدينة - العملاء", nameEn: "Accounts receivable", type: "ASSET", parent: "11", key: "AR" },
  { code: "1104", name: "المخزون", nameEn: "Inventory", type: "ASSET", parent: "11", key: "INVENTORY" },
  { code: "1105", name: "سلف الموظفين", nameEn: "Employee advances", type: "ASSET", parent: "11", key: "ADVANCES" },
  { code: "12", name: "الأصول الثابتة", nameEn: "Fixed assets", type: "ASSET", parent: "1", group: true },
  { code: "1201", name: "الأجهزة الطبية والمعدات", nameEn: "Medical equipment", type: "ASSET", parent: "12" },
  { code: "1202", name: "الأثاث والتجهيزات", nameEn: "Furniture & fittings", type: "ASSET", parent: "12" },
  { code: "2", name: "الخصوم", nameEn: "Liabilities", type: "LIABILITY", group: true },
  { code: "2101", name: "الذمم الدائنة - الموردون", nameEn: "Accounts payable", type: "LIABILITY", parent: "2", key: "AP" },
  { code: "2102", name: "رواتب مستحقة", nameEn: "Salaries payable", type: "LIABILITY", parent: "2", key: "SALARIES_PAYABLE" },
  { code: "2103", name: "ضرائب مستحقة", nameEn: "Tax payable", type: "LIABILITY", parent: "2", key: "TAX_PAYABLE" },
  { code: "3", name: "حقوق الملكية", nameEn: "Equity", type: "EQUITY", group: true },
  { code: "3101", name: "رأس المال", nameEn: "Capital", type: "EQUITY", parent: "3", key: "CAPITAL" },
  { code: "3102", name: "الأرباح المحتجزة", nameEn: "Retained earnings", type: "EQUITY", parent: "3", key: "RETAINED" },
  { code: "4", name: "الإيرادات", nameEn: "Revenue", type: "REVENUE", group: true },
  { code: "4101", name: "إيرادات الخدمات", nameEn: "Service revenue", type: "REVENUE", parent: "4", key: "REV_SERVICES" },
  { code: "4102", name: "إيرادات المنتجات", nameEn: "Product sales", type: "REVENUE", parent: "4", key: "REV_PRODUCTS" },
  { code: "4103", name: "إيرادات البرامج والاشتراكات", nameEn: "Programs & subscriptions", type: "REVENUE", parent: "4", key: "REV_PACKAGES" },
  { code: "4104", name: "إيرادات العمليات الجراحية", nameEn: "Surgery revenue", type: "REVENUE", parent: "4", key: "REV_SURGERY" },
  { code: "4105", name: "إيرادات أخرى", nameEn: "Other income", type: "REVENUE", parent: "4", key: "REV_OTHER" },
  { code: "5", name: "المصروفات", nameEn: "Expenses", type: "EXPENSE", group: true },
  { code: "5101", name: "تكلفة المواد المستهلكة والمبيعات", nameEn: "Cost of materials & goods sold", type: "EXPENSE", parent: "5", key: "COGS" },
  { code: "5102", name: "الرواتب والأجور", nameEn: "Salaries & wages", type: "EXPENSE", parent: "5", key: "SALARIES" },
  { code: "5103", name: "العمولات", nameEn: "Commissions", type: "EXPENSE", parent: "5", key: "COMMISSIONS" },
  { code: "5104", name: "الإيجار", nameEn: "Rent", type: "EXPENSE", parent: "5", key: "RENT" },
  { code: "5105", name: "الكهرباء والماء والاتصالات", nameEn: "Utilities", type: "EXPENSE", parent: "5", key: "UTILITIES" },
  { code: "5106", name: "التسويق والإعلان", nameEn: "Marketing", type: "EXPENSE", parent: "5", key: "MARKETING" },
  { code: "5107", name: "الصيانة", nameEn: "Maintenance", type: "EXPENSE", parent: "5", key: "MAINTENANCE" },
  { code: "5108", name: "التالف والمفقود من المخزون", nameEn: "Inventory waste", type: "EXPENSE", parent: "5", key: "WASTE" },
  { code: "5109", name: "فروقات الجرد", nameEn: "Stock count differences", type: "EXPENSE", parent: "5", key: "INV_ADJUST" },
  { code: "5110", name: "مصروفات عمومية وإدارية", nameEn: "General & administrative", type: "EXPENSE", parent: "5", key: "GENERAL" },
];
export type SystemKey = "AR" | "INVENTORY" | "ADVANCES" | "AP" | "SALARIES_PAYABLE" | "TAX_PAYABLE" | "CAPITAL" | "RETAINED" | "REV_SERVICES" | "REV_PRODUCTS" | "REV_PACKAGES"
  | "REV_SURGERY" | "REV_OTHER" | "COGS" | "SALARIES" | "COMMISSIONS" | "WASTE" | "INV_ADJUST" | "GENERAL" | "CASH_GROUP" | "BANK_GROUP" | "MARKETING";

const REVENUE_FOR: Record<LineKind, SystemKey> = { SERVICE: "REV_SERVICES", OTHER: "REV_OTHER", PRODUCT: "REV_PRODUCTS", PROGRAM: "REV_PACKAGES", SUBSCRIPTION: "REV_PACKAGES", SURGERY: "REV_SURGERY" };

/** Creates the default chart once; returns systemKey → accountId. */
export async function ensureChart(tx: Tx, tenantId: string) {
  let keyed = await tx.account.findMany({ where: { tenantId, systemKey: { not: null } }, select: { id: true, systemKey: true } });
  if (!keyed.length) {
    const ids: Record<string, string> = {};
    for (const a of DEFAULT_CHART) {
      const row = await tx.account.create({ data: { tenantId, code: a.code, name: a.name, nameEn: a.nameEn, type: a.type, isGroup: !!a.group, systemKey: a.key ?? null, parentId: a.parent ? ids[a.parent] : null } });
      ids[a.code] = row.id;
    }
    keyed = await tx.account.findMany({ where: { tenantId, systemKey: { not: null } }, select: { id: true, systemKey: true } });
  }
  return Object.fromEntries(keyed.map((k) => [k.systemKey!, k.id])) as Record<SystemKey, string>;
}

async function createCashLedger(tx: Tx, tenantId: string, kind: "CASH" | "BANK", name: string) {
  const keys = await ensureChart(tx, tenantId);
  const parentId = keys[kind === "CASH" ? "CASH_GROUP" : "BANK_GROUP"];
  const parent = await tx.account.findUniqueOrThrow({ where: { id: parentId } });
  const n = await tx.account.count({ where: { tenantId, parentId } });
  return tx.account.create({ data: { tenantId, code: `${parent.code}-${String(n + 1).padStart(2, "0")}`, name, type: "ASSET", parentId } });
}

/** Default cash box (per branch) or bank account, created on first need. */
export async function cashAccountFor(tx: Tx, tenantId: string, opts: { branchId?: string | null; method?: string; cashAccountId?: string | null }) {
  if (opts.cashAccountId) {
    const c = await tx.cashAccount.findFirst({ where: { id: opts.cashAccountId, tenantId, isActive: true } });
    if (!c) throw badRequest("Cash box / bank account not found");
    return c;
  }
  const kind = !opts.method || opts.method === "CASH" ? "CASH" : "BANK";
  const where: Prisma.CashAccountWhereInput = kind === "CASH" ? { tenantId, kind, isActive: true, branchId: opts.branchId ?? undefined } : { tenantId, kind, isActive: true };
  const found = (await tx.cashAccount.findFirst({ where: { ...where, isDefault: true } })) ?? (await tx.cashAccount.findFirst({ where }));
  if (found) return found;
  const tenant = await tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { baseCurrency: true } });
  const branch = opts.branchId ? await tx.branch.findFirst({ where: { id: opts.branchId, tenantId } }) : await tx.branch.findFirst({ where: { tenantId, isMain: true } });
  const name = kind === "CASH" ? `صندوق ${branch?.name ?? "الرئيسي"}` : "الحساب البنكي الرئيسي";
  const acc = await createCashLedger(tx, tenantId, kind, name);
  return tx.cashAccount.create({ data: { tenantId, kind, name, branchId: kind === "CASH" ? branch?.id ?? null : null, accountId: acc.id, currency: tenant.baseCurrency, isDefault: true } });
}

// --------------------------------------------------------------- posting ----

export type PostLine = { accountId?: string; key?: SystemKey; amount: Prisma.Decimal; side: "dr" | "cr"; description?: string | null; branchId?: string | null; clientId?: string | null; supplierId?: string | null; fcCurrency?: string | null; fcAmount?: Prisma.Decimal | null };
export const dr = (x: Omit<PostLine, "side">): PostLine => ({ ...x, side: "dr" });
export const cr = (x: Omit<PostLine, "side">): PostLine => ({ ...x, side: "cr" });

export async function postEntry(tx: Tx, tenantId: string, e: { date: Date; description: string; source: JournalSource; sourceId?: string | null; branchId?: string | null; userId?: string | null; reversalOfId?: string | null; lines: PostLine[] }) {
  const keys = await ensureChart(tx, tenantId);
  // Normalise: negative amounts flip side; drop zero lines.
  const lines = e.lines.map((l) => {
    const amt = r2(D(l.amount));
    return amt.isNegative() ? { ...l, amount: amt.negated(), side: l.side === "dr" ? "cr" : "dr" } : { ...l, amount: amt };
  }).filter((l) => !l.amount.isZero()) as PostLine[];
  if (!lines.length) return null;
  const drs = sum(lines.filter((l) => l.side === "dr").map((l) => l.amount));
  const crs = sum(lines.filter((l) => l.side === "cr").map((l) => l.amount));
  if (!drs.equals(crs)) throw new Error(`Unbalanced posting for ${e.source}: ${drs} ≠ ${crs}`);
  const code = `JV-${String(await nextCounter(tx, tenantId, "journal")).padStart(6, "0")}`;
  const entry = await tx.journalEntry.create({
    data: { tenantId, code, date: e.date, description: e.description.slice(0, 300), source: e.source, sourceId: e.sourceId ?? null, branchId: e.branchId ?? null, reversalOfId: e.reversalOfId ?? null, createdById: e.userId ?? null },
  });
  await tx.journalLine.createMany({
    data: lines.map((l) => {
      const accountId = l.accountId ?? keys[l.key!];
      if (!accountId) throw new Error(`No account for ${l.key}`);
      return {
        tenantId, entryId: entry.id, accountId, debit: l.side === "dr" ? l.amount : ZERO, credit: l.side === "cr" ? l.amount : ZERO,
        description: l.description ?? null, branchId: l.branchId ?? e.branchId ?? null, clientId: l.clientId ?? null, supplierId: l.supplierId ?? null,
        fcCurrency: l.fcCurrency ?? null, fcAmount: l.fcAmount ?? null,
      };
    }),
  });
  return entry;
}

/** Posts the mirror image of every entry of a source (cancellations, voids). */
export async function reverseSource(tx: Tx, tenantId: string, source: JournalSource, sourceId: string, as: JournalSource, userId: string | null, description: string) {
  const entries = await tx.journalEntry.findMany({ where: { tenantId, source, sourceId, reversalOfId: null }, include: { lines: true } });
  for (const en of entries) {
    if (await tx.journalEntry.findFirst({ where: { tenantId, reversalOfId: en.id } })) continue;
    await postEntry(tx, tenantId, {
      date: new Date(), description: `${description} (${en.code})`, source: as, sourceId, branchId: en.branchId, userId, reversalOfId: en.id,
      lines: en.lines.map((l) => ({ accountId: l.accountId, amount: D(l.debit).greaterThan(0) ? D(l.debit) : D(l.credit), side: D(l.debit).greaterThan(0) ? "cr" : "dr", branchId: l.branchId, clientId: l.clientId, supplierId: l.supplierId })),
    });
  }
}

/** Net (after invoice-level discounts) per line, rounding remainder on the largest line. */
function revenueSplit(inv: { subtotal: Prisma.Decimal; discountAmount: Prisma.Decimal; couponDiscount: Prisma.Decimal; loyaltyDiscount: Prisma.Decimal; corporateDiscount: Prisma.Decimal; total: Prisma.Decimal; taxTotal: Prisma.Decimal }, lines: { kind: LineKind; lineTotal: Prisma.Decimal }[]) {
  const discounts = D(inv.discountAmount).plus(inv.couponDiscount).plus(inv.loyaltyDiscount).plus(inv.corporateDiscount);
  const factor = D(inv.subtotal).isZero() ? ZERO : D(1).minus(discounts.dividedBy(inv.subtotal));
  const byKey = new Map<SystemKey, Prisma.Decimal>();
  for (const l of lines) { const k = REVENUE_FOR[l.kind]; byKey.set(k, (byKey.get(k) ?? ZERO).plus(r2(D(l.lineTotal).times(factor)))); }
  const target = D(inv.total).minus(inv.taxTotal);
  const diff = target.minus(sum([...byKey.values()]));
  if (!diff.isZero() && byKey.size) { const [k, v] = [...byKey.entries()].sort((a, b) => b[1].minus(a[1]).toNumber())[0]; byKey.set(k, v.plus(diff)); }
  return byKey;
}

export async function postInvoiceIssue(tx: Tx, tenantId: string, invoiceId: string, userId: string | null) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { where: { voided: false } } } });
  if (D(inv.total).isZero()) return null;
  const rev = revenueSplit(inv, inv.lines);
  return postEntry(tx, tenantId, {
    date: inv.issuedAt ?? new Date(), description: `فاتورة ${inv.code}`, source: "INVOICE", sourceId: inv.id, branchId: inv.branchId, userId,
    lines: [
      dr({ key: "AR", amount: D(inv.total), clientId: inv.clientId }),
      ...[...rev.entries()].map(([key, amount]) => cr({ key, amount })),
      cr({ key: "TAX_PAYABLE", amount: D(inv.taxTotal) }),
    ],
  });
}

export async function postPayment(tx: Tx, tenantId: string, paymentId: string, userId: string | null) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true } });
  const cash = await cashAccountFor(tx, tenantId, { branchId: p.invoice.branchId, method: p.method, cashAccountId: p.cashAccountId });
  if (!p.cashAccountId) await tx.payment.update({ where: { id: p.id }, data: { cashAccountId: cash.id } });
  if (p.kind === "PAYMENT") {
    return postEntry(tx, tenantId, {
      date: p.paidAt, description: `قبض ${p.receiptNo} — ${p.invoice.code}`, source: "PAYMENT", sourceId: p.id, branchId: p.invoice.branchId, userId,
      lines: [dr({ accountId: cash.accountId, amount: D(p.amount) }), cr({ key: "AR", amount: D(p.amount), clientId: p.invoice.clientId })],
    });
  }
  // Refund: reverses the sale proportionally (revenue + tax) and pays cash out.
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId }, include: { lines: { where: { voided: false } } } });
  const ratio = D(p.amount).dividedBy(inv.total);
  const rev = revenueSplit(inv, inv.lines);
  const tax = r2(D(inv.taxTotal).times(ratio));
  const parts = [...rev.entries()].map(([key, v]) => ({ key, amount: r2(v.times(ratio)) }));
  const diff = D(p.amount).minus(tax).minus(sum(parts.map((x) => x.amount)));
  if (parts.length) parts[0].amount = parts[0].amount.plus(diff);
  return postEntry(tx, tenantId, {
    date: p.paidAt, description: `استرجاع ${p.receiptNo} — ${inv.code}`, source: "REFUND", sourceId: p.id, branchId: inv.branchId, userId,
    lines: [...parts.map((x) => dr({ key: x.key, amount: x.amount })), dr({ key: "TAX_PAYABLE", amount: tax }), cr({ accountId: cash.accountId, amount: D(p.amount) })],
  });
}

export async function postStockDocument(tx: Tx, tenantId: string, docId: string, userId: string | null) {
  const doc = await tx.stockDocument.findUniqueOrThrow({ where: { id: docId } });
  const wh = await tx.warehouse.findUniqueOrThrow({ where: { id: doc.warehouseId } });
  const total = D(doc.totalCost);
  if (total.isZero()) return null;
  const base = { date: doc.date, sourceId: doc.id, source: "STOCK" as const, branchId: wh.branchId, userId };
  const desc = (t: string) => `${t} ${doc.code}`;
  switch (doc.type) {
    case "RECEIPT": {
      const credit = doc.cashAccountId
        ? cr({ accountId: (await cashAccountFor(tx, tenantId, { cashAccountId: doc.cashAccountId })).accountId, amount: total })
        : cr({ key: "AP", amount: total, supplierId: doc.supplierId });
      return postEntry(tx, tenantId, { ...base, description: desc("استلام مواد"), lines: [dr({ key: "INVENTORY", amount: total }), credit] });
    }
    case "SALE": case "CONSUMPTION": case "ISSUE":
      return postEntry(tx, tenantId, { ...base, description: desc(doc.type === "SALE" ? "تكلفة مبيعات" : "صرف مواد"), lines: [dr({ key: "COGS", amount: total }), cr({ key: "INVENTORY", amount: total })] });
    case "RETURN":
      return postEntry(tx, tenantId, { ...base, description: desc("إرجاع مواد"), lines: [dr({ key: "INVENTORY", amount: total }), cr({ key: "COGS", amount: total })] });
    case "WASTE":
      return postEntry(tx, tenantId, { ...base, description: desc("إتلاف مواد"), lines: [dr({ key: "WASTE", amount: total }), cr({ key: "INVENTORY", amount: total })] });
    case "ADJUSTMENT": // totalCost is signed: + surplus, − shortage
      return postEntry(tx, tenantId, { ...base, description: desc("تسوية جرد"), lines: [dr({ key: "INVENTORY", amount: total }), cr({ key: "INV_ADJUST", amount: total })] });
    case "TRANSFER": {
      const to = doc.toWarehouseId ? await tx.warehouse.findUnique({ where: { id: doc.toWarehouseId } }) : null;
      if (!to || to.branchId === wh.branchId) return null; // same branch: no accounting effect
      return postEntry(tx, tenantId, { ...base, description: desc("نقل مواد بين الفروع"), lines: [dr({ key: "INVENTORY", amount: total, branchId: to.branchId }), cr({ key: "INVENTORY", amount: total, branchId: wh.branchId })] });
    }
  }
}

const periodEnd = (period: string) => { const [y, m] = period.split("-").map(Number); const d = new Date(Date.UTC(y, m, 0, 12)); return d > new Date() ? new Date() : d; };

export async function postPayrollApproved(tx: Tx, tenantId: string, runId: string, userId: string | null) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { items: true } });
  const salaries = sum(run.items.map((i) => D(i.baseSalary).plus(i.allowances).minus(i.absenceDeduction).minus(i.deductions)));
  return postEntry(tx, tenantId, {
    // Accrual: the cost belongs to the payroll month (its last day), not the day it was approved.
    date: periodEnd(run.period), description: `استحقاق رواتب ${run.period}`, source: "PAYROLL", sourceId: run.id, userId,
    lines: [
      dr({ key: "SALARIES", amount: salaries }), dr({ key: "COMMISSIONS", amount: sum(run.items.map((i) => D(i.commissions))) }),
      cr({ key: "ADVANCES", amount: sum(run.items.map((i) => D(i.advances))) }), cr({ key: "SALARIES_PAYABLE", amount: sum(run.items.map((i) => D(i.net))) }),
    ],
  });
}

export async function postPayrollPaid(tx: Tx, tenantId: string, runId: string, cashAccountId: string | null, userId: string | null) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  const cash = await cashAccountFor(tx, tenantId, { method: "TRANSFER", cashAccountId });
  await tx.payrollRun.update({ where: { id: runId }, data: { paidFromCashAccountId: cash.id } });
  return postEntry(tx, tenantId, {
    date: run.paidAt ?? new Date(), description: `صرف رواتب ${run.period}`, source: "PAYROLL_PAYMENT", sourceId: run.id, userId,
    lines: [dr({ key: "SALARIES_PAYABLE", amount: D(run.totalNet) }), cr({ accountId: cash.accountId, amount: D(run.totalNet) })],
  });
}

export async function postAdvance(tx: Tx, tenantId: string, advanceId: string, userId: string | null) {
  const a = await tx.salaryAdvance.findUniqueOrThrow({ where: { id: advanceId } });
  const cash = await cashAccountFor(tx, tenantId, { cashAccountId: a.cashAccountId, method: "CASH" });
  if (!a.cashAccountId) await tx.salaryAdvance.update({ where: { id: a.id }, data: { cashAccountId: cash.id } });
  return postEntry(tx, tenantId, {
    date: a.givenAt, description: "سلفة موظف", source: "ADVANCE", sourceId: a.id, userId, branchId: cash.branchId,
    lines: [dr({ key: "ADVANCES", amount: D(a.amount) }), cr({ accountId: cash.accountId, amount: D(a.amount) })],
  });
}

// ------------------------------------------------------- chart of accounts ----

export async function listAccounts(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "accounting.view");
  return withTenant(tenantId, async (tx) => {
    await ensureChart(tx, tenantId);
    const [accounts, sums] = await Promise.all([
      tx.account.findMany({ where: { tenantId }, orderBy: { code: "asc" } }),
      tx.journalLine.groupBy({ by: ["accountId"], where: { tenantId }, _sum: { debit: true, credit: true } }),
    ]);
    return accounts.map((a) => {
      const s = sums.find((x) => x.accountId === a.id);
      const d = D(s?._sum.debit ?? 0), c = D(s?._sum.credit ?? 0);
      return { ...a, debit: d, credit: c, balance: ["ASSET", "EXPENSE"].includes(a.type) ? d.minus(c) : c.minus(d) };
    });
  });
}

export const accountSchema = z.object({
  code: z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z-]+$/),
  name: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  parentId: uuidOpt,
  isGroup: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export async function saveAccount(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "accounting.update" : "accounting.create");
  const d = accountSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await ensureChart(tx, tenantId);
    if (d.parentId) {
      const p = await tx.account.findFirst({ where: { id: d.parentId, tenantId } });
      if (!p || !p.isGroup) throw badRequest("Parent must be a group account");
      if (p.type !== d.type) throw badRequest("Account type must match its parent");
    }
    const before = id ? await tx.account.findFirst({ where: { id, tenantId } }) : null;
    if (id && !before) throw notFound("Account not found");
    if (before?.systemKey && (d.type !== before.type || d.isGroup !== before.isGroup)) throw conflict("System accounts keep their type");
    if (before && d.isGroup && !before.isGroup && (await tx.journalLine.count({ where: { accountId: id! } }))) throw conflict("An account with postings can't become a group");
    if ((!before || d.code !== before.code) && (await tx.account.findFirst({ where: { tenantId, code: d.code } }))) throw conflict("Account code already exists");
    const a = id ? await tx.account.update({ where: { id }, data: d }) : await tx.account.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "account.update" : "account.create", entity: "Account", entityId: a.id, before, after: a });
    return a;
  });
}

// ----------------------------------------------------- cash boxes & banks ----

export async function listCashAccounts(ctx: Ctx) {
  const tenantId = requireTenant(ctx, ctx.permissions.has("accounting.view") ? "accounting.view" : "invoices.view");
  return withTenant(tenantId, async (tx) => {
    await cashAccountFor(tx, tenantId, { method: "CASH" });
    const rows = await tx.cashAccount.findMany({ where: { tenantId, ...(recordBranchScope(ctx).branchId ? { OR: [{ branchId: null }, { branchId: { in: ctx.user.branchIds } }] } : {}) }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
    const sums = await tx.journalLine.groupBy({ by: ["accountId"], where: { tenantId, accountId: { in: rows.map((r) => r.accountId) } }, _sum: { debit: true, credit: true } });
    const branches = await tx.branch.findMany({ where: { tenantId }, select: { id: true, name: true } });
    return rows.map((r) => {
      const s = sums.find((x) => x.accountId === r.accountId);
      return { ...r, branch: branches.find((b) => b.id === r.branchId) ?? null, balance: D(s?._sum.debit ?? 0).minus(s?._sum.credit ?? 0) };
    });
  });
}

export const cashAccountSchema = z.object({
  kind: z.enum(["CASH", "BANK"]), name: z.string().trim().min(2).max(120), branchId: uuidOpt,
  bankName: z.string().trim().max(120).optional().nullable().transform((v) => v || null), accountNo: z.string().trim().max(60).optional().nullable().transform((v) => v || null),
  isDefault: z.boolean().default(false), isActive: z.boolean().default(true),
});

export async function saveCashAccount(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "accounting.update" : "accounting.create");
  const d = cashAccountSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (d.branchId && !(await tx.branch.findFirst({ where: { id: d.branchId, tenantId } }))) throw badRequest("Branch not found");
    if (d.isDefault) await tx.cashAccount.updateMany({ where: { tenantId, kind: d.kind, branchId: d.kind === "CASH" ? d.branchId : undefined, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
    let row;
    if (id) {
      const before = await tx.cashAccount.findFirst({ where: { id, tenantId } });
      if (!before) throw notFound("Cash account not found");
      if (before.kind !== d.kind) throw conflict("Can't change a cash box into a bank account");
      row = await tx.cashAccount.update({ where: { id }, data: d });
      await tx.account.update({ where: { id: before.accountId }, data: { name: d.name } });
    } else {
      const tenant = await tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { baseCurrency: true } });
      const acc = await createCashLedger(tx, tenantId, d.kind, d.name);
      row = await tx.cashAccount.create({ data: { ...d, tenantId, accountId: acc.id, currency: tenant.baseCurrency } });
    }
    await audit(tx, ctx, { action: id ? "cash_account.update" : "cash_account.create", entity: "CashAccount", entityId: row.id, after: row });
    return row;
  });
}

// ------------------------------------------------------- exchange rates ----

export async function rateFor(tx: Tx, tenantId: string, currency: string, date: Date) {
  const base = (await tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { baseCurrency: true } })).baseCurrency;
  if (currency === base) return D(1);
  const r = await tx.exchangeRate.findFirst({ where: { tenantId, currency, date: { lte: date } }, orderBy: { date: "desc" } });
  if (!r) throw badRequest(`No exchange rate for ${currency} — add one under Accounting → Currencies`);
  return D(r.rate);
}

export async function listRates(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "accounting.view");
  return withTenant(tenantId, (tx) => tx.exchangeRate.findMany({ where: { tenantId }, orderBy: [{ date: "desc" }, { currency: "asc" }], take: 200 }));
}

export async function addRate(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "accounting.create");
  const d = z.object({ currency: z.string().trim().toUpperCase().length(3), rate: z.coerce.number().positive(), date: z.coerce.date() }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const base = (await tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { baseCurrency: true } })).baseCurrency;
    if (d.currency === base) throw badRequest("That's the base currency");
    const date = new Date(Date.UTC(d.date.getUTCFullYear(), d.date.getUTCMonth(), d.date.getUTCDate()));
    const r = await tx.exchangeRate.upsert({ where: { tenantId_currency_date: { tenantId, currency: d.currency, date } }, create: { tenantId, currency: d.currency, rate: d.rate, date }, update: { rate: d.rate } });
    await audit(tx, ctx, { action: "fx.rate", entity: "ExchangeRate", entityId: r.id, after: r });
    return r;
  });
}

// ------------------------------------------------------ journals (manual) ----

export async function listJournals(ctx: Ctx, q: { source?: string; from?: string; to?: string; accountId?: string; search?: string; page?: number }) {
  const tenantId = requireTenant(ctx, "accounting.view");
  const where: Prisma.JournalEntryWhereInput = { tenantId };
  if (q.source) where.source = q.source as JournalSource;
  if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
  if (q.accountId) where.lines = { some: { accountId: q.accountId } };
  if (q.search) where.OR = [{ code: { contains: q.search.toUpperCase() } }, { description: { contains: q.search, mode: "insensitive" } }];
  const page = Math.max(1, q.page ?? 1);
  return withTenant(tenantId, async (tx) => {
    const [items, total] = await Promise.all([
      tx.journalEntry.findMany({ where, orderBy: [{ date: "desc" }, { code: "desc" }], skip: (page - 1) * 50, take: 50, include: { lines: { include: { account: { select: { code: true, name: true } } } } } }),
      tx.journalEntry.count({ where }),
    ]);
    return { items, total, page };
  });
}

export const manualJournalSchema = z.object({
  date: z.coerce.date(),
  description: z.string().trim().min(2).max(300),
  opening: z.boolean().default(false),
  branchId: uuidOpt,
  lines: z.array(z.object({ accountId: z.string().uuid(), debit: z.coerce.number().min(0).default(0), credit: z.coerce.number().min(0).default(0), description: optText(200) }))
    .min(2).max(100).refine((ls) => ls.every((l) => (l.debit > 0) !== (l.credit > 0)), "Each line needs either a debit or a credit"),
});

export async function createManualJournal(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "accounting.create");
  const d = manualJournalSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const accs = await tx.account.findMany({ where: { tenantId, id: { in: d.lines.map((l) => l.accountId) } } });
    if (accs.length !== new Set(d.lines.map((l) => l.accountId)).size) throw badRequest("Account not found");
    if (accs.some((a) => a.isGroup || !a.isActive)) throw badRequest("Post to active leaf accounts only (not groups)");
    const drs = r2(sum(d.lines.map((l) => D(l.debit)))), crs = r2(sum(d.lines.map((l) => D(l.credit))));
    if (!drs.equals(crs)) throw badRequest(`Entry is not balanced: debit ${drs} ≠ credit ${crs}`);
    const e = await postEntry(tx, tenantId, {
      date: d.date, description: d.description, source: d.opening ? "OPENING" : "MANUAL", branchId: d.branchId, userId: ctx.user.id,
      lines: d.lines.map((l) => (l.debit > 0 ? dr({ accountId: l.accountId, amount: D(l.debit), description: l.description }) : cr({ accountId: l.accountId, amount: D(l.credit), description: l.description }))),
    });
    await audit(tx, ctx, { action: "journal.manual", entity: "JournalEntry", entityId: e!.id, after: { code: e!.code, total: drs } });
    return e;
  });
}

export async function reverseJournal(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "accounting.approve");
  const { reason } = z.object({ reason: z.string().trim().min(2).max(200) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const e = await tx.journalEntry.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!e) throw notFound("Entry not found");
    if (!["MANUAL", "OPENING"].includes(e.source)) throw conflict("Automatic entries are reversed by cancelling their source document");
    if (e.reversalOfId || (await tx.journalEntry.findFirst({ where: { tenantId, reversalOfId: id } }))) throw conflict("Entry is already reversed");
    const r = await postEntry(tx, tenantId, {
      date: new Date(), description: `عكس ${e.code}: ${reason}`, source: "MANUAL", branchId: e.branchId, userId: ctx.user.id, reversalOfId: e.id,
      lines: e.lines.map((l) => ({ accountId: l.accountId, amount: D(l.debit).greaterThan(0) ? D(l.debit) : D(l.credit), side: D(l.debit).greaterThan(0) ? "cr" : "dr", branchId: l.branchId })),
    });
    await audit(tx, ctx, { action: "journal.reverse", entity: "JournalEntry", entityId: id, after: { reversal: r?.code, reason } });
    return r;
  });
}

// --------------------------------------------------------------- vouchers ----

export const voucherSchema = z.object({
  type: z.enum(["RECEIPT", "PAYMENT"]),
  date: z.coerce.date().default(() => new Date()),
  cashAccountId: z.string().uuid(),
  counterAccountId: z.string().uuid(),
  amount: z.coerce.number().positive().max(1e12),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  supplierId: uuidOpt, clientId: uuidOpt,
  payee: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  description: z.string().trim().min(2).max(300),
});

export async function createVoucher(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "accounting.create");
  const d = voucherSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const cash = await cashAccountFor(tx, tenantId, { cashAccountId: d.cashAccountId });
    const counter = await tx.account.findFirst({ where: { id: d.counterAccountId, tenantId } });
    if (!counter || counter.isGroup || !counter.isActive) throw badRequest("Choose an active leaf account");
    if (counter.id === cash.accountId) throw badRequest("Counter account can't be the cash box itself");
    if (d.supplierId && !(await tx.supplier.findFirst({ where: { id: d.supplierId, tenantId } }))) throw badRequest("Supplier not found");
    if (d.clientId && !(await tx.client.findFirst({ where: { id: d.clientId, tenantId } }))) throw badRequest("Client not found");
    const base = (await tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { baseCurrency: true } })).baseCurrency;
    const currency = d.currency ?? base;
    const rate = await rateFor(tx, tenantId, currency, d.date);
    const amount = r2(D(d.amount).times(rate));
    const prefix = d.type === "RECEIPT" ? "RV" : "PV";
    const code = `${prefix}-${String(await nextCounter(tx, tenantId, `voucher_${prefix}`)).padStart(6, "0")}`;
    const fc = currency !== base ? { fcCurrency: currency, fcAmount: D(d.amount) } : {};
    const cashLine = { accountId: cash.accountId, amount, ...fc };
    const counterLine = { accountId: counter.id, amount, supplierId: d.supplierId, clientId: d.clientId, ...fc };
    const e = await postEntry(tx, tenantId, {
      date: d.date, description: `${d.type === "RECEIPT" ? "سند قبض" : "سند صرف"} ${code}: ${d.description}`, source: "VOUCHER", branchId: cash.branchId, userId: ctx.user.id,
      lines: d.type === "RECEIPT" ? [dr(cashLine), cr(counterLine)] : [dr(counterLine), cr(cashLine)],
    });
    const v = await tx.voucher.create({
      data: {
        tenantId, code, type: d.type, date: d.date, cashAccountId: cash.id, counterAccountId: counter.id, amount, currency, fcAmount: D(d.amount), rate,
        supplierId: d.supplierId, clientId: d.clientId, payee: d.payee, description: d.description, branchId: cash.branchId, journalEntryId: e!.id, createdById: ctx.user.id,
      },
    });
    await audit(tx, ctx, { action: `voucher.${d.type.toLowerCase()}`, entity: "Voucher", entityId: v.id, after: v });
    return v;
  });
}

export async function voidVoucher(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "accounting.approve");
  const { reason } = z.object({ reason: z.string().trim().min(2).max(200) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const v = await tx.voucher.findFirst({ where: { id, tenantId } });
    if (!v) throw notFound("Voucher not found");
    if (v.status === "VOID") throw conflict("Voucher is already void");
    const e = await tx.journalEntry.findUniqueOrThrow({ where: { id: v.journalEntryId! }, include: { lines: true } });
    await postEntry(tx, tenantId, {
      date: new Date(), description: `إلغاء ${v.code}: ${reason}`, source: "VOUCHER", sourceId: v.id, branchId: e.branchId, userId: ctx.user.id, reversalOfId: e.id,
      lines: e.lines.map((l) => ({ accountId: l.accountId, amount: D(l.debit).greaterThan(0) ? D(l.debit) : D(l.credit), side: D(l.debit).greaterThan(0) ? "cr" : "dr", branchId: l.branchId, supplierId: l.supplierId, clientId: l.clientId })),
    });
    const after = await tx.voucher.update({ where: { id }, data: { status: "VOID" } });
    await audit(tx, ctx, { action: "voucher.void", entity: "Voucher", entityId: id, after: { reason } });
    return after;
  });
}

export async function listVouchers(ctx: Ctx, q: { type?: string; from?: string; to?: string; expensesOnly?: boolean }) {
  const tenantId = requireTenant(ctx, "accounting.view");
  return withTenant(tenantId, async (tx) => {
    const where: Prisma.VoucherWhereInput = { tenantId };
    if (q.type) where.type = q.type as never;
    if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
    if (q.expensesOnly) { where.type = "PAYMENT"; where.counterAccountId = { in: (await tx.account.findMany({ where: { tenantId, type: "EXPENSE" }, select: { id: true } })).map((a) => a.id) }; }
    const rows = await tx.voucher.findMany({ where, orderBy: [{ date: "desc" }, { code: "desc" }], take: 500 });
    const [accounts, cash, suppliers] = await Promise.all([
      tx.account.findMany({ where: { tenantId, id: { in: rows.map((r) => r.counterAccountId) } }, select: { id: true, code: true, name: true } }),
      tx.cashAccount.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      tx.supplier.findMany({ where: { tenantId, id: { in: rows.map((r) => r.supplierId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    ]);
    return rows.map((r) => ({ ...r, account: accounts.find((a) => a.id === r.counterAccountId), cash: cash.find((c) => c.id === r.cashAccountId), supplier: suppliers.find((s) => s.id === r.supplierId) ?? null }));
  });
}

// ---------------------------------------------------------------- reports ----

type Range = { from?: string; to?: string; branchId?: string };
const dateWhere = (q: Range): Prisma.JournalLineWhereInput => ({
  ...(q.from || q.to ? { entry: { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } } : {}),
  ...(q.branchId ? { branchId: q.branchId } : {}),
});
const natural = (type: AccountType, d: Prisma.Decimal, c: Prisma.Decimal) => (["ASSET", "EXPENSE"].includes(type) ? d.minus(c) : c.minus(d));

async function balances(tx: Tx, tenantId: string, where: Prisma.JournalLineWhereInput) {
  const rows = await tx.journalLine.groupBy({ by: ["accountId"], where: { tenantId, ...where }, _sum: { debit: true, credit: true } });
  return new Map(rows.map((r) => [r.accountId, { debit: D(r._sum.debit ?? 0), credit: D(r._sum.credit ?? 0) }]));
}

export async function trialBalance(ctx: Ctx, q: Range) {
  const tenantId = requireTenant(ctx, "accounting.view");
  return withTenant(tenantId, async (tx) => {
    await ensureChart(tx, tenantId);
    const [accounts, b] = await Promise.all([tx.account.findMany({ where: { tenantId, isGroup: false }, orderBy: { code: "asc" } }), balances(tx, tenantId, dateWhere(q))]);
    const rows = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, nameEn: a.nameEn, type: a.type, debit: b.get(a.id)?.debit ?? ZERO, credit: b.get(a.id)?.credit ?? ZERO }))
      .filter((r) => !r.debit.isZero() || !r.credit.isZero());
    return { rows, totals: { debit: sum(rows.map((r) => r.debit)), credit: sum(rows.map((r) => r.credit)) } };
  });
}

export async function incomeStatement(ctx: Ctx, q: Range & { byBranch?: boolean }) {
  const tenantId = requireTenant(ctx, "accounting.view");
  return withTenant(tenantId, async (tx) => {
    await ensureChart(tx, tenantId);
    const accounts = await tx.account.findMany({ where: { tenantId, type: { in: ["REVENUE", "EXPENSE"] }, isGroup: false }, orderBy: { code: "asc" } });
    const build = async (branchId?: string) => {
      const b = await balances(tx, tenantId, dateWhere({ ...q, branchId: branchId ?? q.branchId }));
      const rows = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, nameEn: a.nameEn, type: a.type, amount: natural(a.type, b.get(a.id)?.debit ?? ZERO, b.get(a.id)?.credit ?? ZERO) })).filter((r) => !r.amount.isZero());
      const revenue = sum(rows.filter((r) => r.type === "REVENUE").map((r) => r.amount));
      const expenses = sum(rows.filter((r) => r.type === "EXPENSE").map((r) => r.amount));
      return { rows, revenue, expenses, net: revenue.minus(expenses) };
    };
    const all = await build();
    const branches = q.byBranch ? await Promise.all((await tx.branch.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } })).map(async (br) => {
      const r = await build(br.id); return { id: br.id, name: br.name, revenue: r.revenue, expenses: r.expenses, net: r.net };
    })) : [];
    return { ...all, branches };
  });
}

export async function balanceSheet(ctx: Ctx, q: { asOf?: string; branchId?: string }) {
  const tenantId = requireTenant(ctx, "accounting.view");
  return withTenant(tenantId, async (tx) => {
    await ensureChart(tx, tenantId);
    const to = q.asOf ? new Date(+new Date(q.asOf) + 86400000) : undefined;
    const [accounts, b] = await Promise.all([tx.account.findMany({ where: { tenantId, isGroup: false }, orderBy: { code: "asc" } }), balances(tx, tenantId, dateWhere({ to: to?.toISOString(), branchId: q.branchId }))]);
    const bal = (a: (typeof accounts)[number]) => natural(a.type, b.get(a.id)?.debit ?? ZERO, b.get(a.id)?.credit ?? ZERO);
    const section = (t: AccountType) => accounts.filter((a) => a.type === t).map((a) => ({ id: a.id, code: a.code, name: a.name, nameEn: a.nameEn, amount: bal(a) })).filter((r) => !r.amount.isZero());
    const earnings = sum(accounts.filter((a) => a.type === "REVENUE").map(bal)).minus(sum(accounts.filter((a) => a.type === "EXPENSE").map(bal)));
    const assets = section("ASSET"), liabilities = section("LIABILITY"), equity = section("EQUITY");
    const totalAssets = sum(assets.map((r) => r.amount)), totalLiabilities = sum(liabilities.map((r) => r.amount)), totalEquity = sum(equity.map((r) => r.amount)).plus(earnings);
    return { assets, liabilities, equity, earnings, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets.equals(totalLiabilities.plus(totalEquity)) };
  });
}

/** Cash & bank movements in the period, grouped by what caused them. */
export async function cashFlow(ctx: Ctx, q: Range) {
  const tenantId = requireTenant(ctx, "accounting.view");
  return withTenant(tenantId, async (tx) => {
    const cashIds = (await tx.cashAccount.findMany({ where: { tenantId, ...(q.branchId ? { OR: [{ branchId: q.branchId }, { branchId: null }] } : {}) }, select: { accountId: true } })).map((c) => c.accountId);
    const opening = await tx.journalLine.aggregate({ where: { tenantId, accountId: { in: cashIds }, ...(q.from ? { entry: { date: { lt: new Date(q.from) } } } : { id: "00000000-0000-0000-0000-000000000000" }) }, _sum: { debit: true, credit: true } });
    const lines = await tx.journalLine.findMany({ where: { tenantId, accountId: { in: cashIds }, ...dateWhere(q) }, include: { entry: { select: { source: true } } } });
    const groups = new Map<string, { inflow: Prisma.Decimal; outflow: Prisma.Decimal }>();
    for (const l of lines) {
      const g = groups.get(l.entry.source) ?? { inflow: ZERO, outflow: ZERO };
      g.inflow = g.inflow.plus(l.debit); g.outflow = g.outflow.plus(l.credit);
      groups.set(l.entry.source, g);
    }
    const open = D(opening._sum.debit ?? 0).minus(opening._sum.credit ?? 0);
    const net = sum(lines.map((l) => D(l.debit).minus(l.credit)));
    return { opening: open, rows: [...groups.entries()].map(([source, v]) => ({ source, ...v, net: v.inflow.minus(v.outflow) })), net, closing: open.plus(net) };
  });
}

export async function accountLedger(ctx: Ctx, accountId: string, q: Range) {
  const tenantId = requireTenant(ctx, "accounting.view");
  return withTenant(tenantId, async (tx) => {
    const a = await tx.account.findFirst({ where: { id: accountId, tenantId } });
    if (!a) throw notFound("Account not found");
    const opening = q.from ? await tx.journalLine.aggregate({ where: { tenantId, accountId, entry: { date: { lt: new Date(q.from) } } }, _sum: { debit: true, credit: true } }) : null;
    const lines = await tx.journalLine.findMany({ where: { tenantId, accountId, ...dateWhere(q) }, include: { entry: { select: { code: true, date: true, description: true, source: true, sourceId: true } } }, orderBy: { entry: { date: "asc" } }, take: 3000 });
    let run = opening ? natural(a.type, D(opening._sum.debit ?? 0), D(opening._sum.credit ?? 0)) : ZERO;
    const open = run;
    return { account: a, opening: open, rows: lines.map((l) => { run = run.plus(natural(a.type, D(l.debit), D(l.credit))); return { ...l, balance: run }; }), closing: run };
  });
}

/** Amount owed to each supplier (AP balance by supplier). */
export async function supplierBalances(ctx: Ctx) {
  const tenantId = requireTenant(ctx, ctx.permissions.has("accounting.view") ? "accounting.view" : "inventory.view");
  return withTenant(tenantId, async (tx) => {
    const keys = await ensureChart(tx, tenantId);
    const rows = await tx.journalLine.groupBy({ by: ["supplierId"], where: { tenantId, accountId: keys.AP, supplierId: { not: null } }, _sum: { debit: true, credit: true } });
    const suppliers = await tx.supplier.findMany({ where: { tenantId }, select: { id: true, name: true, phone: true } });
    return rows.map((r) => ({ supplier: suppliers.find((s) => s.id === r.supplierId)!, balance: D(r._sum.credit ?? 0).minus(r._sum.debit ?? 0) })).filter((r) => r.supplier && !r.balance.isZero());
  });
}

export async function apAccountId(tx: Tx, tenantId: string) { return (await ensureChart(tx, tenantId)).AP; }

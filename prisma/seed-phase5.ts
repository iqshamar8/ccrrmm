/**
 * Phase 5 demo data.
 *   1. Ledger backfill (ALL tenants): Phase 4 invoices / payments / refunds /
 *      cancellations / advances / payroll were created before the ledger existed,
 *      so their journal entries are posted now and dated like the originals.
 *   2. Inventory (plans with "inventory"): item groups, consumable materials with
 *      lots & expiry, suppliers, a central warehouse, receipts, transfers to the
 *      branches, waste, purchase orders, an open stock count, service materials,
 *      and material consumption for recent completed visits.
 *   3. Accounting (plans with "accounting"): bank account, exchange rates,
 *      opening balances, monthly expense vouchers, a supplier payment.
 *   4. Corporate contracts (plans with "corporate"): companies, agreements,
 *      members and a few discounted invoices.
 * Idempotent per tenant. Standalone: npx tsx prisma/seed-phase5.ts
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { loadContext, type Ctx } from "../src/server/context";
import { disconnectAll, type Tx, withPlatform, withTenant } from "../src/server/db";
import {
  addRate, cashAccountFor, createManualJournal, createVoucher, ensureChart, postAdvance, postInvoiceIssue, postPayment,
  postPayrollApproved, postPayrollPaid, reverseSource, saveCashAccount,
} from "../src/server/services/accounting";
import {
  consumeForAppointment, issueStock, listWarehouses, receivePO, receiveStock, saveGroup, saveServiceMaterials, saveSupplier,
  saveWarehouse, setPOStatus, savePO, startCount, transferStock, getCount, updateCount,
} from "../src/server/services/inventory";
import { addMember, saveAgreement, saveCompany } from "../src/server/services/corporate";
import { addPayment, createInvoice, saveProduct } from "../src/server/services/billing";

const DAY = 86400000;
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ------------------------------------------------------------ 1. backfill --

async function backfillLedger(tenantId: string) {
  return withPlatform(async (tx) => {
    await ensureChart(tx, tenantId);
    const has = async (source: Prisma.JournalEntryWhereInput["source"], sourceId: string) => !!(await tx.journalEntry.findFirst({ where: { tenantId, source, sourceId } }));
    const redate = (source: string, sourceId: string, date: Date) => tx.journalEntry.updateMany({ where: { tenantId, source: source as never, sourceId }, data: { date } });
    let n = 0;
    const invoices = await tx.invoice.findMany({ where: { tenantId, issuedAt: { not: null } }, orderBy: { issuedAt: "asc" } });
    for (const inv of invoices) {
      if (!(await has("INVOICE", inv.id))) { if (await postInvoiceIssue(tx, tenantId, inv.id, null)) n++; }
      if (inv.status === "CANCELLED" && !(await has("INVOICE_CANCEL", inv.id))) {
        await reverseSource(tx, tenantId, "INVOICE", inv.id, "INVOICE_CANCEL", null, `إلغاء فاتورة ${inv.code}`);
        await redate("INVOICE_CANCEL", inv.id, inv.cancelledAt ?? inv.updatedAt);
      }
    }
    const pays = await tx.payment.findMany({ where: { tenantId }, orderBy: { paidAt: "asc" } });
    for (const p of pays) {
      const src = p.kind === "PAYMENT" ? "PAYMENT" : "REFUND";
      if (!(await has(src, p.id))) { await postPayment(tx, tenantId, p.id, null); n++; }
    }
    for (const a of await tx.salaryAdvance.findMany({ where: { tenantId } })) if (!(await has("ADVANCE", a.id))) { await postAdvance(tx, tenantId, a.id, null); n++; }
    for (const r of await tx.payrollRun.findMany({ where: { tenantId, status: { in: ["APPROVED", "PAID"] } } })) {
      if (!(await has("PAYROLL", r.id))) { await postPayrollApproved(tx, tenantId, r.id, null); n++; }
      if (r.status === "PAID" && !(await has("PAYROLL_PAYMENT", r.id))) { await postPayrollPaid(tx, tenantId, r.id, null, null); n++; }
    }
    return n;
  }, { timeout: 600000 });
}

// ----------------------------------------------------------- 2. inventory --

type Mat = { name: string; unit: string; cost: number; minStock: number; expiry: boolean; qty: number; group: number; kinds: string[]; per: number };
const MATS: Record<string, { iqd: boolean; mats: Mat[] }> = {
  "elite-beauty": { iqd: true, mats: [
    { name: "جل تبريد الليزر", unit: "مل", cost: 25, minStock: 3000, expiry: true, qty: 12000, group: 0, kinds: ["LASER"], per: 60 },
    { name: "قفازات نتريل (زوج)", unit: "زوج", cost: 250, minStock: 300, expiry: false, qty: 1500, group: 1, kinds: ["*"], per: 1 },
    { name: "شاش معقم", unit: "قطعة", cost: 150, minStock: 200, expiry: true, qty: 900, group: 1, kinds: ["*"], per: 2 },
    { name: "كمامة طبية", unit: "قطعة", cost: 100, minStock: 300, expiry: false, qty: 1200, group: 1, kinds: ["*"], per: 1 },
    { name: "حقنة 1 مل", unit: "قطعة", cost: 400, minStock: 150, expiry: true, qty: 600, group: 1, kinds: ["COSMETIC", "MEDICAL"], per: 2 },
    { name: "فيلر حمض الهيالورونيك 1 مل", unit: "عبوة", cost: 95000, minStock: 10, expiry: true, qty: 25, group: 0, kinds: ["COSMETIC"], per: 1 },
    { name: "مخدر موضعي كريم", unit: "غرام", cost: 300, minStock: 400, expiry: true, qty: 1500, group: 0, kinds: ["LASER", "COSMETIC"], per: 5 },
    { name: "رؤوس جهاز الهيدرافيشل", unit: "قطعة", cost: 6000, minStock: 40, expiry: false, qty: 60, group: 2, kinds: [], per: 1 },
  ] },
  "shifa-medical": { iqd: false, mats: [
    { name: "Surgical gloves (pair)", unit: "pair", cost: 0.3, minStock: 400, expiry: true, qty: 2000, group: 1, kinds: ["*"], per: 2 },
    { name: "Sterile gauze pack", unit: "pack", cost: 0.5, minStock: 200, expiry: true, qty: 1000, group: 1, kinds: ["*"], per: 1 },
    { name: "Suture kit", unit: "kit", cost: 6, minStock: 30, expiry: true, qty: 120, group: 2, kinds: ["SURGERY"], per: 2 },
    { name: "Lidocaine 2% vial", unit: "vial", cost: 2.5, minStock: 60, expiry: true, qty: 250, group: 0, kinds: ["SURGERY", "MEDICAL", "COSMETIC"], per: 1 },
    { name: "Syringe 5 ml", unit: "piece", cost: 0.15, minStock: 300, expiry: true, qty: 1500, group: 1, kinds: ["MEDICAL", "COSMETIC", "SURGERY"], per: 2 },
    { name: "Botulinum toxin 100U", unit: "vial", cost: 180, minStock: 8, expiry: true, qty: 18, group: 0, kinds: [], per: 1 },
    { name: "Compression bandage", unit: "roll", cost: 3, minStock: 50, expiry: false, qty: 150, group: 2, kinds: ["SURGERY"], per: 2 },
  ] },
};
const GROUPS = { ar: ["مواد طبية وأدوية", "مستهلكات", "أدوات ومستلزمات", "منتجات للبيع"], en: ["Drugs & injectables", "Disposables", "Instruments & supplies", "Retail products"] };
const SUPPLIERS = {
  ar: [["شركة الرافدين للتجهيزات الطبية", "علي حسين", "+964 770 111 2233"], ["مؤسسة بغداد للمستلزمات", "مصطفى كريم", "+964 780 222 3344"], ["الشركة الأوروبية للتجميل", "رنا جاسم", "+964 750 333 4455"]],
  en: [["Gulf Medical Supplies", "Ahmed Saleh", "+966 50 111 2233"], ["Al Noor Pharma", "Mona Fathi", "+966 55 222 3344"], ["EuroAesthetics Trading", "Karim Haddad", "+966 54 333 4455"]],
};

async function seedInventory(ctx: Ctx, slug: string, rand: () => number) {
  const tenantId = ctx.tenant!.id;
  const conf = MATS[slug];
  if (!conf) return "";
  const ar = conf.iqd;
  const groups: { id: string }[] = [];
  for (const [i, name] of (ar ? GROUPS.ar : GROUPS.en).entries()) groups.push(await saveGroup(ctx, null, { name, sortOrder: i }));
  const suppliers = [];
  for (const [name, contactName, phone] of ar ? SUPPLIERS.ar : SUPPLIERS.en) suppliers.push(await saveSupplier(ctx, null, { name, contactName, phone }));

  // Existing retail products become stock-tracked.
  await withPlatform((tx) => tx.product.updateMany({ where: { tenantId }, data: { trackStock: true, isSellable: true, groupId: groups[3].id, minStock: 5 } }));
  const retail = await withPlatform((tx) => tx.product.findMany({ where: { tenantId, isSellable: true } }));
  const mats = [];
  for (const m of conf.mats) {
    mats.push({ m, p: await saveProduct(ctx, null, { name: m.name, unit: m.unit, price: 0, cost: m.cost, trackStock: true, isSellable: false, isConsumable: true, expiryTracking: m.expiry, minStock: m.minStock, groupId: groups[m.group].id }) });
  }

  // Warehouses: each branch's default + a central store in the main branch.
  await listWarehouses(ctx);
  const { branches, whs } = await withPlatform(async (tx) => ({
    branches: await tx.branch.findMany({ where: { tenantId, isActive: true }, orderBy: [{ isMain: "desc" }, { createdAt: "asc" }] }),
    whs: await tx.warehouse.findMany({ where: { tenantId, isDefault: true } }),
  }));
  const main = branches[0];
  const central = await saveWarehouse(ctx, null, { branchId: main.id, code: "CENTRAL", name: ar ? "المستودع المركزي" : "Central store" });
  const branchWh = (bid: string) => whs.find((w) => w.branchId === bid)!;

  // Receipts into the central store, ~70 and ~25 days ago (two lots → FIFO by expiry).
  const docs: { id: string; date: Date }[] = [];
  const exp = (days: number) => new Date(Date.now() + days * DAY);
  for (const [k, ago] of [[0, 70], [1, 25]] as const) {
    const date = new Date(Date.now() - ago * DAY);
    const lines = mats.filter((_, i) => k === 0 || i % 2 === 0).map(({ m, p }, i) => ({
      itemId: p.id, quantity: k === 0 ? m.qty : Math.round(m.qty * 0.4), unitCost: m.cost * (k === 0 ? 1 : 1.05),
      lotNo: `L${k + 1}-${String(i + 1).padStart(3, "0")}`,
      // first lot of a couple of items expires soon / already expired → alerts
      expiryDate: m.expiry ? (k === 0 && i === 2 ? exp(-3) : k === 0 && i === 0 ? exp(20) : exp(200 + Math.floor(rand() * 400))) : null,
    }));
    const d = await receiveStock(ctx, { warehouseId: central.id, supplierId: suppliers[k].id, date, reference: `INV-SUP-${1000 + k}`, lines });
    docs.push({ id: d.id, date });
  }
  // Retail products: one receipt paid in cash.
  const cash = await withPlatform((tx) => cashAccountFor(tx, tenantId, { branchId: main.id, method: "CASH" }));
  const r3 = await receiveStock(ctx, { warehouseId: branchWh(main.id).id, supplierId: suppliers[2].id, cashAccountId: cash.id, date: new Date(Date.now() - 65 * DAY), reference: "CASH-PURCHASE",
    lines: retail.map((p) => ({ itemId: p.id, quantity: 40, unitCost: Number(p.cost) })) });
  docs.push({ id: r3.id, date: new Date(Date.now() - 65 * DAY) });

  // Transfers to every branch store (~60 days ago, then a top-up 20 days ago).
  for (const [ago, share] of [[60, 0.35], [20, 0.15]] as const) {
    for (const b of branches) {
      const lines = mats.map(({ m, p }) => ({ itemId: p.id, quantity: Math.max(1, Math.floor((m.qty * share) / branches.length)) }));
      try {
        const t = await transferStock(ctx, { fromWarehouseId: central.id, toWarehouseId: branchWh(b.id).id, date: new Date(Date.now() - ago * DAY), notes: ar ? "تزويد الفرع" : "Branch replenishment", lines });
        docs.push({ id: t.id, date: new Date(Date.now() - ago * DAY) });
      } catch { /* short stock on top-up — fine */ }
    }
  }
  // Waste: expired lot thrown away.
  const w = await issueStock(ctx, { type: "WASTE", warehouseId: branchWh(main.id).id, date: new Date(Date.now() - 10 * DAY), notes: ar ? "تلف عبوات بسبب سوء التخزين" : "Damaged in storage", lines: [{ itemId: mats[1].p.id, quantity: 5 }] });
  docs.push({ id: w.id, date: new Date(Date.now() - 10 * DAY) });

  // Service materials (bill of materials).
  const services = await withPlatform((tx) => tx.service.findMany({ where: { tenantId, isActive: true } }));
  let bom = 0;
  for (const s of services) {
    const list = mats.filter(({ m }) => m.kinds.includes("*") || m.kinds.includes(s.kind)).map(({ m, p }) => ({ itemId: p.id, quantity: m.per }));
    if (list.length) { await saveServiceMaterials(ctx, s.id, list); bom++; }
  }

  // Purchase orders: one received in part, one sent, one draft.
  const po1 = await savePO(ctx, null, { supplierId: suppliers[0].id, warehouseId: central.id, expectedDate: new Date(Date.now() - 5 * DAY), lines: mats.slice(0, 3).map(({ m, p }) => ({ itemId: p.id, quantity: Math.round(m.qty / 2), unitCost: m.cost })) });
  await setPOStatus(ctx, po1.id, { action: "ORDER" });
  const po1full = await withPlatform((tx) => tx.purchaseOrderLine.findMany({ where: { orderId: po1.id } }));
  const pr = await receivePO(ctx, po1.id, { lines: po1full.map((l, i) => ({ lineId: l.id, quantity: i === 0 ? Number(l.quantity) : Math.floor(Number(l.quantity) / 2), expiryDate: exp(365) })) });
  docs.push({ id: pr.id, date: new Date(Date.now() - 4 * DAY) });
  const po2 = await savePO(ctx, null, { supplierId: suppliers[1].id, warehouseId: central.id, expectedDate: exp(7), notes: ar ? "طلبية الشهر القادم" : "Next month's order", lines: mats.slice(3).map(({ m, p }) => ({ itemId: p.id, quantity: Math.round(m.qty / 3), unitCost: m.cost })) });
  await setPOStatus(ctx, po2.id, { action: "ORDER" });
  await savePO(ctx, null, { supplierId: suppliers[2].id, warehouseId: central.id, lines: [{ itemId: mats[mats.length - 1].p.id, quantity: 20, unitCost: mats[mats.length - 1].m.cost }] });

  // Back-date documents (and their movements, lots, journal lines' entry).
  await withPlatform(async (tx) => {
    for (const d of docs) {
      await tx.stockDocument.update({ where: { id: d.id }, data: { date: d.date, createdAt: d.date } });
      await tx.stockMovement.updateMany({ where: { documentId: d.id }, data: { createdAt: d.date } });
      await tx.stockLot.updateMany({ where: { id: { in: (await tx.stockMovement.findMany({ where: { documentId: d.id, quantity: { gt: 0 } }, select: { lotId: true } })).map((x) => x.lotId!).filter(Boolean) } }, data: { receivedAt: d.date } });
      await tx.journalEntry.updateMany({ where: { tenantId, source: "STOCK", sourceId: d.id }, data: { date: d.date } });
    }
  });

  // Material consumption for completed visits of the last 18 days.
  const appts = await withPlatform((tx) => tx.appointment.findMany({ where: { tenantId, status: "COMPLETED", serviceId: { not: null }, startsAt: { gte: new Date(Date.now() - 18 * DAY) } }, orderBy: { startsAt: "asc" } }));
  let cons = 0;
  for (const a of appts) {
    const r = await withTenant(tenantId, async (tx) => { await consumeForAppointment(tx, ctx, tenantId, a); return tx.stockDocument.findFirst({ where: { tenantId, appointmentId: a.id, type: "CONSUMPTION" } }); });
    if (r) {
      cons++;
      await withPlatform(async (tx) => {
        await tx.stockDocument.update({ where: { id: r.id }, data: { date: a.startsAt, createdAt: a.startsAt } });
        await tx.stockMovement.updateMany({ where: { documentId: r.id }, data: { createdAt: a.startsAt } });
        await tx.journalEntry.updateMany({ where: { tenantId, source: "STOCK", sourceId: r.id }, data: { date: a.startsAt } });
      });
    }
  }

  // An open stock count in the main branch store, half counted.
  const cnt = await startCount(ctx, { warehouseId: branchWh(main.id).id, notes: ar ? "جرد نهاية الشهر" : "Month-end count" });
  const full = await getCount(ctx, cnt.id);
  await updateCount(ctx, cnt.id, full.lines.slice(0, Math.ceil(full.lines.length / 2)).map((l, i) => ({ lineId: l.id, countedQty: Math.max(0, Number(l.expectedQty) - (i % 3 === 0 ? 2 : 0)) })));
  return `${mats.length} materials, ${suppliers.length} suppliers, ${docs.length} stock docs, ${cons} visit consumptions, ${bom} service BOMs`;
}

// ---------------------------------------------------------- 3. accounting --

async function seedAccounting(ctx: Ctx, slug: string) {
  const tenantId = ctx.tenant!.id;
  const usd = slug === "shifa-medical";
  const { keys, branches, cashes } = await withPlatform(async (tx: Tx) => {
    const keys = await ensureChart(tx, tenantId);
    const branches = await tx.branch.findMany({ where: { tenantId, isActive: true }, orderBy: [{ isMain: "desc" }, { createdAt: "asc" }] });
    for (const b of branches) await cashAccountFor(tx, tenantId, { branchId: b.id, method: "CASH" });
    return { keys, branches, cashes: await tx.cashAccount.findMany({ where: { tenantId, kind: "CASH" } }) };
  });
  const bank2 = await saveCashAccount(ctx, null, { kind: "BANK", name: usd ? "Al Rajhi Bank — operating" : "مصرف الرافدين — جاري", bankName: usd ? "Al Rajhi Bank" : "مصرف الرافدين", accountNo: "0012-445566-001" });
  const acc = async (code: string) => (await withPlatform((tx) => tx.account.findFirstOrThrow({ where: { tenantId, code } }))).id;
  const ago = (d: number) => new Date(Date.now() - d * DAY);
  const m = (v: number) => (usd ? v : v * 1300);

  // Rates (base USD): IQD and EUR.
  for (const [cur, rate] of (usd ? [["IQD", 0.000763], ["EUR", 1.08], ["SAR", 0.2667]] : [["USD", 1310], ["EUR", 1420]]) as [string, number][]) {
    await addRate(ctx, { currency: cur, rate, date: ago(90) });
    await addRate(ctx, { currency: cur, rate: rate * 1.004, date: ago(15) });
  }
  // Opening balances: capital paid into the bank + equipment.
  const bankLedger = (await withPlatform((tx) => tx.cashAccount.findUniqueOrThrow({ where: { id: bank2.id } }))).accountId;
  await createManualJournal(ctx, { date: ago(100), opening: true, description: "أرصدة افتتاحية", lines: [
    { accountId: bankLedger, debit: m(150000) }, { accountId: cashes[0].accountId, debit: m(8000) }, { accountId: await acc("1201"), debit: m(220000) }, { accountId: await acc("1202"), debit: m(35000) },
    { accountId: keys.CAPITAL, credit: m(413000) },
  ] });
  // Monthly expenses for the last 3 months.
  let v = 0;
  for (const mo of [80, 50, 20]) {
    for (const [code, amount, desc, payee] of [["5104", 6000, "إيجار المبنى", "مالك العقار"], ["5105", 900, "فاتورة الكهرباء والإنترنت", "شركة الخدمات"], ["5106", 2500, "حملة إعلانات انستغرام", "Meta"], ["5107", 400, "صيانة جهاز الليزر", "الشركة الفنية"]] as const) {
      await createVoucher(ctx, { type: "PAYMENT", date: ago(mo), cashAccountId: code === "5104" ? bank2.id : cashes[0].id, counterAccountId: await acc(code), amount: m(amount), description: desc, payee });
      v++;
    }
  }
  // A supplier paid in a foreign currency (EUR), and some other income.
  const sup = await withPlatform((tx) => tx.supplier.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } }));
  if (sup) { await createVoucher(ctx, { type: "PAYMENT", date: ago(8), cashAccountId: bank2.id, counterAccountId: keys.AP, supplierId: sup.id, amount: usd ? 500 : 400, currency: "EUR", description: "دفعة للمورد", payee: sup.name }); v++; }
  await createVoucher(ctx, { type: "RECEIPT", date: ago(12), cashAccountId: (cashes[1] ?? cashes[0]).id, counterAccountId: keys.REV_OTHER, amount: m(300), description: "إيجار ركن لعرض المنتجات", payee: "شركة التجميل" }); v++;
  return `${branches.length} cash boxes + bank, ${v} vouchers, opening balances`;
}

// ----------------------------------------------------------- 4. corporate --

async function seedCorporate(ctx: Ctx) {
  const tenantId = ctx.tenant!.id;
  const { clients, services } = await withPlatform(async (tx) => ({
    clients: await tx.client.findMany({ where: { tenantId, status: "ACTIVE", deletedAt: null, corporate: { none: {} } }, orderBy: { createdAt: "asc" }, take: 14 }),
    services: await tx.service.findMany({ where: { tenantId, isActive: true, kind: { not: "SURGERY" }, price: { gt: 0 } }, orderBy: { price: "asc" } }),
  }));
  const ago = (d: number) => new Date(Date.now() - d * DAY);
  const companies = [
    { c: { name: "Saudi Aramco — Medical benefits", contactName: "Faisal Al-Otaibi", phone: "+966 13 872 0000", email: "benefits@aramco.test" }, pct: 20, all: true, family: true },
    { c: { name: "Al Rajhi Bank — Staff program", contactName: "Noura Al-Qahtani", phone: "+966 11 211 6000", email: "hr@alrajhi.test" }, pct: 15, all: false, family: false },
    { c: { name: "STC — Employee wellness", contactName: "Omar Bakr", phone: "+966 11 452 0000", email: "wellness@stc.test" }, pct: 10, all: true, family: false },
  ];
  let mem = 0, inv = 0;
  for (const [i, x] of companies.entries()) {
    // Resumable: a company that already exists is completed, not duplicated.
    const existing = await withPlatform((tx) => tx.corporateAccount.findFirst({ where: { tenantId, name: x.c.name }, include: { agreements: true, members: true } }));
    const co = existing ?? (await saveCompany(ctx, null, x.c));
    if (!existing?.agreements.length) await saveAgreement(ctx, co.id, null, { name: `اتفاقية ${new Date().getUTCFullYear()}`, startDate: ago(120), endDate: new Date(Date.now() + 245 * DAY), discountPercent: x.pct,
      allServices: x.all, serviceIds: x.all ? [] : services.slice(0, 4).map((s) => s.id), memberTypes: x.family ? ["EMPLOYEE", "FAMILY"] : ["EMPLOYEE"], allowCoupons: i === 2 });
    if (i === 2) { // expired agreement history
      await saveAgreement(ctx, co.id, null, { name: "اتفاقية سابقة", startDate: ago(500), endDate: ago(121), discountPercent: 8, isActive: true });
    }
    const members = existing?.members.length
      ? await withPlatform((tx) => tx.client.findMany({ where: { tenantId, id: { in: existing.members.map((m) => m.clientId) } } }))
      : clients.slice(i * 5, i * 5 + 5);
    if (!existing?.members.length) for (const [j, cl] of members.entries()) {
      await addMember(ctx, co.id, { clientId: cl.id, memberType: x.family && j === 4 ? "FAMILY" : "EMPLOYEE", employeeNo: `EMP-${1000 + i * 100 + j}` });
      mem++;
    }
    // Two discounted visits per company.
    for (const cl of members.slice(0, 2)) {
      const svc = x.all ? services[Math.min(services.length - 1, 2 + inv)] : services[0];
      if (!svc || (await withPlatform((tx) => tx.invoice.findFirst({ where: { tenantId, clientId: cl.id, corporateAgreementId: { not: null } } })))) continue;
      const r = await createInvoice(ctx, { clientId: cl.id, branchId: cl.branchId, lines: [{ kind: "SERVICE", serviceId: svc.id, quantity: 1 }] }, { issue: true });
      if (Number(r.total) > 0) await addPayment(ctx, r.id, { amount: Number(r.total), method: "CARD", paidAt: ago(3 + inv) });
      inv++;
    }
  }
  return `${companies.length} companies, ${mem} beneficiaries, ${inv} corporate invoices`;
}

// ------------------------------------------------------------------ main --

export async function seedPhase5() {
  const tenants = await withPlatform((tx) => tx.tenant.findMany({ orderBy: { createdAt: "asc" } }));
  for (const [i, t] of tenants.entries()) {
    const posted = await backfillLedger(t.id);
    const admin = await withPlatform((tx) => tx.user.findFirst({ where: { tenantId: t.id, role: { key: "tenant_admin" } }, orderBy: { createdAt: "asc" } }));
    if (!admin) continue;
    const ctx = (await loadContext(admin.id, null)) as Ctx;
    const out = [`ledger +${posted} entries`];
    const done = await withPlatform(async (tx) => ({
      inv: (await tx.supplier.count({ where: { tenantId: t.id } })) > 0,
      acc: (await tx.voucher.count({ where: { tenantId: t.id } })) > 0,
      corp: (await tx.corporateAccount.count({ where: { tenantId: t.id } })) >= 3,
    }));
    if (ctx.features.has("inventory") && !done.inv) out.push(await seedInventory(ctx, t.slug, rng(500 + i)));
    if (!MATS[t.slug]) { console.log(`  ${t.slug}: ${out[0]}`); continue; } // empty demo tenants: ledger only
    if (ctx.features.has("accounting") && !done.acc) out.push(await seedAccounting(ctx, t.slug));
    if (ctx.features.has("corporate") && !done.corp) out.push(await seedCorporate(ctx));
    console.log(`  ${t.slug}: ${out.filter(Boolean).join(" · ")}`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-phase5.ts")) {
  seedPhase5().catch((e) => { console.error(e); process.exit(1); }).finally(disconnectAll);
}

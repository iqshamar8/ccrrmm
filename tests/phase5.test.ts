/** Phase 5: inventory (lots, FIFO, documents, consumption), double-entry ledger, vouchers/FX, corporate contracts, isolation, plan gating. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { disconnectAll, withPlatform, withTenant } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { createClient } from "@/server/services/clients";
import { createService } from "@/server/services/catalog";
import { createBranch } from "@/server/services/branches";
import { createAppointment, setAppointmentStatus } from "@/server/services/appointments";
import { cancelInvoice, createInvoice, saveProduct } from "@/server/services/billing";
import { createCoupon } from "@/server/services/coupons";
import {
  getDocument, issueStock, itemCard, listWarehouses, receiveStock, saveServiceMaterials, saveSupplier, stockAlerts, transferStock,
  savePO, setPOStatus, receivePO, startCount, getCount, updateCount, postCount,
} from "@/server/services/inventory";
import {
  addRate, balanceSheet, createManualJournal, createVoucher, listAccounts, listCashAccounts, trialBalance, voidVoucher, incomeStatement,
} from "@/server/services/accounting";
import { addMember, getCompany, listCompanies, saveAgreement, saveCompany } from "@/server/services/corporate";
import { makePlan, makeTenant, makeUserWithRole } from "./helpers";

let A: Awaited<ReturnType<typeof makeTenant>>, B: Awaited<ReturnType<typeof makeTenant>>;
let doctor: Ctx, member: string;
let whMain: string, whBranch2: string, supplier: string, mat: string, retail: string, svc: string, clientId: string;
const n = (v: unknown) => Number(v);
const days = (d: number) => new Date(Date.now() + d * 86400000);
let k = 0;
const past = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); d.setUTCHours(4 + (k++ % 14), 0, 0, 0); return d; };

/** Ledger lines of a source document, keyed by account code. */
async function lines(tenantId: string, sourceId: string) {
  return withTenant(tenantId, async (tx) => {
    const ls = await tx.journalLine.findMany({ where: { tenantId, entry: { sourceId } }, include: { account: true } });
    return ls.map((l) => ({ code: l.account.code, debit: n(l.debit), credit: n(l.credit), supplierId: l.supplierId, branchId: l.branchId }));
  });
}
const lotQty = (tenantId: string, itemId: string, warehouseId: string) =>
  withTenant(tenantId, async (tx) => n((await tx.stockLot.aggregate({ where: { tenantId, itemId, warehouseId }, _sum: { quantity: true } }))._sum.quantity ?? 0));

beforeAll(async () => {
  const plan = await makePlan({ maxUsers: 50 });
  A = await makeTenant(plan.id);
  B = await makeTenant(plan.id);
  const d = await makeUserWithRole(A.tenant.id, "doctor");
  await withPlatform((tx) => tx.user.update({ where: { id: d.user.id }, data: { allBranches: true } }));
  doctor = (await loadContext(d.user.id, null))!;
  await createBranch(A.ctx, { name: "Second branch", code: "BR2" });
  A.ctx = (await loadContext(A.admin.id, null))!;
  const whs = await listWarehouses(A.ctx);
  whMain = whs.find((w) => w.branch.name !== "Second branch")!.id;
  whBranch2 = whs.find((w) => w.branch.name === "Second branch")!.id;
  supplier = (await saveSupplier(A.ctx, null, { name: "Med Supplies Co" })).id;
  mat = (await saveProduct(A.ctx, null, { name: "Cooling gel", unit: "ml", price: 0, cost: 2, trackStock: true, isSellable: false, isConsumable: true, expiryTracking: true, minStock: 15 })).id;
  retail = (await saveProduct(A.ctx, null, { name: "Sunscreen", price: 20, cost: 8, trackStock: true })).id;
  svc = (await createService(A.ctx, { name: "Laser session", price: 100, durationMin: 30 })).id;
  clientId = (await createClient(A.ctx, { fullName: "Stock Client", phone: "0781 000 0501" })).id;
});
afterAll(disconnectAll);

describe("inventory: lots, FIFO and documents", () => {
  it("a receipt creates lots and posts Dr Inventory / Cr Accounts payable (supplier)", async () => {
    const doc = await receiveStock(A.ctx, { warehouseId: whMain, supplierId: supplier, lines: [
      { itemId: mat, quantity: 10, unitCost: 2, lotNo: "LATE", expiryDate: days(100) },
      { itemId: mat, quantity: 10, unitCost: 3, lotNo: "SOON", expiryDate: days(30) },
    ] });
    expect(doc.code).toMatch(/^GRN-/);
    expect(n(doc.totalCost)).toBe(50);
    const l = await lines(A.tenant.id, doc.id);
    expect(l.find((x) => x.code === "1104")?.debit).toBe(50);
    expect(l.find((x) => x.code === "2101")).toMatchObject({ credit: 50, supplierId: supplier });
    expect(await lotQty(A.tenant.id, mat, whMain)).toBe(20);
  });

  it("requires an expiry date for expiry-tracked items", async () => {
    await expect(receiveStock(A.ctx, { warehouseId: whMain, supplierId: supplier, lines: [{ itemId: mat, quantity: 1, unitCost: 2 }] })).rejects.toMatchObject({ status: 400 });
  });

  it("issues FIFO by earliest expiry and costs each lot at its own price", async () => {
    const doc = await issueStock(A.ctx, { type: "ISSUE", warehouseId: whMain, notes: "used in clinic", lines: [{ itemId: mat, quantity: 12 }] });
    expect(n(doc.totalCost)).toBe(10 * 3 + 2 * 2); // all of SOON (3) then 2 of LATE (2)
    const lots = await withTenant(A.tenant.id, (tx) => tx.stockLot.findMany({ where: { itemId: mat, warehouseId: whMain } }));
    expect(n(lots.find((x) => x.lotNo === "SOON")!.quantity)).toBe(0);
    expect(n(lots.find((x) => x.lotNo === "LATE")!.quantity)).toBe(8);
    const l = await lines(A.tenant.id, doc.id);
    expect(l.find((x) => x.code === "5101")?.debit).toBe(34);
  });

  it("refuses to issue more than is in stock and changes nothing", async () => {
    await expect(issueStock(A.ctx, { type: "WASTE", warehouseId: whMain, notes: "broken", lines: [{ itemId: mat, quantity: 9 }] })).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" });
    expect(await lotQty(A.tenant.id, mat, whMain)).toBe(8);
  });

  it("the database itself forbids negative lot quantities", async () => {
    await expect(withTenant(A.tenant.id, (tx) => tx.stockLot.updateMany({ where: { itemId: mat }, data: { quantity: -1 } }))).rejects.toThrow();
  });

  it("moves lots between branches (with expiry) and posts inventory across branches", async () => {
    const t = await transferStock(A.ctx, { fromWarehouseId: whMain, toWarehouseId: whBranch2, lines: [{ itemId: mat, quantity: 3 }] });
    expect(await lotQty(A.tenant.id, mat, whMain)).toBe(5);
    expect(await lotQty(A.tenant.id, mat, whBranch2)).toBe(3);
    const moved = await withTenant(A.tenant.id, (tx) => tx.stockLot.findFirst({ where: { itemId: mat, warehouseId: whBranch2 } }));
    expect(moved?.lotNo).toBe("LATE");
    const l = await lines(A.tenant.id, t.id);
    expect(l.filter((x) => x.code === "1104").map((x) => x.debit + x.credit)).toEqual([6, 6]);
    expect(new Set(l.map((x) => x.branchId)).size).toBe(2);
    const g = await getDocument(A.ctx, t.id);
    expect(g.code).toMatch(/^TRF-/);
  });

  it("shows low-stock alerts and the item's movement history", async () => {
    const al = await stockAlerts(A.ctx);
    expect(al.low.some((x: { id?: string; itemId?: string }) => (x.id ?? x.itemId) === mat)).toBe(true); // 8 < min 15
    const card = await itemCard(A.ctx, mat);
    expect(JSON.stringify(card)).toContain("GRN-");
  });

  it("purchase order → partial receipt → received", async () => {
    const po = await savePO(A.ctx, null, { supplierId: supplier, warehouseId: whMain, lines: [{ itemId: retail, quantity: 10, unitCost: 8 }] });
    await expect(receivePO(A.ctx, po.id, { lines: [{ lineId: po.id, quantity: 1 }] })).rejects.toMatchObject({ status: 409 }); // not sent yet
    await setPOStatus(A.ctx, po.id, { action: "ORDER" });
    const pl = await withTenant(A.tenant.id, (tx) => tx.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } }));
    await receivePO(A.ctx, po.id, { lines: [{ lineId: pl.id, quantity: 4 }] });
    expect((await withTenant(A.tenant.id, (tx) => tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } }))).status).toBe("PARTIAL");
    await expect(receivePO(A.ctx, po.id, { lines: [{ lineId: pl.id, quantity: 7 }] })).rejects.toMatchObject({ status: 400 });
    await receivePO(A.ctx, po.id, { lines: [{ lineId: pl.id, quantity: 6 }] });
    expect((await withTenant(A.tenant.id, (tx) => tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } }))).status).toBe("RECEIVED");
    expect(await lotQty(A.tenant.id, retail, whMain)).toBe(10);
  });

  it("stock count posts the differences as an adjustment", async () => {
    const c = await startCount(A.ctx, { warehouseId: whMain });
    await expect(startCount(A.ctx, { warehouseId: whMain })).rejects.toMatchObject({ status: 409 });
    const g = await getCount(A.ctx, c.id);
    const line = g.lines.find((l) => l.itemId === retail)!;
    expect(n(line.expectedQty)).toBe(10);
    await updateCount(A.ctx, c.id, [{ lineId: line.id, countedQty: 9 }]);
    await postCount(A.ctx, c.id);
    expect(await lotQty(A.tenant.id, retail, whMain)).toBe(9);
  });
});

describe("automatic stock hooks", () => {
  it("completing a visit consumes the service's materials", async () => {
    await saveServiceMaterials(A.ctx, svc, [{ itemId: mat, quantity: 2 }]);
    const before = await lotQty(A.tenant.id, mat, whMain);
    const ap = (await createAppointment(A.ctx, { clientId, serviceId: svc, staffId: doctor.user.id, startsAt: past() })) as { id: string };
    await setAppointmentStatus(A.ctx, ap.id, { status: "COMPLETED" });
    expect(await lotQty(A.tenant.id, mat, whMain)).toBe(before - 2);
    const doc = await withTenant(A.tenant.id, (tx) => tx.stockDocument.findFirstOrThrow({ where: { appointmentId: ap.id, type: "CONSUMPTION" } }));
    expect((await lines(A.tenant.id, doc.id)).find((x) => x.code === "5101")?.debit).toBe(4); // 2 × 2 (LATE lot)
  });

  it("selling a product deducts stock; cancelling returns it and reverses the sale", async () => {
    const before = await lotQty(A.tenant.id, retail, whMain);
    const inv = await createInvoice(A.ctx, { clientId, lines: [{ kind: "PRODUCT", productId: retail, quantity: 2 }] }, { issue: true });
    expect(await lotQty(A.tenant.id, retail, whMain)).toBe(before - 2);
    const ar1 = await lines(A.tenant.id, inv.id);
    expect(ar1.find((x) => x.code === "1103")?.debit).toBe(40);
    expect(ar1.find((x) => x.code === "4102")?.credit).toBe(40);
    await cancelInvoice(A.ctx, inv.id, { reason: "client changed mind" });
    expect(await lotQty(A.tenant.id, retail, whMain)).toBe(before);
    const all = await lines(A.tenant.id, inv.id);
    const net = (code: string) => all.filter((x) => x.code === code).reduce((s, x) => s + x.debit - x.credit, 0);
    expect([net("1103"), net("4102")]).toEqual([0, 0]);
  });
});

describe("double-entry ledger", () => {
  it("rejects an unbalanced manual entry", async () => {
    const accs = await listAccounts(A.ctx);
    const leaf = accs.filter((a: { isGroup: boolean }) => !a.isGroup);
    await expect(createManualJournal(A.ctx, { date: new Date(), description: "bad", lines: [{ accountId: leaf[0].id, debit: 10 }, { accountId: leaf[1].id, credit: 9 }] })).rejects.toMatchObject({ status: 400 });
  });

  it("the database rejects unbalanced entries at commit, and journals are append-only", async () => {
    const acc = await withTenant(A.tenant.id, (tx) => tx.account.findFirstOrThrow({ where: { tenantId: A.tenant.id, code: "1103" } }));
    await expect(withTenant(A.tenant.id, async (tx) => {
      const e = await tx.journalEntry.create({ data: { tenantId: A.tenant.id, code: "JV-BAD", date: new Date(), description: "x", source: "MANUAL" } });
      await tx.journalLine.create({ data: { tenantId: A.tenant.id, entryId: e.id, accountId: acc.id, debit: new Prisma.Decimal(5), credit: new Prisma.Decimal(0) } });
    })).rejects.toThrow();
    await expect(withTenant(A.tenant.id, (tx) => tx.journalLine.updateMany({ where: { tenantId: A.tenant.id }, data: { description: "tamper" } }))).rejects.toThrow();
    await expect(withTenant(A.tenant.id, (tx) => tx.journalEntry.deleteMany({ where: { tenantId: A.tenant.id } }))).rejects.toThrow();
  });

  it("trial balance balances and the balance sheet ties to earnings", async () => {
    const tb = await trialBalance(A.ctx, {});
    expect(n(tb.totals.debit)).toBe(n(tb.totals.credit));
    expect(n(tb.totals.debit)).toBeGreaterThan(0);
    const bs = await balanceSheet(A.ctx, {});
    expect(bs.balanced).toBe(true);
    const is = await incomeStatement(A.ctx, {});
    expect(n(bs.earnings)).toBeCloseTo(n(is.net), 2);
  });

  it("foreign-currency payment voucher converts at the dated rate; voiding reverses it", async () => {
    const base = A.tenant.baseCurrency;
    const fx = base === "EUR" ? "USD" : "EUR";
    await addRate(A.ctx, { currency: fx, rate: 1.5, date: days(-10) });
    await addRate(A.ctx, { currency: fx, rate: 9, date: days(5) }); // future rate must not be used
    const cash = (await listCashAccounts(A.ctx))[0] ?? null;
    const box = cash?.id ?? (await withTenant(A.tenant.id, (tx) => tx.cashAccount.findFirstOrThrow({ where: { tenantId: A.tenant.id } }))).id;
    const rent = await withTenant(A.tenant.id, (tx) => tx.account.findFirstOrThrow({ where: { tenantId: A.tenant.id, code: "5104" } }));
    const v = await createVoucher(A.ctx, { type: "PAYMENT", cashAccountId: box, counterAccountId: rent.id, amount: 100, currency: fx, description: "Rent abroad" });
    expect(v.code).toMatch(/^PV-/);
    expect([n(v.amount), n(v.fcAmount), n(v.rate)]).toEqual([150, 100, 1.5]);
    await voidVoucher(A.ctx, v.id, { reason: "duplicate" });
    const bal = await withTenant(A.tenant.id, async (tx) => {
      const s = await tx.journalLine.aggregate({ where: { tenantId: A.tenant.id, accountId: rent.id }, _sum: { debit: true, credit: true } });
      return n(s._sum.debit) - n(s._sum.credit);
    });
    expect(bal).toBe(0);
    await expect(voidVoucher(A.ctx, v.id, { reason: "again" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("corporate contracts", () => {
  let co: string, other: string;
  it("applies the agreement discount to members and blocks coupons unless allowed", async () => {
    co = (await saveCompany(A.ctx, null, { name: "Acme Corp" })).id;
    await saveAgreement(A.ctx, co, null, { name: "2026", startDate: days(-30), endDate: days(300), discountPercent: 20 });
    await expect(saveAgreement(A.ctx, co, null, { name: "overlap", startDate: days(0), endDate: days(10), discountPercent: 5 })).rejects.toMatchObject({ status: 409 });
    member = (await createClient(A.ctx, { fullName: "Acme Employee", phone: "0781 000 0502" })).id;
    other = (await createClient(A.ctx, { fullName: "Walk In Person", phone: "0781 000 0503" })).id;
    await addMember(A.ctx, co, { clientId: member });
    const inv = await createInvoice(A.ctx, { clientId: member, lines: [{ kind: "SERVICE", serviceId: svc, quantity: 1 }] });
    expect([n(inv.corporateDiscount), n(inv.total)]).toEqual([20, 80]);
    const plain = await createInvoice(A.ctx, { clientId: other, lines: [{ kind: "SERVICE", serviceId: svc, quantity: 1 }] });
    expect(n(plain.corporateDiscount)).toBe(0);
    await createCoupon(A.ctx, { code: "CORP10", name: "Ten off", type: "PERCENT", value: 10 });
    await expect(createInvoice(A.ctx, { clientId: member, couponCode: "CORP10", lines: [{ kind: "SERVICE", serviceId: svc, quantity: 1 }] })).rejects.toMatchObject({ status: 409 });
  });

  it("a client belongs to one company only; usage is reported", async () => {
    const co2 = (await saveCompany(A.ctx, null, { name: "Other Corp" })).id;
    await expect(addMember(A.ctx, co2, { clientId: member })).rejects.toMatchObject({ status: 409 });
    const inv = await createInvoice(A.ctx, { clientId: member, lines: [{ kind: "SERVICE", serviceId: svc, quantity: 1 }] }, { issue: true });
    expect(inv.corporateAgreementId).toBeTruthy();
    const g = await getCompany(A.ctx, co);
    expect(JSON.stringify(g)).toContain(inv.code!);
    const list = await listCompanies(A.ctx);
    expect(list.find((c: { id: string }) => c.id === co)).toBeTruthy();
  });
});

describe("isolation & plan gating", () => {
  it("another tenant can't see or use this tenant's stock, accounts or companies", async () => {
    expect((await listWarehouses(B.ctx)).some((w) => w.id === whMain)).toBe(false);
    await expect(receiveStock(B.ctx, { warehouseId: whMain, cashAccountId: null, supplierId: supplier, lines: [{ itemId: mat, quantity: 1, unitCost: 1, expiryDate: days(9) }] })).rejects.toMatchObject({ status: expect.any(Number) });
    await expect(itemCard(B.ctx, mat)).rejects.toMatchObject({ status: 404 });
    expect((await listCompanies(B.ctx)).length).toBe(0);
    await expect(addMember(B.ctx, (await saveCompany(B.ctx, null, { name: "B Corp" })).id, { clientId: member })).rejects.toMatchObject({ status: 400 });
    // RLS: raw reads from B's context see none of A's ledger
    const seen = await withTenant(B.tenant.id, (tx) => tx.journalLine.count({ where: { tenantId: A.tenant.id } }));
    expect(seen).toBe(0);
  });

  it("modules outside the plan are refused, but the ledger still records sales", async () => {
    const basic = await makePlan({ features: ["clients", "appointments", "services", "invoices", "pos"] });
    const C = await makeTenant(basic.id);
    await expect(listWarehouses(C.ctx)).rejects.toMatchObject({ status: 403 });
    await expect(trialBalance(C.ctx, {})).rejects.toMatchObject({ status: 403 });
    await expect(listCompanies(C.ctx)).rejects.toMatchObject({ status: 403 });
    const s = (await createService(C.ctx, { name: "Consult", price: 50, durationMin: 15 })).id;
    const c = (await createClient(C.ctx, { fullName: "Basic Client", phone: "0781 000 0504" })).id;
    const inv = await createInvoice(C.ctx, { clientId: c, lines: [{ kind: "SERVICE", serviceId: s, quantity: 1 }] }, { issue: true });
    expect((await lines(C.tenant.id, inv.id)).find((x) => x.code === "1103")?.debit).toBe(50);
  });
});

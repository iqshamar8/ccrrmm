/** Phase 4: invoices, payments, refunds, coupons, loyalty, POS, commissions, HR/payroll. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withPlatform, withTenant } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { createClient } from "@/server/services/clients";
import { createService } from "@/server/services/catalog";
import { createAppointment, setAppointmentStatus } from "@/server/services/appointments";
import { assignProgram } from "@/server/services/programs";
import { addPayment, billSource, cancelInvoice, createInvoice, getInvoice, issueInvoice, posCheckout, refundInvoice, saveProduct } from "@/server/services/billing";
import { createCoupon } from "@/server/services/coupons";
import { clientLoyalty, adjustPoints } from "@/server/services/loyalty";
import { listCommissions, setCommissionStatus } from "@/server/services/commissions";
import { updateSettings } from "@/server/services/settings";
import { clock, createAdvance, decideLeave, generatePayroll, getPayrollRun, requestLeave, saveProfile, setAttendance, setPayrollStatus } from "@/server/services/hr";
import { makePlan, makeTenant, makeUserWithRole } from "./helpers";

let A: Awaited<ReturnType<typeof makeTenant>>, B: Awaited<ReturnType<typeof makeTenant>>;
let doctor: Ctx, seller: Ctx, rec: Ctx;
let svc: string, svc2: string, clientId: string, product: string;
let k = 0;
const past = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); d.setUTCHours(4 + (k++ % 14), 0, 0, 0); return d; };
const n = (v: unknown) => Number(v);
const svcLine = (serviceId: string, extra: Record<string, unknown> = {}) => ({ kind: "SERVICE", serviceId, quantity: 1, ...extra });

async function staff(role: string) {
  const u = await makeUserWithRole(A.tenant.id, role);
  await withPlatform((tx) => tx.user.update({ where: { id: u.user.id }, data: { allBranches: true } }));
  return (await loadContext(u.user.id, null))!;
}

beforeAll(async () => {
  const plan = await makePlan({ maxUsers: 50 });
  A = await makeTenant(plan.id);
  B = await makeTenant(plan.id);
  doctor = await staff("doctor");
  seller = await staff("sales");
  rec = await staff("receptionist");
  svc = (await createService(A.ctx, { name: "Laser", price: 100, durationMin: 30, execCommission: { type: "PERCENT", value: 10 }, marketingCommission: { type: "FIXED", value: 5 } })).id;
  svc2 = (await createService(A.ctx, { name: "Facial", price: 50, durationMin: 30 })).id;
  product = (await saveProduct(A.ctx, null, { name: "Sunscreen", price: 20, cost: 8 })).id;
  clientId = (await createClient(A.ctx, { fullName: "Billing Client", phone: "0781 000 0001" })).id;
  await updateSettings(A.ctx, { defaultTaxRate: 0, loyaltyEnabled: true, pointsPerUnit: 1, pointValue: 0.5, minRedeemPoints: 10, productCommissionPercent: 2 });
});
afterAll(disconnectAll);

describe("invoice math & lifecycle", () => {
  it("computes discounts and tax exactly", async () => {
    // lines: 2×100 − 20 = 180, 1×50 = 50 → subtotal 230; manual −30 → 200; tax 10% on discounted base = 20 → total 220
    const inv = await createInvoice(A.ctx, { clientId, discountAmount: 30, lines: [svcLine(svc, { quantity: 2, discount: 20, taxRate: 10 }), svcLine(svc2, { taxRate: 10 })] });
    expect(inv.status).toBe("DRAFT");
    expect(inv.code).toBeNull();
    expect([n(inv.subtotal), n(inv.discountAmount), n(inv.taxTotal), n(inv.total)]).toEqual([230, 30, 20, 220]);
  });

  it("numbers invoices sequentially at issue, then payments drive the status", async () => {
    const a = await createInvoice(A.ctx, { clientId, lines: [svcLine(svc)] }, { issue: true });
    const b = await createInvoice(A.ctx, { clientId, lines: [svcLine(svc)] }, { issue: true });
    expect(Number(b.code!.slice(4)) - Number(a.code!.slice(4))).toBe(1);
    await expect(addPayment(A.ctx, a.id, { amount: 150, method: "CASH" })).rejects.toMatchObject({ status: 400 }); // > balance
    await addPayment(A.ctx, a.id, { amount: 40, method: "CASH" });
    expect((await getInvoice(A.ctx, a.id)).status).toBe("PARTIALLY_PAID");
    await addPayment(A.ctx, a.id, { amount: 60, method: "CARD" });
    const g = await getInvoice(A.ctx, a.id);
    expect(g.status).toBe("PAID");
    expect(g.payments.map((p) => p.receiptNo.startsWith("RCPT-"))).toEqual([true, true]);
  });

  it("paid invoice earns loyalty and generates exec + marketing commissions", async () => {
    const inv = await createInvoice(A.ctx, { clientId, salesStaffId: seller.user.id, lines: [svcLine(svc, { performedById: doctor.user.id })] }, { issue: true });
    const before = (await clientLoyalty(A.ctx, clientId)).balance;
    await addPayment(A.ctx, inv.id, { amount: 100, method: "CASH" });
    expect((await clientLoyalty(A.ctx, clientId)).balance - before).toBe(100); // 1 point per unit
    const c = await listCommissions(A.ctx, {});
    const mine = c.items.filter((x) => x.invoiceId === inv.id);
    expect(mine.find((x) => x.source === "SERVICE_EXEC")?.userId).toBe(doctor.user.id);
    expect(n(mine.find((x) => x.source === "SERVICE_EXEC")?.amount)).toBe(10);
    expect(n(mine.find((x) => x.source === "SERVICE_MARKETING")?.amount)).toBe(5);

    // partial refund (50%) → proportional reversal
    await refundInvoice(A.ctx, inv.id, { amount: 50, method: "CASH", reason: "half treatment" });
    const after = (await listCommissions(A.ctx, {})).items.filter((x) => x.invoiceId === inv.id);
    expect(after.filter((x) => x.source === "SERVICE_EXEC").reduce((s, x) => s + n(x.amount), 0)).toBe(5);
    expect((await clientLoyalty(A.ctx, clientId)).balance - before).toBe(50);
    await refundInvoice(A.ctx, inv.id, { amount: 50, method: "CASH", reason: "rest" });
    expect((await getInvoice(A.ctx, inv.id)).status).toBe("REFUNDED");
    await expect(refundInvoice(A.ctx, inv.id, { amount: 1, method: "CASH", reason: "too much" })).rejects.toMatchObject({ status: 400 });
  });

  it("installments must add up to the total", async () => {
    const d = await createInvoice(A.ctx, { clientId, lines: [svcLine(svc)] });
    await expect(issueInvoice(A.ctx, d.id, { installments: [{ dueDate: new Date(), amount: 60 }] })).rejects.toMatchObject({ status: 400 });
    await issueInvoice(A.ctx, d.id, { installments: [{ dueDate: new Date(Date.now() + 864e5), amount: 60 }, { dueDate: new Date(Date.now() + 30 * 864e5), amount: 40 }] });
    await addPayment(A.ctx, d.id, { amount: 70, method: "CASH" });
    const g = await getInvoice(A.ctx, d.id);
    expect(g.installments.map((i) => i.status)).toEqual(["PAID", "PARTIAL"]);
  });
});

describe("no double billing", () => {
  it("an appointment can be billed once; cancelling frees it; prepaid visits can't be billed", async () => {
    const ap = await createAppointment(A.ctx, { clientId, serviceId: svc, staffId: doctor.user.id, startsAt: past() });
    if (!("id" in ap)) throw new Error();
    await setAppointmentStatus(A.ctx, ap.id, { status: "COMPLETED" });
    const inv = await billSource(A.ctx, { source: "appointment", id: ap.id });
    const g = await getInvoice(A.ctx, inv.id);
    expect(g.lines[0].performedById).toBe(doctor.user.id); // performer copied from appointment
    await expect(billSource(A.ctx, { source: "appointment", id: ap.id })).rejects.toMatchObject({ code: "ALREADY_BILLED" });
    // DB backstop
    await expect(withTenant(A.tenant.id, (tx) => tx.invoiceLine.create({ data: { tenantId: A.tenant.id, invoiceId: inv.id, kind: "SERVICE", description: "x", unitPrice: 1, lineTotal: 1, appointmentId: ap.id } }))).rejects.toThrow(/Unique constraint/);
    const issued = await issueInvoice(A.ctx, inv.id, {});
    await cancelInvoice(A.ctx, issued.id, { reason: "wrong client" });
    await billSource(A.ctx, { source: "appointment", id: ap.id }); // allowed again

    const p = await assignProgram(A.ctx, { clientId, name: "Pkg", price: 300, items: [{ serviceId: svc, sessions: 2 }] });
    const pre = await createAppointment(A.ctx, { clientId, programItemId: p.items[0].id, staffId: doctor.user.id, startsAt: past() });
    if (!("id" in pre)) throw new Error();
    await setAppointmentStatus(A.ctx, pre.id, { status: "COMPLETED" });
    await expect(billSource(A.ctx, { source: "appointment", id: pre.id })).rejects.toMatchObject({ status: 409 });
    const progInv = await billSource(A.ctx, { source: "program", id: p.id });
    expect(n(progInv.total)).toBe(300);
  });

  it("can't cancel an invoice with payments", async () => {
    const inv = await createInvoice(A.ctx, { clientId, lines: [svcLine(svc2)] }, { issue: true });
    await addPayment(A.ctx, inv.id, { amount: 10, method: "CASH" });
    await expect(cancelInvoice(A.ctx, inv.id, { reason: "x y" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("coupons", () => {
  it("applies to covered services only, honours limits and is released on cancel", async () => {
    await createCoupon(A.ctx, { code: "LASER20", name: "Laser 20%", type: "PERCENT", value: 20, maxDiscount: 15, allServices: false, serviceIds: [svc], usageLimit: 1 });
    await expect(createInvoice(A.ctx, { clientId, couponCode: "laser20", lines: [svcLine(svc2)] })).rejects.toMatchObject({ code: "COUPON_INVALID" });
    const inv = await createInvoice(A.ctx, { clientId, couponCode: "laser20", lines: [svcLine(svc), svcLine(svc2)] }, { issue: true });
    expect(n(inv.couponDiscount)).toBe(15); // 20% of 100 = 20, capped at 15
    expect(n(inv.total)).toBe(135);
    await expect(createInvoice(A.ctx, { clientId, couponCode: "LASER20", lines: [svcLine(svc)] }, { issue: true })).rejects.toMatchObject({ code: "COUPON_INVALID" }); // limit 1
    await cancelInvoice(A.ctx, inv.id, { reason: "redo" });
    await createInvoice(A.ctx, { clientId, couponCode: "LASER20", lines: [svcLine(svc)] }, { issue: true }); // usage released
  });

  it("targeted coupons only work for listed clients", async () => {
    const other = await createClient(A.ctx, { fullName: "Other", phone: "0781 000 0002" });
    await createCoupon(A.ctx, { code: "VIPONLY", name: "VIP", type: "FIXED", value: 10, clientIds: [clientId] });
    await expect(createInvoice(A.ctx, { clientId: other.id, couponCode: "VIPONLY", lines: [svcLine(svc)] })).rejects.toMatchObject({ code: "COUPON_INVALID" });
  });
});

describe("loyalty", () => {
  it("redeem needs enough points; cancel gives them back", async () => {
    const c = await createClient(A.ctx, { fullName: "Points", phone: "0781 000 0003" });
    await expect(createInvoice(A.ctx, { clientId: c.id, redeemPoints: 20, lines: [svcLine(svc)] })).rejects.toMatchObject({ status: 409 });
    await adjustPoints(A.ctx, c.id, { points: 40, note: "welcome gift" });
    await expect(createInvoice(A.ctx, { clientId: c.id, redeemPoints: 5, lines: [svcLine(svc)] })).rejects.toMatchObject({ status: 409 }); // < min 10
    const inv = await createInvoice(A.ctx, { clientId: c.id, redeemPoints: 40, lines: [svcLine(svc)] }, { issue: true });
    expect(n(inv.loyaltyDiscount)).toBe(20); // 40 × 0.5
    expect((await clientLoyalty(A.ctx, c.id)).balance).toBe(0);
    await cancelInvoice(A.ctx, inv.id, { reason: "changed mind" });
    expect((await clientLoyalty(A.ctx, c.id)).balance).toBe(40);
  });
});

describe("POS", () => {
  it("sells products + services with split payment; walk-ins must pay in full", async () => {
    await expect(posCheckout(A.ctx, { lines: [{ kind: "PRODUCT", productId: product, quantity: 2 }], payments: [{ method: "CASH", amount: 10 }] })).rejects.toMatchObject({ status: 400 });
    const s = await posCheckout(A.ctx, {
      clientId, salesStaffId: seller.user.id,
      lines: [{ kind: "PRODUCT", productId: product, quantity: 2 }, svcLine(svc2)],
      payments: [{ method: "CASH", amount: 50 }, { method: "CARD", amount: 40 }],
    });
    expect(s.status).toBe("PAID");
    expect(s.type).toBe("MIXED");
    expect(s.payments.length).toBe(2);
    const sales = (await listCommissions(A.ctx, {})).items.filter((x) => x.invoiceId === s.id && x.source === "PRODUCT_SALE");
    expect(n(sales[0]?.amount)).toBe(0.8); // 2% of 40
  });
});

describe("permissions & isolation", () => {
  it("receptionist can bill and collect but not refund or cancel", async () => {
    const inv = await createInvoice(rec, { clientId, lines: [svcLine(svc2)] }, { issue: true });
    await addPayment(rec, inv.id, { amount: 50, method: "CASH" });
    await expect(refundInvoice(rec, inv.id, { amount: 10, method: "CASH", reason: "x y" })).rejects.toMatchObject({ status: 403 });
    await expect(cancelInvoice(rec, inv.id, { reason: "x y" })).rejects.toMatchObject({ status: 403 });
  });

  it("another tenant can't see, pay or use coupons of this tenant", async () => {
    const inv = await createInvoice(A.ctx, { clientId, lines: [svcLine(svc)] }, { issue: true });
    await expect(getInvoice(B.ctx, inv.id)).rejects.toMatchObject({ status: 404 });
    await expect(addPayment(B.ctx, inv.id, { amount: 1, method: "CASH" })).rejects.toMatchObject({ status: 404 });
    const bClient = await createClient(B.ctx, { fullName: "B client", phone: "0791 000 0001" });
    const bSvc = await createService(B.ctx, { name: "B service", price: 10, durationMin: 30 });
    await expect(createInvoice(B.ctx, { clientId: bClient.id, couponCode: "VIPONLY", lines: [svcLine(bSvc.id)] })).rejects.toMatchObject({ code: "COUPON_INVALID" });
    await expect(createInvoice(B.ctx, { clientId: bClient.id, lines: [svcLine(svc)] })).rejects.toMatchObject({ status: 400 }); // A's service
    await expect(withTenant(B.tenant.id, (tx) => tx.payment.create({ data: { tenantId: B.tenant.id, invoiceId: inv.id, receiptNo: "X", amount: 1, method: "CASH" } }))).rejects.toThrow();
  });
});

describe("plan gating", () => {
  it("a plan without coupons/loyalty/commissions can bill but not use those features", async () => {
    const T = await makeTenant((await makePlan({ features: ["clients", "appointments", "services", "invoices", "pos"] })).id);
    const s = await createService(T.ctx, { name: "Basic", price: 10, durationMin: 30, execCommission: { type: "PERCENT", value: 50 } });
    const c = await createClient(T.ctx, { fullName: "Gated", phone: "0782 000 0001" });
    await expect(createInvoice(T.ctx, { clientId: c.id, couponCode: "ANY", lines: [svcLine(s.id)] })).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    await expect(createInvoice(T.ctx, { clientId: c.id, redeemPoints: 10, lines: [svcLine(s.id)] })).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    const inv = await createInvoice(T.ctx, { clientId: c.id, lines: [svcLine(s.id, { performedById: T.admin.id })] }, { issue: true });
    await addPayment(T.ctx, inv.id, { amount: 10, method: "CASH" });
    expect(await withPlatform((tx) => tx.commissionEntry.count({ where: { invoiceId: inv.id } }))).toBe(0);
  });
});

describe("HR & payroll", () => {
  it("payroll = base + allowance + approved commissions − advances − absences; approval locks them", async () => {
    const u = await staff("nurse");
    await saveProfile(A.ctx, u.user.id, { baseSalary: 3000, fixedAllowance: 150 });
    await withPlatform((tx) => tx.commissionEntry.create({ data: { tenantId: A.tenant.id, userId: u.user.id, source: "ADJUSTMENT", baseAmount: 0, rateType: "FIXED", rateValue: 100, amount: 100, earnedAt: new Date(), status: "PENDING" } }));
    const pending = (await listCommissions(A.ctx, { userId: u.user.id })).items.map((x) => x.id);
    await setCommissionStatus(A.ctx, { ids: pending, action: "APPROVE" });
    await createAdvance(A.ctx, { userId: u.user.id, amount: 200 });
    const period = new Date().toISOString().slice(0, 7);
    await setAttendance(A.ctx, { userId: u.user.id, date: `${period}-01`, status: "ABSENT" });
    const run = await generatePayroll(A.ctx, { period });
    const item = (await getPayrollRun(A.ctx, run.id)).items.find((i) => i.userId === u.user.id)!;
    expect([n(item.commissions), n(item.advances), n(item.absenceDays), n(item.absenceDeduction), n(item.net)]).toEqual([100, 200, 1, 100, 2950]);
    await setPayrollStatus(A.ctx, run.id, { action: "APPROVE" });
    const c = (await listCommissions(A.ctx, { userId: u.user.id })).items[0];
    expect(c.status).toBe("PAID");
    await expect(generatePayroll(A.ctx, { period })).rejects.toMatchObject({ status: 409 });
  });

  it("leave: no overlaps, no self-approval; clock-in once per day", async () => {
    const l = await requestLeave(seller, { type: "ANNUAL", startDate: "2031-01-10", endDate: "2031-01-12" });
    expect(l.days).toBe(3);
    await expect(requestLeave(seller, { type: "SICK", startDate: "2031-01-11", endDate: "2031-01-11" })).rejects.toMatchObject({ status: 409 });
    await expect(decideLeave(seller, l.id, { action: "APPROVE" })).rejects.toMatchObject({ status: 403 });
    await decideLeave(A.ctx, l.id, { action: "APPROVE" });
    await clock(rec, { action: "IN" });
    await expect(clock(rec, { action: "IN" })).rejects.toMatchObject({ status: 409 });
    await clock(rec, { action: "OUT" });
  });
});

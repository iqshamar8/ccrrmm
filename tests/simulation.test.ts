/**
 * Three months of clinic life, played by the three people who use it most:
 *   owner (tenant admin), two doctors, a receptionist.
 * Every action goes through the real service layer with that person's own
 * permissions. Unexpected failures are collected (not thrown) so one run
 * reports every problem; consistency checks run at the end.
 *
 *   npm run test:sim        (skipped by the normal `npm test`)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withPlatform, withTenant } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { ZodError } from "zod";
import { createClient, listClients } from "@/server/services/clients";
import { addMedicalEntry, getMedical, saveMedicalRecord } from "@/server/services/medical";
import { createRoom, createService } from "@/server/services/catalog";
import { createAppointment, listAppointments, setAppointmentStatus } from "@/server/services/appointments";
import { assignProgram, createTemplate } from "@/server/services/programs";
import { createPlan, sellSubscription } from "@/server/services/subscriptions";
import { createSurgery, setSurgeryStatus } from "@/server/services/surgeries";
import { completeReview, createReview } from "@/server/services/reviews";
import { addPayment, billSource, issueInvoice, posCheckout, refundInvoice, saveProduct, getInvoice } from "@/server/services/billing";
import { createCoupon } from "@/server/services/coupons";
import { updateSettings } from "@/server/services/settings";
import { generatePayroll, saveProfile, setPayrollStatus } from "@/server/services/hr";
import { listWarehouses, receiveStock, saveServiceMaterials, saveSupplier } from "@/server/services/inventory";
import { balanceSheet, incomeStatement, trialBalance } from "@/server/services/accounting";
import { getDashboard } from "@/server/services/dashboard";
import { runReport } from "@/server/services/reports";
import { makePlan, makeTenant, makeUserWithRole } from "./helpers";

const RUN = !!process.env.SIM || process.env.npm_lifecycle_event === "test:sim";
const DAYS = 90;
const DAY = 86_400_000;

type Problem = { who: string; what: string; error: string };
const problems: Problem[] = [];
const counts: Record<string, number> = {};
const bump = (k: string, by = 1) => { counts[k] = (counts[k] ?? 0) + by; };

/** Run one action; record anything that isn't an expected business refusal. */
async function act<T>(who: string, what: string, fn: () => Promise<T>, expected: number[] = []): Promise<T | null> {
  try {
    const r = await fn();
    bump(what);
    return r;
  } catch (e) {
    const status = e instanceof AppError ? e.status : e instanceof ZodError ? 422 : (e as { status?: number })?.status;
    if (status && expected.includes(status)) { bump(`${what} (refused ${status})`); return null; }
    problems.push({ who, what, error: `${status ?? "crash"}: ${e instanceof Error ? e.message.split("\n")[0].slice(0, 220) : String(e)}` });
    return null;
  }
}

// Deterministic pseudo-random so a failing run can be replayed exactly.
let seed = 20261123;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

let owner: Ctx, doc1: Ctx, doc2: Ctx, rec: Ctx, tenantId: string, branchId: string;
const svc: Record<string, string> = {};
let room1: string, room2: string, product: string, material: string, tplId: string, subPlanId: string;

const dayAt = (dayOffset: number, hour: number, min = 0) => {
  const d = new Date(Date.now() + dayOffset * DAY);
  d.setUTCHours(hour, min, 0, 0);
  return d;
};

async function staff(role: string, name: string) {
  const u = await makeUserWithRole(tenantId, role);
  await withPlatform((tx) => tx.user.update({ where: { id: u.user.id }, data: { allBranches: true, fullName: name } }));
  return (await loadContext(u.user.id, null))!;
}

describe.skipIf(!RUN)("three months of clinic work", () => {
  beforeAll(async () => {
    const plan = await makePlan({ maxUsers: 50, maxBranches: 5 });
    const t = await makeTenant(plan.id);
    owner = t.ctx; tenantId = t.tenant.id;
    branchId = (await withPlatform((tx) => tx.branch.findFirstOrThrow({ where: { tenantId } }))).id;
    doc1 = await staff("doctor", "د. سارة");
    doc2 = await staff("doctor", "د. علي");
    rec = await staff("receptionist", "نور الاستقبال");

    // ---- owner sets the clinic up ----
    await act("owner", "settings", () => updateSettings(owner, { defaultTaxRate: 0, loyaltyEnabled: true, pointsPerUnit: 1, pointValue: 0.5, minRedeemPoints: 10 }));
    room1 = (await createRoom(owner, { branchId, name: "غرفة الليزر" })).id;
    room2 = (await createRoom(owner, { branchId, name: "غرفة الحقن" })).id;
    for (const [k, name, price, dur, kind] of [
      ["laser", "ليزر إزالة شعر", 90, 30, "LASER"], ["facial", "تنظيف بشرة", 50, 45, "OTHER"], ["filler", "فيلر", 260, 30, "OTHER"],
      ["botox", "بوتوكس", 200, 30, "OTHER"], ["consult", "استشارة", 25, 15, "OTHER"], ["prp", "بلازما", 120, 45, "OTHER"],
    ] as const) {
      svc[k] = (await createService(owner, { name, price, durationMin: dur, kind, execCommission: { type: "PERCENT", value: 10 } })).id;
    }
    product = (await saveProduct(owner, null, { name: "واقي شمس", price: 20, cost: 8, trackStock: true })).id;
    material = (await saveProduct(owner, null, { name: "جل تبريد", unit: "ml", price: 0, cost: 2, trackStock: true, isSellable: false, isConsumable: true, minStock: 20 })).id;
    const wh = (await listWarehouses(owner))[0].id;
    const supplier = (await saveSupplier(owner, null, { name: "مورد المستلزمات" })).id;
    await act("owner", "receive stock", () => receiveStock(owner, { warehouseId: wh, supplierId: supplier, lines: [
      { itemId: material, quantity: 2000, unitCost: 2 }, { itemId: product, quantity: 200, unitCost: 8 },
    ] }));
    await act("owner", "service materials", () => saveServiceMaterials(owner, svc.laser, [{ itemId: material, quantity: 2 }]));
    tplId = (await createTemplate(owner, { name: "ليزر 6 جلسات", price: 450, validityDays: 180, items: [{ serviceId: svc.laser, sessions: 6 }] })).id;
    subPlanId = (await createPlan(owner, { name: "اشتراك شهري", kind: "TIME", price: 99, durationDays: 30 })).id;
    await act("owner", "coupon", () => createCoupon(owner, { code: "WELCOME10", name: "خصم الترحيب", type: "PERCENT", value: 10 }));
    for (const [c, salary] of [[doc1, 3000], [doc2, 2800], [rec, 900]] as const) {
      await act("owner", "hr profile", () => saveProfile(owner, c.user.id, { baseSalary: salary }));
    }
  }, 120_000);

  afterAll(disconnectAll);

  it("runs 90 days without unexpected errors and keeps the books consistent", async () => {
    const clients: string[] = [];
    const doctors = [doc1, doc2];
    const firstVisit = new Set<string>();
    const programs: string[] = [];
    let phone = 7700000000;

    for (let d = -DAYS; d < 0; d++) {
      const date = new Date(Date.now() + d * DAY);
      if (date.getUTCDay() === 5) continue; // Friday off

      // Receptionist: two new patients a day (one arrives as a lead)
      for (let i = 0; i < 2; i++) {
        const c = await act("receptionist", "new client", () => createClient(rec, {
          fullName: `مريض ${clients.length + 1}`, phone: `0${phone++}`, status: rnd() < 0.2 ? "LEAD" : "ACTIVE", source: pick(["INSTAGRAM", "REFERRAL", "WALK_IN"]),
        }), [409]);
        if (c) clients.push(c.id);
      }

      // Receptionist books ~6 visits across the two doctors and two rooms
      for (let slot = 0; slot < 6; slot++) {
        const doctor = doctors[slot % 2];
        const clientId = pick(clients);
        const service = pick(["laser", "facial", "filler", "botox", "consult", "prp"]);
        const ap = await act("receptionist", "book", () => createAppointment(rec, {
          clientId, serviceId: svc[service], staffId: doctor.user.id, roomId: slot % 2 ? room2 : room1,
          startsAt: dayAt(d, 6 + Math.floor(slot / 2) * 2, (slot % 2) * 15),
        }), [409]);
        if (!ap) continue;
        const apId = (ap as unknown as { id: string }).id; // single booking (not a series)

        const roll = rnd();
        if (roll < 0.1) { await act("receptionist", "cancel", () => setAppointmentStatus(rec, apId, { status: "CANCELLED", reason: "طلب المريض" })); continue; }
        if (roll < 0.18) { await act("receptionist", "no-show", () => setAppointmentStatus(rec, apId, { status: "NO_SHOW" })); continue; }
        if (roll < 0.22) continue; // left as booked

        await act("receptionist", "confirm", () => setAppointmentStatus(rec, apId, { status: "CONFIRMED" }));
        await act("receptionist", "check in", () => setAppointmentStatus(rec, apId, { status: "CHECKED_IN" }));
        // Doctor sees the patient
        if (!firstVisit.has(clientId)) {
          firstVisit.add(clientId);
          await act("doctor", "medical record", () => saveMedicalRecord(doctor, clientId, { allergies: rnd() < 0.2 ? "بنسلين" : "", chronicConditions: "" }));
        }
        if (rnd() < 0.5) await act("doctor", "visit note", () => addMedicalEntry(doctor, clientId, { type: "NOTE", title: "زيارة", content: "تمت الجلسة بدون مضاعفات" }));
        await act("doctor", "complete visit", () => setAppointmentStatus(doctor, apId, { status: "COMPLETED" }));

        // Receptionist bills and collects (most pay in full, some partly)
        const inv = await act("receptionist", "bill visit", () => billSource(rec, { source: "appointment", id: apId }), [409]);
        if (!inv) continue;
        const issued = await act("receptionist", "issue invoice", () => issueInvoice(rec, inv.id, {}));
        if (!issued) continue;
        const total = Number(issued.total);
        if (total > 0) {
          const part = rnd() < 0.8 ? total : Math.round(total / 2);
          await act("receptionist", "payment", () => addPayment(rec, inv.id, { amount: part, method: pick(["CASH", "CARD", "TRANSFER"]), paidAt: dayAt(d, 14) }));
        }
      }

      // Weekly: programs, memberships, product sales, surgery and follow-up
      if (Math.abs(d) % 7 === 0) {
        const c = pick(clients);
        // Default receptionist role is view-only for programs/memberships: refused, then the owner sells.
        await act("receptionist", "sell program", () => assignProgram(rec, { clientId: c, templateId: tplId }), [403]);
        const p = await act("owner", "sell program", () => assignProgram(owner, { clientId: c, templateId: tplId }));
        if (p) {
          programs.push(p.id);
          const pi = await act("receptionist", "bill program", () => billSource(rec, { source: "program", id: p.id }));
          if (pi && (await act("receptionist", "issue invoice", () => issueInvoice(rec, pi.id, {})))) {
            await act("receptionist", "payment", () => addPayment(rec, pi.id, { amount: 450, method: "CARD" }));
          }
        }
        await act("receptionist", "sell subscription", () => sellSubscription(rec, { clientId: pick(clients), planId: subPlanId }), [403]);
        const s = await act("owner", "sell subscription", () => sellSubscription(owner, { clientId: pick(clients), planId: subPlanId }));
        if (s) {
          const si = await act("receptionist", "bill subscription", () => billSource(rec, { source: "subscription", id: s.id }));
          if (si && (await act("receptionist", "issue invoice", () => issueInvoice(rec, si.id, {})))) await act("receptionist", "payment", () => addPayment(rec, si.id, { amount: 99, method: "CASH" }));
        }
        await act("receptionist", "POS sale", () => posCheckout(rec, { clientId: pick(clients), lines: [{ kind: "PRODUCT", productId: product, quantity: 2 }], payments: [{ method: "CASH", amount: 40 }] }));
        await act("receptionist", "POS sale with coupon", () => posCheckout(rec, { clientId: pick(clients), couponCode: "WELCOME10", lines: [{ kind: "SERVICE", serviceId: svc.facial, quantity: 1 }], payments: [{ method: "CASH", amount: 45 }] }), [400]);

        const sc = pick(clients);
        const sg = await act("doctor", "plan surgery", () => createSurgery(doc1, { clientId: sc, surgeonId: doc1.user.id, roomId: room2, surgeryType: "شفط دهون", scheduledAt: dayAt(d, 15), durationMin: 60, price: 1500 }), [409]);
        if (sg) {
          await act("doctor", "start surgery", () => setSurgeryStatus(doc1, sg.id, { action: "START" }));
          await act("doctor", "complete surgery", () => setSurgeryStatus(doc1, sg.id, { action: "COMPLETE", followUpDays: [7] }));
          const sgi = await act("receptionist", "bill surgery", () => billSource(rec, { source: "surgery", id: sg.id }));
          if (sgi && (await act("receptionist", "issue invoice", () => issueInvoice(rec, sgi.id, {})))) await act("receptionist", "payment", () => addPayment(rec, sgi.id, { amount: 1000, method: "TRANSFER" }));
        }
        const rv = await act("doctor", "schedule review", () => createReview(doc2, { clientId: pick(clients), doctorId: doc2.user.id, reason: "متابعة", scheduledAt: dayAt(d, 16) }), [409]);
        if (rv) await act("doctor", "complete review", () => completeReview(doc2, rv.id, { diagnosis: "تحسن", outcome: "IMPROVED" }));
      }

      // Once a month: a refund, and the owner closes payroll
      const next = new Date(date.getTime() + DAY);
      if (next.getUTCMonth() !== date.getUTCMonth()) {
        const paid = await withTenant(tenantId, (tx) => tx.invoice.findFirst({ where: { tenantId, status: "PAID" }, orderBy: { createdAt: "desc" } }));
        if (paid) await act("owner", "refund", () => refundInvoice(owner, paid.id, { amount: Math.min(20, Number(paid.total)), method: "CASH", reason: "رد جزئي" }));
        const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
        const run = await act("owner", "payroll", () => generatePayroll(owner, { period }), [409]);
        if (run) await act("owner", "approve payroll", () => setPayrollStatus(owner, run.id, { action: "APPROVE" }));
      }
    }

    // ---------------------------------------------------------------- views
    const from = new Date(Date.now() - DAYS * DAY).toISOString(), to = new Date().toISOString();
    const dOwner = await act("owner", "dashboard", () => getDashboard(owner, { from, to }));
    const dDoc = await act("doctor", "dashboard", () => getDashboard(doc1, { from, to }), [403]);
    const dRec = await act("receptionist", "dashboard", () => getDashboard(rec, { from, to }), [403]);
    await act("owner", "clients list", () => listClients(owner));
    await act("receptionist", "appointments list", () => listAppointments(rec, { from, to }));
    // Receptionist must not read medical data; doctor must.
    await act("receptionist", "read medical (should be refused)", () => getMedical(rec, clients[0]), [403]);
    await act("doctor", "read medical", () => getMedical(doc1, clients[0]));

    const reportKeys = ["clients-overview", "clients-sources", "clients-inactive", "leads-funnel", "staff-performance", "services-performance",
      "surgeries-types", "surgeries-surgeons", "reviews-doctors", "reviews-reasons", "inventory-movements", "inventory-valuation",
      "inventory-shortages", "inventory-expired", "finance-monthly", "receivables", "payments-methods", "subscriptions-stats",
      "coupons-stats", "loyalty-stats", "influencers", "campaigns", "messaging", "branches-compare", "period-compare"];
    for (const k of reportKeys) {
      await act("owner", `report ${k}`, () => runReport(owner, k, { from, to, lang: "ar" }));
      await act("doctor", `report ${k}`, () => runReport(doc1, k, { from, to, lang: "ar" }), [403]);
      await act("receptionist", `report ${k}`, () => runReport(rec, k, { from, to, lang: "ar" }), [403]);
    }

    // ----------------------------------------------------------- consistency
    const tb = await trialBalance(owner, {});
    const bs = await balanceSheet(owner, {});
    const is = await incomeStatement(owner, {});
    const invoices = await withTenant(tenantId, (tx) => tx.invoice.findMany({ where: { tenantId, status: { not: "DRAFT" } }, include: { payments: true } }));
    const badInvoices = invoices.filter((inv) => {
      const paid = inv.payments.reduce((s, p) => s + (p.kind === "REFUND" ? -Number(p.amount) : Number(p.amount)), 0);
      const total = Number(inv.total);
      if (paid < -0.001 || paid > total + 0.001) return true;
      if (inv.status === "PAID" && Math.abs(paid - total) > 0.001) return true;
      if (inv.status === "PARTIALLY_PAID" && (paid <= 0 || paid >= total)) return true;
      return false;
    });
    const negativeStock = await withTenant(tenantId, (tx) => tx.stockLot.findMany({ where: { tenantId, quantity: { lt: 0 } } }));
    const overlaps = await withTenant(tenantId, (tx) => tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "Appointment" a JOIN "Appointment" b
        ON a."tenantId" = b."tenantId" AND a.id < b.id AND a."staffId" = b."staffId"
       AND a.status NOT IN ('CANCELLED','NO_SHOW') AND b.status NOT IN ('CANCELLED','NO_SHOW')
       AND a."startsAt" < b."endsAt" AND b."startsAt" < a."endsAt"
     WHERE a."tenantId" = ${tenantId}::uuid`);

    // A refund made in the simulation must show on the invoice
    const refunded = invoices.find((i) => i.payments.some((p) => p.kind === "REFUND"));
    if (refunded) await act("owner", "open refunded invoice", () => getInvoice(owner, refunded.id));

    const summary = {
      counts,
      totals: { clients: clients.length, programs: programs.length, invoices: invoices.length },
      books: { debit: Number(tb.totals.debit), credit: Number(tb.totals.credit), balanced: bs.balanced, net: Number(is.net), earnings: Number(bs.earnings) },
      dashboard: { ownerSeesMoney: !!dOwner && !!(dOwner as { money?: unknown }).money, doctorSeesMoney: !!dDoc && !!(dDoc as { money?: unknown }).money, receptionistSeesMoney: !!dRec && !!(dRec as { money?: unknown }).money },
      badInvoices: badInvoices.map((i) => ({ code: i.code, status: i.status, total: Number(i.total) })).slice(0, 10),
      negativeStock: negativeStock.length,
      doubleBooked: Number(overlaps[0]?.n ?? 0),
      problems,
    };
    console.log("\n===== SIMULATION SUMMARY =====\n" + JSON.stringify(summary, null, 2));

    expect(problems).toEqual([]);
    expect(Number(tb.totals.debit)).toBeCloseTo(Number(tb.totals.credit), 2);
    expect(bs.balanced).toBe(true);
    expect(Number(bs.earnings)).toBeCloseTo(Number(is.net), 2);
    expect(summary.badInvoices).toEqual([]);
    expect(summary.negativeStock).toBe(0);
    expect(summary.doubleBooked).toBe(0);
    expect(summary.dashboard.doctorSeesMoney).toBe(false);
  }, 900_000);
});

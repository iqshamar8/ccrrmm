/**
 * Three weeks of a working clinic with four people at the desk:
 *   owner (tenant admin), two doctors, a nurse and a receptionist.
 * Past days are worked end to end (book → arrive → treat → bill → collect);
 * the coming week is booked so reminders and notifications have work to do.
 * Every action runs through the real service layer with that person's own
 * permissions. Three kinds of outcome are kept apart:
 *   bugs            – crashes / unexpected errors (the run fails on these)
 *   roleGaps        – a person was refused something they plausibly need
 *   handled         – expected refusals the person worked around (e.g. a
 *                     clash solved by taking the first suggested time)
 *
 *   npm run test:sim3w
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { disconnectAll, withPlatform, withTenant } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { createClient, updateClient, listClients } from "@/server/services/clients";
import { addMedicalEntry, getMedical, saveMedicalRecord } from "@/server/services/medical";
import { createRoom, createService } from "@/server/services/catalog";
import { addWaitlist, createAppointment, listAppointments, setAppointmentStatus, setWaitlistStatus, updateAppointment } from "@/server/services/appointments";
import { assignProgram, createTemplate, recordSession } from "@/server/services/programs";
import { createPlan, sellSubscription } from "@/server/services/subscriptions";
import { createSurgery, setSurgeryStatus } from "@/server/services/surgeries";
import { completeReview, createReview } from "@/server/services/reviews";
import { addPayment, billSource, createInvoice, issueInvoice, posCheckout, refundInvoice, saveProduct, cancelInvoice } from "@/server/services/billing";
import { createCoupon } from "@/server/services/coupons";
import { updateSettings } from "@/server/services/settings";
import { clock, createAdvance, decideLeave, generatePayroll, requestLeave, saveProfile, setPayrollStatus } from "@/server/services/hr";
import { issueStock, listWarehouses, receiveStock, saveServiceMaterials, saveSupplier, stockAlerts } from "@/server/services/inventory";
import { balanceSheet, createVoucher, incomeStatement, listCashAccounts, trialBalance } from "@/server/services/accounting";
import { getDashboard } from "@/server/services/dashboard";
import { runReport } from "@/server/services/reports";
import { launchCampaign, saveCampaign } from "@/server/services/marketing";
import { listMyNotifications } from "@/server/services/notifications";
import { runMessagingCycle } from "@/server/services/messaging";
import { listCommissions, setCommissionStatus } from "@/server/services/commissions";
import { makePlan, makeTenant, makeUserWithRole } from "./helpers";

const RUN = !!process.env.SIM || process.env.npm_lifecycle_event === "test:sim3w";
const WEEKS = 3;
const DAY = 86_400_000;

type Row = { who: string; what: string; error: string };
const bugs: Row[] = [];
const roleGaps: Row[] = [];
const handled: Record<string, number> = {};
const done: Record<string, number> = {};
const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };

function statusOf(e: unknown) {
  return e instanceof AppError ? e.status : e instanceof ZodError ? 422 : (e as { status?: number })?.status;
}
function msg(e: unknown) {
  return e instanceof ZodError ? `422: ${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`
    : `${statusOf(e) ?? "crash"}: ${e instanceof Error ? e.message.split("\n")[0].slice(0, 220) : String(e)}`;
}

/** Do one thing as one person. expected = statuses that are normal business answers. */
async function act<T>(who: string, what: string, fn: () => Promise<T>, opt: { expected?: number[]; roleGap?: boolean } = {}): Promise<T | null> {
  try {
    const r = await fn();
    inc(done, `${who}: ${what}`);
    return r;
  } catch (e) {
    const st = statusOf(e);
    if (st === 403 && opt.roleGap) { roleGaps.push({ who, what, error: msg(e) }); return null; }
    if (st && opt.expected?.includes(st)) { inc(handled, `${who}: ${what} → ${st}`); return null; }
    bugs.push({ who, what, error: msg(e) });
    return null;
  }
}

let seed = 424242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

let owner: Ctx, docA: Ctx, docB: Ctx, nurse: Ctx, rec: Ctx, tenantId: string, branchId: string;
const svc: Record<string, string> = {};
let rooms: string[] = [], product: string, gel: string, wh: string, supplier: string, tplId: string, subPlanId: string, box: string;

/** A time on day `d` (relative to today) at hh:mm Baghdad (UTC+3). */
const at = (d: number, h: number, m = 0) => { const x = new Date(Date.now() + d * DAY); x.setUTCHours(h - 3, m, 0, 0); return x; };

async function staff(role: string, name: string) {
  const u = await makeUserWithRole(tenantId, role);
  await withPlatform((tx) => tx.user.update({ where: { id: u.user.id }, data: { allBranches: true, fullName: name } }));
  return (await loadContext(u.user.id, null))!;
}

/** Book; on a clash take the first suggested time like the receptionist would. */
async function book(who: string, c: Ctx, body: Record<string, unknown>) {
  try {
    const r = await createAppointment(c, body);
    inc(done, `${who}: book`);
    return r as unknown as { id: string; startsAt: Date };
  } catch (e) {
    const st = statusOf(e);
    const sugg = ((e as AppError)?.details as { suggestions?: string[] } | undefined)?.suggestions;
    if (st === 409 && sugg?.length) {
      inc(handled, `${who}: clash → took suggested time`);
      return act(who, "book suggested time", async () => (await createAppointment(c, { ...body, startsAt: new Date(sugg[0]) })) as unknown as { id: string; startsAt: Date });
    }
    if (st === 409) { inc(handled, `${who}: clash with no suggestion`); return null; }
    bugs.push({ who, what: "book", error: msg(e) });
    return null;
  }
}

describe.skipIf(!RUN)("three weeks, four roles", () => {
  beforeAll(async () => {
    const plan = await makePlan({ maxUsers: 50, maxBranches: 5 });
    const t = await makeTenant(plan.id);
    owner = t.ctx; tenantId = t.tenant.id;
    branchId = (await withPlatform((tx) => tx.branch.findFirstOrThrow({ where: { tenantId } }))).id;
    docA = await staff("doctor", "د. سارة");
    docB = await staff("doctor", "د. علي");
    nurse = await staff("nurse", "الممرضة زينب");
    rec = await staff("receptionist", "نور الاستقبال");

    // ---- owner opens the clinic ----
    await act("owner", "settings", () => updateSettings(owner, { defaultTaxRate: 0, loyaltyEnabled: true, pointsPerUnit: 1, pointValue: 0.5, minRedeemPoints: 10 }));
    for (const n of ["غرفة الليزر", "غرفة الحقن", "غرفة الكشف"]) rooms.push((await createRoom(owner, { branchId, name: n })).id);
    for (const [k, name, price, dur, kind] of [
      ["laser", "ليزر إزالة شعر", 90, 30, "LASER"], ["facial", "تنظيف بشرة", 50, 45, "OTHER"], ["filler", "فيلر", 260, 30, "OTHER"],
      ["botox", "بوتوكس", 200, 30, "OTHER"], ["consult", "استشارة", 25, 15, "OTHER"], ["prp", "بلازما", 120, 45, "OTHER"],
    ] as const) svc[k] = (await createService(owner, { name, price, durationMin: dur, kind, execCommission: { type: "PERCENT", value: 10 } })).id;
    product = (await saveProduct(owner, null, { name: "واقي شمس", price: 20, cost: 8, trackStock: true })).id;
    gel = (await saveProduct(owner, null, { name: "جل تبريد", unit: "ml", price: 0, cost: 2, trackStock: true, isSellable: false, isConsumable: true, minStock: 300 })).id;
    wh = (await listWarehouses(owner))[0].id;
    supplier = (await saveSupplier(owner, null, { name: "مورد المستلزمات" })).id;
    await act("owner", "receive stock", () => receiveStock(owner, { warehouseId: wh, supplierId: supplier, lines: [{ itemId: gel, quantity: 600, unitCost: 2 }, { itemId: product, quantity: 60, unitCost: 8 }] }));
    await act("owner", "service materials", () => saveServiceMaterials(owner, svc.laser, [{ itemId: gel, quantity: 5 }]));
    tplId = (await createTemplate(owner, { name: "ليزر 6 جلسات", price: 450, validityDays: 180, intervalDays: 14, items: [{ serviceId: svc.laser, sessions: 6 }] })).id;
    subPlanId = (await createPlan(owner, { name: "اشتراك تنظيف شهري", kind: "VISITS", price: 120, durationDays: 30, visitsLimit: 3, allServices: false, serviceIds: [svc.facial] })).id;
    await act("owner", "coupon", () => createCoupon(owner, { code: "WEEK10", name: "خصم الأسبوع", type: "PERCENT", value: 10 }));
    box = (await listCashAccounts(owner))[0]?.id;
    for (const [c, salary] of [[docA, 3000], [docB, 2800], [nurse, 1100], [rec, 900]] as const) {
      await act("owner", "hr profile", () => saveProfile(owner, c.user.id, { baseSalary: salary }));
    }
  }, 180_000);

  afterAll(disconnectAll);

  it("works three weeks and keeps everything consistent", async () => {
    const clients: string[] = [];
    const leads: string[] = [];
    const seen = new Set<string>();
    const programs: { id: string; clientId: string; itemId: string }[] = [];
    const docs = [docA, docB];
    let phone = 7810000000;
    const start = -WEEKS * 7;

    for (let d = start; d <= 7; d++) {
      const day = new Date(Date.now() + d * DAY);
      if (day.getUTCDay() === 5) continue; // Friday
      const past = d < 0, today = d === 0;

      // ---------- reception: new people walk in / call ----------
      if (d <= 0) {
        for (let i = 0; i < 3; i++) {
          const lead = rnd() < 0.3;
          const c = await act("receptionist", "new client", () => createClient(rec, {
            fullName: `مراجع ${clients.length + leads.length + 1}`, phone: `0${phone++}`, status: lead ? "LEAD" : "ACTIVE",
            source: pick(["INSTAGRAM", "REFERRAL", "WALK_IN", "WHATSAPP"]),
          }), { expected: [409] });
          if (c) (lead ? leads : clients).push(c.id);
        }
        if (leads.length && rnd() < 0.5) {
          const l = leads.shift()!;
          if (await act("receptionist", "convert lead", () => updateClient(rec, l, { status: "ACTIVE" }))) clients.push(l);
        }
      }
      if (!clients.length) continue;

      // ---------- reception: the waitlist ----------
      if (d % 3 === 0 && d <= 0) {
        const w = await act("receptionist", "add to waitlist", () => addWaitlist(rec, { clientId: pick(clients), serviceId: svc.botox, preferredTime: "مساءً" }));
        if (w) {
          const b = await book("receptionist", rec, { clientId: (w as { clientId: string }).clientId, serviceId: svc.botox, staffId: docB.user.id, roomId: rooms[1], startsAt: at(d + 2, 17) });
          if (b) await act("receptionist", "waitlist → booked", () => setWaitlistStatus(rec, (w as { id: string }).id, { status: "BOOKED" }));
        }
      }

      // ---------- the day's bookings ----------
      for (let slot = 0; slot < 8; slot++) {
        const doctor = docs[slot % 2];
        const clientId = pick(clients);
        const service = pick(["laser", "facial", "filler", "botox", "consult", "prp"]);
        // A program client books a program session instead of paying per visit
        const prog = service === "laser" ? programs.find((p) => p.clientId === clientId) : undefined;
        const ap = await book("receptionist", rec, {
          clientId, serviceId: svc[service], staffId: doctor.user.id, roomId: rooms[slot % 3],
          startsAt: at(d, 9 + Math.floor(slot / 2) * 2, (slot % 2) * 30), ...(prog ? { programItemId: prog.itemId } : {}),
        });
        if (!ap) continue;
        const apId = ap.id;
        let startsAt = new Date(ap.startsAt);

        // Some get moved before the day comes
        if (rnd() < 0.08) {
          const moved = await act("receptionist", "reschedule", () => updateAppointment(rec, apId, { startsAt: at(d, 18, 30) }), { expected: [409] });
          if (!moved) continue;
          startsAt = new Date(moved.startsAt);
        }
        if (!past && !today) continue; // future: stays booked for reminders
        // Today: only visits whose time has come (check-in allows up to 2h early)
        if (today && +startsAt > Date.now() + 2 * 3600_000) continue;

        const roll = rnd();
        if (roll < 0.08) { await act("receptionist", "cancel", () => setAppointmentStatus(rec, apId, { status: "CANCELLED", reason: "ظرف طارئ" })); continue; }
        if (roll < 0.14) { await act("receptionist", "no-show", () => setAppointmentStatus(rec, apId, { status: "NO_SHOW" })); continue; }

        await act("receptionist", "confirm", () => setAppointmentStatus(rec, apId, { status: "CONFIRMED" }));
        // The nurse receives the patient at the door
        const nurseIn = await act("nurse", "check patient in", () => setAppointmentStatus(nurse, apId, { status: "CHECKED_IN" }), { roleGap: true });
        if (!nurseIn) await act("receptionist", "check in", () => setAppointmentStatus(rec, apId, { status: "CHECKED_IN" }));
        await act("nurse", "vitals note", () => addMedicalEntry(nurse, clientId, { type: "NOTE", title: "قياسات", content: "الضغط 120/80، النبض 72" }));
        if (!seen.has(clientId)) {
          seen.add(clientId);
          await act("doctor", "medical history", () => saveMedicalRecord(doctor, clientId, { allergies: rnd() < 0.15 ? "بنسلين" : "", chronicConditions: rnd() < 0.1 ? "سكري" : "" }));
        }
        if (rnd() < 0.4) await act("doctor", "diagnosis", () => addMedicalEntry(doctor, clientId, { type: "DIAGNOSIS", title: "تشخيص", content: "حب شباب درجة 2" }));
        await act("doctor", "complete visit", () => setAppointmentStatus(doctor, apId, { status: "COMPLETED" }));

        if (prog) continue; // prepaid program session: nothing to bill

        // Reception bills; big bills go on two instalments; a few use the weekly coupon
        if (rnd() < 0.1) {
          const inv = await act("receptionist", "invoice with coupon", () => createInvoice(rec, { clientId, couponCode: "WEEK10", lines: [{ kind: "SERVICE", serviceId: svc[service], quantity: 1, appointmentId: apId }] }, { issue: true }), { expected: [400, 403] });
          if (inv) { await act("receptionist", "payment", () => addPayment(rec, inv.id, { amount: Number(inv.total), method: "CARD" })); continue; }
        }
        const draft = await act("receptionist", "bill visit", () => billSource(rec, { source: "appointment", id: apId }), { expected: [409] });
        if (!draft) continue;
        const total = Number((draft as { total: unknown }).total);
        const plan = total >= 200 ? { installments: [
          { dueDate: at(d + 15, 12), amount: Math.round(total / 2) }, { dueDate: at(d + 45, 12), amount: total - Math.round(total / 2) },
        ] } : {};
        const inv = await act("receptionist", "issue invoice", () => issueInvoice(rec, draft.id, plan));
        if (!inv) continue;
        const pay = total >= 200 ? Math.round(total / 2) : rnd() < 0.85 ? total : Math.round(total / 2);
        if (pay > 0) await act("receptionist", "payment", () => addPayment(rec, inv.id, { amount: pay, method: pick(["CASH", "CARD", "TRANSFER"]), paidAt: at(d, 15) }));
      }

      if (!past) continue;

      // ---------- shop counter ----------
      if (rnd() < 0.6) await act("receptionist", "POS sale", () => posCheckout(rec, { clientId: pick(clients), lines: [{ kind: "PRODUCT", productId: product, quantity: 1 }], payments: [{ method: "CASH", amount: 20 }] }), { expected: [400] });

      // ---------- twice a week: programs, memberships, surgery, follow-up ----------
      if (Math.abs(d) % 3 === 0) {
        const c = pick(clients);
        await act("receptionist", "sell program", () => assignProgram(rec, { clientId: c, templateId: tplId }), { roleGap: true });
        const p = await act("owner", "sell program", () => assignProgram(owner, { clientId: c, templateId: tplId }));
        if (p) {
          const item = (p as unknown as { items: { id: string }[] }).items[0];
          programs.push({ id: p.id, clientId: c, itemId: item.id });
          const pi = await act("owner", "bill program", () => billSource(owner, { source: "program", id: p.id }));
          if (pi && await act("owner", "issue invoice", () => issueInvoice(owner, pi.id, {}))) await act("receptionist", "payment", () => addPayment(rec, pi.id, { amount: 450, method: "CARD" }));
          // The doctor records the first session on the spot
          await act("doctor", "record program session", () => recordSession(docA, p.id, { itemId: item.id, performedAt: at(d, 13), notes: "جلسة أولى، 18 جول" }));
          await act("nurse", "record program session", () => recordSession(nurse, p.id, { itemId: item.id, performedAt: at(d, 13, 30), notes: "جلسة" }), { roleGap: true, expected: [409] });
        }
        const s = await act("owner", "sell membership", () => sellSubscription(owner, { clientId: pick(clients), planId: subPlanId }));
        if (s) {
          const si = await act("owner", "bill membership", () => billSource(owner, { source: "subscription", id: s.id }));
          if (si && await act("owner", "issue invoice", () => issueInvoice(owner, si.id, {}))) await act("receptionist", "payment", () => addPayment(rec, si.id, { amount: 120, method: "CASH" }));
        }
        const sc = pick(clients);
        const sg = await act("doctor", "plan surgery", () => createSurgery(docA, { clientId: sc, surgeonId: docA.user.id, roomId: rooms[2], surgeryType: "تجميل الأنف", scheduledAt: at(d, 19), durationMin: 90, price: 1800 }), { expected: [409] });
        if (sg) {
          await act("doctor", "start surgery", () => setSurgeryStatus(docA, sg.id, { action: "START" }));
          await act("doctor", "complete surgery", () => setSurgeryStatus(docA, sg.id, { action: "COMPLETE", followUpDays: [7, 30] }));
          const sgi = await act("receptionist", "bill surgery", () => billSource(rec, { source: "surgery", id: sg.id }));
          if (sgi && await act("receptionist", "issue invoice", () => issueInvoice(rec, sgi.id, {}))) await act("receptionist", "payment", () => addPayment(rec, sgi.id, { amount: 1800, method: "TRANSFER" }));
        }
        const rv = await act("doctor", "schedule review", () => createReview(docB, { clientId: pick(clients), doctorId: docB.user.id, reason: "متابعة بعد الجلسة", scheduledAt: at(d, 20) }), { expected: [409] });
        if (rv) await act("doctor", "complete review", () => completeReview(docB, rv.id, { diagnosis: "تحسن واضح", outcome: "IMPROVED" }));
      }

      // ---------- weekly: owner's housekeeping ----------
      if (Math.abs(d) % 7 === 0) {
        await act("nurse", "check stock alerts", () => stockAlerts(nurse));
        await act("nurse", "issue gloves/gel for the clinic", () => issueStock(nurse, { type: "ISSUE", warehouseId: wh, notes: "استهلاك العيادة", lines: [{ itemId: gel, quantity: 10 }] }), { roleGap: true });
        await act("owner", "issue clinic stock", () => issueStock(owner, { type: "ISSUE", warehouseId: wh, notes: "استهلاك العيادة", lines: [{ itemId: gel, quantity: 10 }] }), { expected: [400] });
        await act("owner", "receive stock", () => receiveStock(owner, { warehouseId: wh, supplierId: supplier, lines: [{ itemId: gel, quantity: 200, unitCost: 2 }, { itemId: product, quantity: 10, unitCost: 8 }] }));
        if (box) {
          const rent = await withTenant(tenantId, (tx) => tx.account.findFirst({ where: { tenantId, code: "5104" } }));
          if (rent) await act("owner", "pay expense voucher", () => createVoucher(owner, { type: "PAYMENT", cashAccountId: box, counterAccountId: rent.id, amount: 150, description: "إيجار/خدمات الأسبوع" }));
        }
        const pend = await act("owner", "list commissions", () => listCommissions(owner, {}));
        const ids = (pend as { items: { id: string; status: string }[] } | null)?.items.filter((x) => x.status === "PENDING").map((x) => x.id) ?? [];
        if (ids.length) await act("owner", "approve commissions", () => setCommissionStatus(owner, { ids: ids.slice(0, 50), action: "APPROVE" }));
        await act("owner", "dashboard", () => getDashboard(owner, { from: at(d - 7, 0).toISOString(), to: at(d, 23).toISOString() }));
      }

      // a refund now and then
      if (rnd() < 0.08) {
        const paid = await withTenant(tenantId, (tx) => tx.invoice.findFirst({ where: { tenantId, status: "PAID" }, orderBy: { createdAt: "desc" } }));
        if (paid) await act("owner", "partial refund", () => refundInvoice(owner, paid.id, { amount: Math.min(20, Number(paid.total)), method: "CASH", reason: "جلسة ناقصة" }));
      }
      // a wrong invoice gets cancelled
      if (rnd() < 0.05) {
        const wrong = await act("receptionist", "invoice by mistake", () => createInvoice(rec, { clientId: pick(clients), lines: [{ kind: "SERVICE", serviceId: svc.consult, quantity: 1 }] }, { issue: true }));
        if (wrong) await act("receptionist", "cancel wrong invoice", () => cancelInvoice(rec, wrong.id, { reason: "عميل خطأ" }), { roleGap: true });
      }
    }

    // ---------- people things ----------
    await act("nurse", "request leave", async () => {
      const l = await requestLeave(nurse, { type: "ANNUAL", startDate: at(10, 0).toISOString().slice(0, 10), endDate: at(11, 0).toISOString().slice(0, 10) });
      await act("owner", "approve leave", () => decideLeave(owner, l.id, { action: "APPROVE" }));
      return l;
    });
    await act("owner", "salary advance", () => createAdvance(owner, { userId: rec.user.id, amount: 100 }));
    await act("receptionist", "clock in", () => clock(rec, { action: "IN" }));
    await act("receptionist", "clock out", () => clock(rec, { action: "OUT" }), { expected: [409] });
    await act("nurse", "clock in", () => clock(nurse, { action: "IN" }));

    // ---------- marketing ----------
    const camp = await act("owner", "create campaign", () => saveCampaign(owner, null, { name: "عرض نهاية الشهر", objective: "PROMOTION", filter: {}, body: "مرحباً {{client_name}}، خصم 10% بكود WEEK10", budget: 30 }));
    if (camp) await act("owner", "launch campaign", () => launchCampaign(owner, camp.id, {}), { expected: [400, 409] });

    // ---------- the background jobs a real deployment runs ----------
    await act("system", "messaging cycle (reminders)", () => runMessagingCycle(new Date()));
    await act("system", "messaging cycle again (idempotent)", () => runMessagingCycle(new Date()));

    // ---------- month end ----------
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const run = await act("owner", "payroll", () => generatePayroll(owner, { period }), { expected: [409] });
    if (run) await act("owner", "approve payroll", () => setPayrollStatus(owner, run.id, { action: "APPROVE" }));

    // ---------- what each person sees ----------
    const from = at(start, 0).toISOString(), to = at(7, 23).toISOString();
    const dash: Record<string, { money?: unknown } | null> = {};
    for (const [name, c] of [["owner", owner], ["doctor", docA], ["nurse", nurse], ["receptionist", rec]] as const) {
      dash[name] = await act(name, "dashboard", () => getDashboard(c, { from, to }), { expected: [403] }) as { money?: unknown } | null;
      await act(name, "clients list", () => listClients(c), { expected: [403] });
      await act(name, "appointments this week", () => listAppointments(c, { from: at(0, 0).toISOString(), to: at(7, 23).toISOString() }), { expected: [403] });
      await act(name, "my notifications", () => listMyNotifications(c, {}));
    }
    await act("receptionist", "read medical (must be refused)", () => getMedical(rec, clients[0]), { expected: [403] });
    await act("nurse", "read medical", () => getMedical(nurse, clients[0]));
    for (const k of ["clients-overview", "staff-performance", "services-performance", "finance-monthly", "receivables", "payments-methods",
      "inventory-valuation", "inventory-shortages", "subscriptions-stats", "coupons-stats", "surgeries-surgeons", "reviews-doctors", "period-compare"]) {
      await act("owner", `report ${k}`, () => runReport(owner, k, { from, to, lang: "ar" }));
    }

    // ---------- consistency ----------
    const tb = await trialBalance(owner, {});
    const bs = await balanceSheet(owner, {});
    const is = await incomeStatement(owner, {});
    const invoices = await withTenant(tenantId, (tx) => tx.invoice.findMany({ where: { tenantId, status: { not: "DRAFT" } }, include: { payments: true, installments: true } }));
    const badInvoices = invoices.filter((inv) => {
      const paid = inv.payments.reduce((s, p) => s + (p.kind === "REFUND" ? -Number(p.amount) : Number(p.amount)), 0);
      const total = Number(inv.total);
      if (inv.status === "CANCELLED") return false;
      if (paid < -0.001 || paid > total + 0.001) return true;
      if (inv.status === "PAID" && Math.abs(paid - total) > 0.001) return true;
      if (inv.installments.length && Math.abs(inv.installments.reduce((s, x) => s + Number(x.amount), 0) - total) > 0.01) return true;
      return false;
    });
    const negativeStock = await withTenant(tenantId, (tx) => tx.stockLot.count({ where: { tenantId, quantity: { lt: 0 } } }));
    const overlaps = await withTenant(tenantId, (tx) => tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "Appointment" a JOIN "Appointment" b
        ON a."tenantId" = b."tenantId" AND a.id < b.id
       AND (a."staffId" = b."staffId" OR a."roomId" = b."roomId")
       AND a.status NOT IN ('CANCELLED','NO_SHOW') AND b.status NOT IN ('CANCELLED','NO_SHOW')
       AND a."startsAt" < b."endsAt" AND b."startsAt" < a."endsAt"
     WHERE a."tenantId" = ${tenantId}::uuid`);
    const futureBooked = await withTenant(tenantId, (tx) => tx.appointment.count({ where: { tenantId, startsAt: { gt: new Date() }, status: { in: ["SCHEDULED", "CONFIRMED"] } } }));
    const messages = await withTenant(tenantId, (tx) => tx.message.groupBy({ by: ["status"], where: { tenantId }, _count: true })).catch(() => []);
    const doctorNotes = await withTenant(tenantId, (tx) => tx.notification.count({ where: { tenantId, userId: docA.user.id } })).catch(() => -1);
    const sessions = await withTenant(tenantId, (tx) => tx.programSession.count({ where: { tenantId } })).catch(() => -1);

    const summary = {
      done, handled, roleGaps,
      totals: { clients: clients.length, programs: programs.length, invoices: invoices.length, futureBooked, doctorNotifications: doctorNotes, programSessionsRecorded: sessions },
      messages,
      books: { debit: Number(tb.totals.debit), credit: Number(tb.totals.credit), balanced: bs.balanced, net: Number(is.net), earnings: Number(bs.earnings) },
      moneyOnDashboard: Object.fromEntries(Object.entries(dash).map(([k, v]) => [k, !!v?.money])),
      badInvoices: badInvoices.map((i) => ({ code: i.code, status: i.status, total: Number(i.total) })).slice(0, 10),
      negativeStock, doubleBooked: Number(overlaps[0]?.n ?? 0),
      bugs,
    };
    console.log("\n===== 3-WEEK SIMULATION =====\n" + JSON.stringify(summary, null, 2));

    expect(bugs).toEqual([]);
    expect(Number(tb.totals.debit)).toBeCloseTo(Number(tb.totals.credit), 2);
    expect(bs.balanced).toBe(true);
    expect(Number(bs.earnings)).toBeCloseTo(Number(is.net), 2);
    expect(summary.badInvoices).toEqual([]);
    expect(negativeStock).toBe(0);
    expect(summary.doubleBooked).toBe(0);
    expect(summary.moneyOnDashboard.doctor).toBe(false);
    expect(summary.moneyOnDashboard.nurse).toBe(false);
    expect(summary.moneyOnDashboard.receptionist).toBe(false);
  }, 1_200_000);
});

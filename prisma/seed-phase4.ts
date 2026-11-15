/**
 * Phase 4 demo data, created through the REAL billing services (so numbering,
 * commissions, loyalty and coupon usage are exactly what the app would do),
 * then back-dated to match the appointment history.
 *   settings, tiers, products, coupons, employee profiles + shifts, attendance,
 *   leave, advances, invoices for past visits/programs/subscriptions/surgeries,
 *   POS product sales, last month's payroll (approved & paid).
 * Runs at the end of prisma/seed.ts; standalone: npx tsx prisma/seed-phase4.ts
 */
import "dotenv/config";
import { loadContext, type Ctx } from "../src/server/context";
import { disconnectAll, withPlatform } from "../src/server/db";
import { addPayment, billSource, createInvoice, issueInvoice, posCheckout, saveProduct } from "../src/server/services/billing";
import { createCoupon } from "../src/server/services/coupons";
import { saveTier } from "../src/server/services/loyalty";
import { setCommissionStatus } from "../src/server/services/commissions";
import { updateSettings } from "../src/server/services/settings";
import { generatePayroll, saveProfile, saveShifts, setPayrollStatus } from "../src/server/services/hr";

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DAY = 86400000;
const METHODS = ["CASH", "CASH", "CASH", "CARD", "CARD", "TRANSFER"] as const;

const CONF: Record<string, { iqd: boolean; products: [string, number, number][]; salary: number }> = {
  "elite-beauty": { iqd: true, salary: 1_200_000, products: [["واقي شمس SPF50", 35000, 18000], ["سيروم فيتامين C", 45000, 22000], ["مرطب للبشرة الحساسة", 30000, 14000], ["غسول حمض الساليسيليك", 25000, 11000], ["كريم بعد الليزر", 20000, 8000]] },
  "smile-dental": { iqd: true, salary: 1_000_000, products: [["فرشاة أسنان كهربائية", 60000, 35000], ["معجون تبييض", 12000, 5000], ["غسول فم طبي", 9000, 4000]] },
  "shifa-medical": { iqd: false, salary: 900, products: [["مشد طبي بعد العمليات", 45, 20], ["كريم علاج الندبات", 25, 10], ["واقي شمس طبي", 18, 8]] },
};

async function seedTenant(slug: string, rand: () => number) {
  const meta = await withPlatform(async (tx) => {
    const t = await tx.tenant.findUnique({ where: { slug } });
    if (!t) return null;
    if (await tx.invoice.count({ where: { tenantId: t.id } })) return "skip" as const;
    const admin = await tx.user.findFirstOrThrow({ where: { tenantId: t.id, role: { key: "tenant_admin" } }, orderBy: { createdAt: "asc" } });
    return { tenantId: t.id, adminId: admin.id };
  });
  if (!meta) return;
  if (meta === "skip") return console.log(`  ${slug}: already has Phase 4 data, skipped`);
  const { tenantId } = meta;
  const ctx = (await loadContext(meta.adminId, null)) as Ctx;
  const c = CONF[slug];
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const money = (v: number) => (c.iqd ? Math.round(v / 1000) * 1000 : Math.round(v * 100) / 100);

  // ---------------------------------------------- settings, tiers, coupons --
  await updateSettings(ctx, c.iqd
    ? { taxName: "ضريبة المبيعات", defaultTaxRate: 0, invoiceDueDays: 7, loyaltyEnabled: true, pointsPerUnit: 0.001, pointValue: 50, minRedeemPoints: 100, reviewCommissionAmount: 5000, productCommissionPercent: 3, invoiceFooter: "شكراً لثقتكم — الأسعار تشمل جميع الرسوم." }
    : { taxName: "Sales tax", defaultTaxRate: 0, invoiceDueDays: 14, loyaltyEnabled: true, pointsPerUnit: 1, pointValue: 0.05, minRedeemPoints: 100, reviewCommissionAmount: 5, productCommissionPercent: 3, invoiceFooter: "Thank you for choosing us." });
  const has = (m: string) => ctx.features.has(m);
  if (has("loyalty")) for (const [name, nameEn, minPoints, multiplier, color] of [["برونزي", "Bronze", 0, 1, "#b45309"], ["فضي", "Silver", 500, 1.25, "#64748b"], ["ذهبي", "Gold", 2000, 1.5, "#ca8a04"]] as const) {
    await saveTier(ctx, null, { name, nameEn, minPoints, multiplier, color });
  }
  const products: Awaited<ReturnType<typeof saveProduct>>[] = [];
  for (const [name, price, cost] of c.products) products.push(await saveProduct(ctx, null, { name, price, cost, unit: "قطعة" }));

  const data = await withPlatform(async (tx) => ({
    services: await tx.service.findMany({ where: { tenantId } }),
    users: await tx.user.findMany({ where: { tenantId, status: "ACTIVE" }, include: { role: true } }),
    appts: await tx.appointment.findMany({
      where: { tenantId, status: "COMPLETED", programItemId: null, subscriptionId: null, startsAt: { gte: new Date(Date.now() - 75 * DAY) }, price: { not: null }, surgery: null, review: null },
      orderBy: { startsAt: "asc" },
    }),
    programs: await tx.clientProgram.findMany({ where: { tenantId, status: { not: "CANCELLED" } } }),
    subs: await tx.clientSubscription.findMany({ where: { tenantId, status: { not: "CANCELLED" } } }),
    surgeries: await tx.surgery.findMany({ where: { tenantId, status: "COMPLETED" } }),
    clients: await tx.client.findMany({ where: { tenantId, status: "ACTIVE", deletedAt: null }, take: 120 }),
  }));
  const sellers = data.users.filter((u) => ["sales", "receptionist", "marketing"].includes(u.role?.key ?? ""));
  const marketer = data.users.find((u) => u.role?.key === "marketing") ?? data.users[0];
  const laser = data.services.filter((s) => s.kind === "LASER").map((s) => s.id);
  if (has("coupons")) {
  await createCoupon(ctx, { code: "WELCOME10", name: "خصم الترحيب 10%", type: "PERCENT", value: 10, perClientLimit: 1 });
  if (laser.length) await createCoupon(ctx, { code: "LASER25", name: "عرض الليزر 25%", type: "PERCENT", value: 25, maxDiscount: c.iqd ? 100000 : 100, allServices: false, serviceIds: laser });
  await createCoupon(ctx, { code: "NOOR15", name: "كود المؤثرة نور 15%", type: "PERCENT", value: 15, ownerUserId: marketer.id, commissionType: "PERCENT", commissionValue: 5 });
  await createCoupon(ctx, { code: "SUMMER", name: "عرض الصيف (منتهي)", type: "FIXED", value: c.iqd ? 20000 : 20, endsAt: new Date(Date.now() - 20 * DAY), startsAt: new Date(Date.now() - 80 * DAY) });
  }

  // ------------------------------------------------------------------ HR --
  if (has("hr")) for (const [i, u] of data.users.entries()) {
    const role = u.role?.key ?? "";
    const base = c.salary * (role === "doctor" ? 2.2 : role === "tenant_admin" ? 2.5 : role === "branch_manager" ? 1.8 : role === "accountant" ? 1.3 : 1);
    await saveProfile(ctx, u.id, {
      employeeNo: `E-${String(i + 1).padStart(3, "0")}`, department: role === "doctor" || role === "nurse" || role === "laser_technician" ? "الطبي" : role === "sales" || role === "marketing" ? "المبيعات والتسويق" : "الإدارة",
      specialty: u.jobTitle, hireDate: new Date(Date.now() - (200 + Math.floor(rand() * 900)) * DAY), baseSalary: money(base),
      fixedAllowance: money(base * 0.1), monthlyTarget: role === "doctor" ? money(c.iqd ? 15_000_000 : 12000) : role === "sales" ? money(c.iqd ? 6_000_000 : 4000) : 0,
    });
    await saveShifts(ctx, u.id, [0, 1, 2, 3, 4, 6].map((d) => ({ dayOfWeek: d, startTime: role === "doctor" ? "10:00" : "09:00", endTime: role === "doctor" ? "19:00" : "17:00" })));
  }
  if (has("hr")) await withPlatform(async (tx) => {
    const rows = [];
    const today = new Date(); const T = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    for (const u of data.users) {
      for (let d = 1; d <= 35; d++) {
        const date = new Date(T - d * DAY);
        if (date.getUTCDay() === 5) continue;
        const r = rand();
        const status = r < 0.04 ? "ABSENT" : r < 0.16 ? "LATE" : "PRESENT";
        const startH = 6; // 09:00 local (UTC+3)
        const late = status === "LATE" ? 11 + Math.floor(rand() * 40) : 0;
        rows.push({ tenantId, userId: u.id, date, status: status as "ABSENT" | "LATE" | "PRESENT", lateMinutes: late,
          checkIn: status === "ABSENT" ? null : new Date(+date + (startH * 60 + late - 5 + Math.floor(rand() * 10)) * 60000),
          checkOut: status === "ABSENT" ? null : new Date(+date + (14 * 60 + Math.floor(rand() * 30)) * 60000) });
      }
    }
    await tx.attendanceRecord.createMany({ data: rows, skipDuplicates: true });
    const someone = data.users.filter((u) => u.role?.key !== "tenant_admin");
    if (someone[0]) await tx.leaveRequest.create({ data: { tenantId, userId: someone[0].id, type: "ANNUAL", startDate: new Date(T + 10 * DAY), endDate: new Date(T + 13 * DAY), days: 4, reason: "إجازة عائلية" } });
    if (someone[1]) await tx.leaveRequest.create({ data: { tenantId, userId: someone[1].id, type: "SICK", startDate: new Date(T - 12 * DAY), endDate: new Date(T - 11 * DAY), days: 2, reason: "مراجعة طبية", status: "APPROVED", decidedById: meta.adminId, decidedAt: new Date(T - 13 * DAY) } });
    if (someone[2]) await tx.salaryAdvance.create({ data: { tenantId, userId: someone[2].id, amount: money(c.salary * 0.3), givenAt: new Date(T - 6 * DAY), note: "سلفة طارئة", createdById: meta.adminId } });
  });

  // ------------------------------------------------------------ invoices --
  const backdate = async (invoiceId: string, at: Date) => withPlatform(async (tx) => {
    await tx.invoice.update({ where: { id: invoiceId }, data: { issuedAt: at, createdAt: at } });
    await tx.payment.updateMany({ where: { invoiceId, kind: "PAYMENT" }, data: { paidAt: at } });
    await tx.commissionEntry.updateMany({ where: { invoiceId }, data: { earnedAt: at } });
    await tx.loyaltyTransaction.updateMany({ where: { invoiceId }, data: { createdAt: at } });
  });
  let count = 0;
  const pay = async (invId: string, total: number, at: Date, full = true) => {
    if (total <= 0) return;
    const r = rand();
    if (!full || r < 0.06) return; // left unpaid → receivable
    if (r < 0.16) { await addPayment(ctx, invId, { amount: money(total * 0.5), method: pick(METHODS), paidAt: at }); return; }
    if (r < 0.3) {
      const a = money(total * 0.6);
      await addPayment(ctx, invId, { amount: a, method: "CASH", paidAt: at });
      await addPayment(ctx, invId, { amount: Math.round((total - a) * 100) / 100, method: "CARD", paidAt: at });
      return;
    }
    await addPayment(ctx, invId, { amount: total, method: pick(METHODS), paidAt: at });
  };

  // visits (≈70%)
  for (const a of data.appts) {
    if (rand() > 0.7) continue;
    const seller = sellers.length && rand() < 0.5 ? pick(sellers).id : null;
    const coupon = has("coupons") && rand() < 0.08 ? pick(["NOOR15", ...(laser.includes(a.serviceId ?? "") ? ["LASER25"] : [])]) : null;
    try {
      const inv = await createInvoice(ctx, { clientId: a.clientId, branchId: a.branchId, salesStaffId: seller, couponCode: coupon,
        lines: [{ kind: "SERVICE", appointmentId: a.id, quantity: 1 }] }, { issue: true });
      await pay(inv.id, Number(inv.total), a.startsAt);
      await backdate(inv.id, a.startsAt);
      count++;
    } catch { /* e.g. coupon limits — skip */ }
  }
  // programs, subscriptions, surgeries
  for (const p of data.programs) {
    if (rand() > 0.85) continue;
    const draft = await billSource(ctx, { source: "program", id: p.id });
    const at = new Date(+p.startDate + 11 * 3600000);
    const inst = rand() < 0.25 ? [{ dueDate: p.startDate, amount: money(Number(draft.total) / 2) }, { dueDate: new Date(+p.startDate + 30 * DAY), amount: Number(draft.total) - money(Number(draft.total) / 2) }] : null;
    const inv = await issueInvoice(ctx, draft.id, { installments: inst });
    if (inst) await addPayment(ctx, inv.id, { amount: inst[0].amount, method: pick(METHODS), paidAt: at });
    else await pay(inv.id, Number(inv.total), at);
    await backdate(inv.id, at); count++;
  }
  for (const s of data.subs) {
    const draft = await billSource(ctx, { source: "subscription", id: s.id });
    const inv = await issueInvoice(ctx, draft.id, {});
    const at = new Date(+s.startDate + 12 * 3600000);
    await pay(inv.id, Number(inv.total), at);
    await backdate(inv.id, at); count++;
  }
  for (const s of data.surgeries) {
    const draft = await billSource(ctx, { source: "surgery", id: s.id });
    const total = Number(draft.total);
    const inst = [{ dueDate: s.scheduledAt, amount: money(total * 0.5) }, { dueDate: new Date(+s.scheduledAt + 30 * DAY), amount: money(total * 0.25) }, { dueDate: new Date(+s.scheduledAt + 60 * DAY), amount: Math.round((total - money(total * 0.5) - money(total * 0.25)) * 100) / 100 }];
    const inv = await issueInvoice(ctx, draft.id, { installments: inst });
    await addPayment(ctx, inv.id, { amount: inst[0].amount, method: "TRANSFER", paidAt: s.scheduledAt });
    if (+s.scheduledAt < Date.now() - 35 * DAY) await addPayment(ctx, inv.id, { amount: inst[1].amount, method: "CASH", paidAt: new Date(+s.scheduledAt + 30 * DAY) });
    await backdate(inv.id, s.scheduledAt); count++;
  }
  // POS retail sales
  for (let i = 0; i < (slug === "elite-beauty" ? 60 : 20); i++) {
    const at = new Date(Date.now() - Math.floor(rand() * 60) * DAY - Math.floor(rand() * 8) * 3600000);
    const lines = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({ kind: "PRODUCT" as const, productId: pick(products).id, quantity: 1 + Math.floor(rand() * 2) }));
    const client = rand() < 0.6 ? pick(data.clients) : null;
    const prices = lines.reduce((s, l) => s + Number(products.find((p) => p.id === l.productId)!.price) * l.quantity, 0);
    try {
      const inv = await posCheckout(ctx, { clientId: client?.id ?? null, branchId: client?.branchId ?? null, salesStaffId: sellers.length ? pick(sellers).id : null, lines, payments: [{ method: pick(METHODS), amount: prices }] });
      await backdate(inv.id, at); count++;
    } catch { /* skip */ }
  }

  // ------------------------------------------------ commissions & payroll --
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const period = lastMonth.toISOString().slice(0, 7);
  if (!has("commissions") || !has("hr")) return console.log(`  ${slug}: ${count} invoices, ${products.length} products (plan without HR/commissions)`);
  const toApprove = await withPlatform((tx) => tx.commissionEntry.findMany({ where: { tenantId, status: "PENDING", earnedAt: { lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } }, select: { id: true } }));
  for (let i = 0; i < toApprove.length; i += 500) await setCommissionStatus(ctx, { ids: toApprove.slice(i, i + 500).map((x) => x.id), action: "APPROVE" });
  const run = await generatePayroll(ctx, { period });
  await setPayrollStatus(ctx, run.id, { action: "APPROVE" });
  await setPayrollStatus(ctx, run.id, { action: "PAID" });
  console.log(`  ${slug}: ${count} invoices, ${products.length} products, ${toApprove.length} commissions settled in payroll ${period}`);
}

export async function seedPhase4() {
  const rand = rng(424242);
  for (const slug of ["elite-beauty", "smile-dental", "shifa-medical"]) await seedTenant(slug, rand);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-phase4.ts")) {
  seedPhase4().then(() => console.log("Phase 4 seed complete.")).catch((e) => { console.error(e); process.exit(1); }).finally(disconnectAll);
}

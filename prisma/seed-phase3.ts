/**
 * Phase 3 demo data: program templates + sold programs with session history,
 * subscription plans + sold subscriptions (active, expiring, frozen, expired,
 * exhausted), surgeries with teams/supplies and post-op reviews, routine reviews.
 *
 * Runs at the end of prisma/seed.ts. On an already-seeded DB:  npx tsx prisma/seed-phase3.ts
 * Tenants that already have program templates are skipped.
 */
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { disconnectAll, type Tx, withPlatform } from "../src/server/db";

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY = 86400000;
const TZ = 3; // Asia/Baghdad
const today = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
/** local wall-clock time on a given UTC date */
const at = (day: Date, h: number, m = 0) => new Date(+day + ((h - TZ) * 60 + m) * 60000);

type Tpl = { name: string; nameEn: string; price: number; validity: number; interval: number; items: [string, number][] };
const TEMPLATES: Record<string, Tpl[]> = {
  "elite-beauty": [
    { name: "برنامج ليزر الجسم الكامل — 6 جلسات", nameEn: "Full body laser — 6 sessions", price: 1200000, validity: 240, interval: 30, items: [["ليزر الجسم الكامل", 6]] },
    { name: "برنامج نضارة البشرة", nameEn: "Skin glow program", price: 420000, validity: 150, interval: 21, items: [["هيدرافيشل", 4], ["تقشير كيميائي", 2]] },
    { name: "برنامج علاج حب الشباب", nameEn: "Acne program", price: 380000, validity: 120, interval: 14, items: [["استشارة جلدية", 1], ["تقشير كيميائي", 4], ["مراجعة", 2]] },
    { name: "ليزر الوجه — 8 جلسات", nameEn: "Face laser — 8 sessions", price: 400000, validity: 300, interval: 28, items: [["ليزر الوجه", 8]] },
  ],
  "smile-dental": [
    { name: "برنامج العناية الدورية بالأسنان", nameEn: "Periodic dental care", price: 140000, validity: 365, interval: 90, items: [["كشف وتشخيص", 2], ["تنظيف وتلميع", 2]] },
  ],
  "shifa-medical": [
    { name: "برنامج علاج حب الشباب المتقدم", nameEn: "Advanced acne treatment", price: 300, validity: 120, interval: 14, items: [["استشارة جلدية", 1], ["علاج حب الشباب", 5]] },
  ],
};

type Plan = { name: string; nameEn: string; kind: "TIME" | "VISITS" | "SESSIONS"; price: number; days: number; visits?: number; freeze: number; services?: string[] };
const PLANS: Record<string, Plan[]> = {
  "elite-beauty": [
    { name: "عضوية VIP الشهرية", nameEn: "VIP monthly membership", kind: "TIME", price: 450000, days: 30, freeze: 7, services: ["هيدرافيشل", "تقشير كيميائي", "استشارة جلدية", "مراجعة"] },
    { name: "بطاقة ليزر 10 زيارات", nameEn: "Laser card — 10 visits", kind: "VISITS", price: 350000, days: 365, visits: 10, freeze: 30, services: ["ليزر الوجه", "ليزر الإبط"] },
    { name: "باقة العناية السنوية — 12 جلسة", nameEn: "Annual care — 12 sessions", kind: "SESSIONS", price: 900000, days: 365, visits: 12, freeze: 30, services: ["هيدرافيشل", "تقشير كيميائي", "ميزوثيرابي"] },
  ],
  "smile-dental": [
    { name: "باقة العائلة — 6 زيارات", nameEn: "Family pack — 6 visits", kind: "VISITS", price: 180000, days: 365, visits: 6, freeze: 0, services: ["كشف وتشخيص", "تنظيف وتلميع"] },
  ],
  "shifa-medical": [
    { name: "اشتراك الاستشارات السنوي", nameEn: "Annual consultations", kind: "TIME", price: 150, days: 365, freeze: 30, services: ["استشارة باطنية", "استشارة جلدية"] },
  ],
};

async function seedTenant(tx: Tx, slug: string, rand: () => number) {
  const tenant = await tx.tenant.findUnique({ where: { slug } });
  if (!tenant) return;
  const tenantId = tenant.id;
  if (await tx.programTemplate.count({ where: { tenantId } })) return console.log(`  ${slug}: already has Phase 3 data, skipped`);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const services = await tx.service.findMany({ where: { tenantId } });
  const svc = (name: string) => services.find((s) => s.name === name)!;
  const clients = await tx.client.findMany({ where: { tenantId, status: "ACTIVE", deletedAt: null }, orderBy: { code: "asc" } });
  const doctors = await tx.user.findMany({ where: { tenantId, status: "ACTIVE", role: { key: "doctor" } }, include: { branchAccess: true } });
  const T = today();
  const used = new Set<string>(); // doctor+slot keys for evening reviews
  const counters: Record<string, number> = { program: 0, subscription: 0, surgery: 0 };
  const code = (k: string, p: string) => `${p}-${String(++counters[k]).padStart(6, "0")}`;

  /** Evening slot (19:15+, 25-min steps) unique per doctor+day, so exclusion constraints never trip. */
  const eveningSlot = (doctorId: string, day: Date) => {
    for (let k = 0; k < 6; k++) {
      const key = `${doctorId}|${+day}|${k}`;
      if (!used.has(key)) { used.add(key); return at(day, 19, 15 + k * 25); }
    }
    return null;
  };

  // ---------------------------------------------------------- programs --
  const tpls = [];
  for (const t of TEMPLATES[slug] ?? []) {
    tpls.push(await tx.programTemplate.create({
      data: { tenantId, name: t.name, nameEn: t.nameEn, price: t.price, validityDays: t.validity, intervalDays: t.interval,
        items: { create: t.items.map(([n, sessions]) => ({ tenantId, serviceId: svc(n).id, sessions })) } },
      include: { items: true },
    }));
  }
  const progClients = clients.filter(() => rand() < 0.3).slice(0, slug === "elite-beauty" ? 40 : 12);
  const sessions: Prisma.ProgramSessionCreateManyInput[] = [];
  for (const c of progClients) {
    const tpl = pick(tpls);
    const doctor = doctors.length ? pick(doctors) : null;
    const startDate = new Date(+T - Math.floor(20 + rand() * 170) * DAY);
    const endDate = new Date(+startDate + (tpl.validityDays ?? 180) * DAY);
    const r = rand();
    const status = r < 0.06 ? "CANCELLED" : r < 0.12 ? "PAUSED" : "ACTIVE";
    const p = await tx.clientProgram.create({
      data: {
        tenantId, code: code("program", "P"), clientId: c.id, branchId: c.branchId, templateId: tpl.id, doctorId: doctor?.id ?? null,
        name: tpl.name, price: tpl.price, startDate, endDate, intervalDays: tpl.intervalDays, status, createdAt: startDate,
        cancelReason: status === "CANCELLED" ? "سفر العميل" : null, cancelledAt: status === "CANCELLED" ? new Date(+startDate + 40 * DAY) : null,
        pausedAt: status === "PAUSED" ? new Date(+T - 10 * DAY) : null,
        items: { create: tpl.items.map((i) => ({ tenantId, serviceId: i.serviceId, sessionsTotal: i.sessions })) },
      },
      include: { items: true },
    });
    // Sessions spaced by the interval up to today (some programs stall → no recent session)
    const stall = rand() < 0.25;
    let allDone = true;
    for (const it of p.items) {
      let n = 0;
      for (let k = 0; k < it.sessionsTotal; k++) {
        const when = new Date(+startDate + k * (tpl.intervalDays ?? 21) * DAY + 15 * 3600000);
        if (+when > +T - (stall ? 45 : 1) * DAY) break;
        sessions.push({ tenantId, clientProgramId: p.id, itemId: it.id, sessionNo: ++n, performedAt: when, performedById: doctor?.id ?? null,
          notes: pick(["تحمّل جيد للجلسة", "احمرار خفيف زال خلال ساعة", "تم رفع الطاقة درجة واحدة", null]), result: pick(["تحسن ملحوظ", "استجابة جيدة", null, null]) });
      }
      if (n < it.sessionsTotal) allDone = false;
    }
    if (allDone && status === "ACTIVE") await tx.clientProgram.update({ where: { id: p.id }, data: { status: "COMPLETED", completedAt: T, results: "اكتمل البرنامج بنتائج ممتازة" } });
    else if (status === "ACTIVE" && +endDate < +T) await tx.clientProgram.update({ where: { id: p.id }, data: { status: "EXPIRED" } });
  }
  if (sessions.length) await tx.programSession.createMany({ data: sessions });

  // ----------------------------------------------------- subscriptions --
  const plans = [];
  for (const pl of PLANS[slug] ?? []) {
    const ids = (pl.services ?? []).map((n) => svc(n)?.id).filter(Boolean) as string[];
    plans.push(await tx.subscriptionPlan.create({
      data: { tenantId, name: pl.name, nameEn: pl.nameEn, kind: pl.kind, price: pl.price, durationDays: pl.days, visitsLimit: pl.visits ?? null,
        maxFreezeDays: pl.freeze, allServices: !ids.length, services: { create: ids.map((serviceId) => ({ tenantId, serviceId })) } },
      include: { services: true },
    }));
  }
  const usages: Prisma.SubscriptionUsageCreateManyInput[] = [];
  const subClients = clients.filter((c) => !progClients.includes(c) && rand() < 0.3).slice(0, slug === "elite-beauty" ? 35 : 10);
  for (const [idx, c] of subClients.entries()) {
    const plan = pick(plans);
    // a few deliberately expiring within the next week
    const startDate = idx % 7 === 0 ? new Date(+T - (plan.durationDays - 4) * DAY) : new Date(+T - Math.floor(rand() * Math.min(plan.durationDays + 60, 300)) * DAY);
    const endDate = new Date(+startDate + (plan.durationDays - 1) * DAY);
    let status: "ACTIVE" | "FROZEN" | "CANCELLED" | "EXPIRED" = +endDate < +T ? "EXPIRED" : "ACTIVE";
    if (status === "ACTIVE" && idx % 11 === 3) status = "FROZEN";
    if (status === "ACTIVE" && idx % 13 === 5) status = "CANCELLED";
    const s = await tx.clientSubscription.create({
      data: {
        tenantId, code: code("subscription", "SUB"), clientId: c.id, branchId: c.branchId, planId: plan.id, name: plan.name, kind: plan.kind, price: plan.price,
        startDate, endDate, visitsTotal: plan.visitsLimit, allServices: plan.allServices, coveredServiceIds: plan.services.map((x) => x.serviceId),
        maxFreezeDays: plan.maxFreezeDays, status, frozenAt: status === "FROZEN" ? new Date(+T - 3 * DAY) : null, createdAt: startDate,
        cancelledAt: status === "CANCELLED" ? new Date(+T - 5 * DAY) : null, cancelReason: status === "CANCELLED" ? "طلب العميل" : null,
      },
    });
    const elapsed = Math.max(0, Math.min(+T, +endDate) - +startDate) / DAY;
    const n = Math.min(plan.visitsLimit ?? 99, Math.floor((elapsed / 10) * (0.5 + rand())));
    for (let k = 0; k < n; k++) {
      usages.push({ tenantId, subscriptionId: s.id, serviceId: plan.services.length ? pick(plan.services).serviceId : null,
        usedAt: new Date(+startDate + Math.floor(rand() * elapsed) * DAY + 14 * 3600000), note: k === 0 ? "أول زيارة" : null });
    }
    if (plan.visitsLimit && n >= plan.visitsLimit && status === "ACTIVE") await tx.clientSubscription.update({ where: { id: s.id }, data: { status: "EXPIRED" } });
  }
  if (usages.length) await tx.subscriptionUsage.createMany({ data: usages });

  // ------------------------------------------------------- surgeries --
  const reviewsToMake: { clientId: string; branchId: string; doctorId: string; surgeryId?: string; programId?: string; day: Date; reason: string; type: string }[] = [];
  if (slug === "shifa-medical") {
    const surgeon = (await tx.user.findFirst({ where: { tenantId, email: "doctor@shifa.test" } }))!;
    const assistant = await tx.user.findFirst({ where: { tenantId, email: "dr.ali@shifa.test" } });
    const main = await tx.branch.findFirstOrThrow({ where: { tenantId, code: "MAIN" } });
    const or = await tx.room.findFirst({ where: { tenantId, kind: "OPERATING" } });
    const surgeryServices = services.filter((s) => s.kind === "SURGERY");
    const days = [-80, -66, -59, -45, -38, -31, -24, -17, -12, -9, -5, -2, 3, 6, 10];
    for (const [i, off] of days.entries()) {
      const day = new Date(+T + off * DAY);
      if (day.getUTCDay() === 5) continue;
      const service = surgeryServices[i % surgeryServices.length];
      const c = clients[(i * 7) % clients.length];
      const start = at(day, 6, 30);
      const end = new Date(+start + service.durationMin * 60000);
      const past = off < 0;
      const appt = await tx.appointment.create({
        data: { tenantId, branchId: main.id, clientId: c.id, serviceId: service.id, staffId: surgeon.id, roomId: or?.id ?? null, startsAt: start, endsAt: end,
          status: past ? "COMPLETED" : i % 2 ? "CONFIRMED" : "SCHEDULED", price: service.price, notes: service.name, bookingSource: "surgery", completedAt: past ? end : null },
      });
      const s = await tx.surgery.create({
        data: {
          tenantId, code: code("surgery", "S"), clientId: c.id, branchId: main.id, serviceId: service.id, surgeryType: service.name, surgeonId: surgeon.id,
          roomId: or?.id ?? null, appointmentId: appt.id, scheduledAt: start, durationMin: service.durationMin, price: service.price,
          status: past ? "COMPLETED" : i % 2 ? "CONFIRMED" : "PLANNED", anesthesiaType: pick(["تخدير عام", "تخدير موضعي مع تهدئة"]),
          preOpNotes: "الفحوصات المختبرية طبيعية. تم توقيع الموافقة المستنيرة. صيام 8 ساعات.",
          postOpNotes: past ? "استقرار العلامات الحيوية. تم إعطاء مسكن ومضاد حيوي." : null,
          operativeReport: past ? `أُجريت عملية ${service.name} دون مضاعفات. فقدان دم ضئيل.` : null,
          complications: past && i === 4 ? "تورم أكثر من المعتاد في اليوم الثاني" : null,
          recoveryStatus: past ? (i === 4 ? "NEEDS_ATTENTION" : off < -30 ? "RECOVERED" : "STABLE") : "NOT_STARTED",
          startedAt: past ? start : null, completedAt: past ? end : null,
          team: assistant ? { create: [{ tenantId, userId: assistant.id, role: "ASSISTANT" }] } : undefined,
          supplies: { create: [
            { tenantId, name: "خيوط جراحية 3-0", quantity: 4, unitCost: 6 },
            { tenantId, name: "شاش معقم", quantity: 20, unitCost: 0.5 },
            { tenantId, name: "مشد طبي بعد العملية", quantity: 1, unitCost: 45 },
          ] },
        },
      });
      if (past) {
        await tx.client.update({ where: { id: c.id }, data: { lastVisitAt: start } });
        for (const d of [7, 30]) reviewsToMake.push({ clientId: c.id, branchId: main.id, doctorId: surgeon.id, surgeryId: s.id, day: new Date(+day + d * DAY), reason: `مراجعة بعد العملية (${d} يوم) — ${service.name}`, type: "POST_OP" });
      }
    }
    await tx.tenantCounter.create({ data: { tenantId, key: "surgery", value: counters.surgery } });
  }

  // routine / program follow-up reviews
  const progs = await tx.clientProgram.findMany({ where: { tenantId, status: "ACTIVE" }, take: 12 });
  for (const [i, p] of progs.entries()) {
    if (!p.doctorId) continue;
    reviewsToMake.push({ clientId: p.clientId, branchId: p.branchId, doctorId: p.doctorId, programId: p.id, day: new Date(+T + (i - 6) * 3 * DAY), reason: "متابعة نتائج البرنامج العلاجي", type: "TREATMENT" });
  }

  for (const r of reviewsToMake) {
    if (r.day.getUTCDay() === 5) r.day = new Date(+r.day + DAY);
    const start = eveningSlot(r.doctorId, r.day);
    if (!start) continue;
    const past = +start < Date.now();
    const roll = rand();
    const status = !past ? "SCHEDULED" : roll < 0.8 ? "COMPLETED" : roll < 0.9 ? "MISSED" : "SCHEDULED"; // a few overdue
    const appt = await tx.appointment.create({
      data: { tenantId, branchId: r.branchId, clientId: r.clientId, staffId: r.doctorId, startsAt: start, endsAt: new Date(+start + 20 * 60000),
        status: status === "COMPLETED" ? "COMPLETED" : status === "MISSED" ? "NO_SHOW" : "SCHEDULED", notes: r.reason, bookingSource: "review" },
    });
    await tx.medicalReview.create({
      data: {
        tenantId, clientId: r.clientId, branchId: r.branchId, doctorId: r.doctorId, surgeryId: r.surgeryId ?? null, clientProgramId: r.programId ?? null,
        appointmentId: appt.id, reasonType: r.type, reason: r.reason, scheduledAt: start, status, completedAt: status === "COMPLETED" ? start : null,
        diagnosis: status === "COMPLETED" ? pick(["التئام جيد للجرح", "تحسن تدريجي", "وذمة بسيطة متبقية"]) : null,
        notes: status === "COMPLETED" ? "يستمر على التعليمات. تجنب الشمس والمجهود." : null,
        procedures: status === "COMPLETED" ? pick(["إزالة الغرز", "تغيير الضماد", "تقييم سريري", null]) : null,
        outcome: status === "COMPLETED" ? pick(["IMPROVED", "STABLE", "RESOLVED"]) : null,
      },
    });
  }

  for (const k of ["program", "subscription"]) if (counters[k]) await tx.tenantCounter.create({ data: { tenantId, key: k, value: counters[k] } });
  console.log(`  ${slug}: ${tpls.length} templates, ${progClients.length} programs (${sessions.length} sessions), ${subClients.length} subscriptions, ${counters.surgery} surgeries, ${reviewsToMake.length} reviews`);
}

export async function seedPhase3(tx: Tx) {
  const rand = rng(31337);
  for (const slug of ["elite-beauty", "smile-dental", "shifa-medical"]) await seedTenant(tx, slug, rand);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-phase3.ts")) {
  withPlatform((tx) => seedPhase3(tx), { timeout: 300000 })
    .then(() => console.log("Phase 3 seed complete."))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(disconnectAll);
}

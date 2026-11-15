/**
 * Phase 2 demo data: service trees, rooms, practitioners, ~300 clients,
 * ~3 months of appointment history + 3 weeks ahead, medical records.
 *
 * Runs automatically at the end of prisma/seed.ts. On a database seeded
 * before Phase 2 run it alone:   npx tsx prisma/seed-phase2.ts
 * Tenants that already have services are skipped (safe to re-run).
 */
import "dotenv/config";
import type { AppointmentStatus, Prisma } from "@prisma/client";
import { hashPassword } from "../src/server/auth";
import { disconnectAll, type Tx, withPlatform } from "../src/server/db";

// Deterministic RNG so every reset gives the same demo data.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FEMALE = ["فاطمة", "زينب", "مريم", "نور", "سارة", "هدى", "رقية", "آية", "دعاء", "شهد", "رغد", "بنين", "حوراء", "ملاك", "تبارك", "زهراء", "ريم", "لمى", "يقين", "سجى", "دانية", "أسيل", "غدير", "إسراء"];
const MALE = ["علي", "حسين", "محمد", "أحمد", "مصطفى", "حيدر", "عباس", "مرتضى", "كرار", "منتظر", "يوسف", "عمر", "سجاد", "زيد", "حسن", "باقر"];
const LAST = ["الكبيسي", "العبيدي", "الجبوري", "الساعدي", "الموسوي", "الحسيني", "التميمي", "الربيعي", "الدليمي", "الخفاجي", "الزبيدي", "العزاوي", "البياتي", "الشمري", "الكعبي", "المالكي", "العامري", "النعيمي"];
const SOURCES: [string, number][] = [["instagram", 30], ["walk_in", 15], ["referral", 15], ["tiktok", 12], ["whatsapp", 8], ["google", 7], ["influencer", 7], ["facebook", 4], ["phone", 2]];
const TAGS = ["VIP", "بشرة حساسة", "عرض الصيف", "متابعة دورية", "عميل مؤسسة", "حساسية"];

type Svc = { name: string; nameEn: string; kind: string; price: number; cost: number; dur: number; color: string; staff?: string[] };
type Cat = { name: string; nameEn: string; children?: Cat[]; services?: Svc[] };

const TREES: Record<string, Cat[]> = {
  "elite-beauty": [
    { name: "الليزر", nameEn: "Laser", children: [
      { name: "إزالة الشعر بالليزر", nameEn: "Laser hair removal", services: [
        { name: "ليزر الجسم الكامل", nameEn: "Full body laser", kind: "LASER", price: 250000, cost: 40000, dur: 90, color: "#7c3aed" },
        { name: "ليزر الوجه", nameEn: "Face laser", kind: "LASER", price: 60000, cost: 8000, dur: 30, color: "#8b5cf6" },
        { name: "ليزر الإبط", nameEn: "Underarm laser", kind: "LASER", price: 40000, cost: 5000, dur: 20, color: "#a78bfa" },
      ] },
      { name: "ليزر البشرة", nameEn: "Skin laser", services: [
        { name: "ليزر الكربون", nameEn: "Carbon peel", kind: "LASER", price: 90000, cost: 15000, dur: 45, color: "#4c1d95" },
        { name: "فراكشنال CO2", nameEn: "Fractional CO2", kind: "LASER", price: 200000, cost: 35000, dur: 60, color: "#5b21b6", staff: ["doctor"] },
      ] },
    ] },
    { name: "الحقن التجميلية", nameEn: "Injectables", services: [
      { name: "بوتوكس جبهة", nameEn: "Forehead botox", kind: "COSMETIC", price: 300000, cost: 120000, dur: 30, color: "#db2777", staff: ["doctor"] },
      { name: "فيلر شفاه 1 مل", nameEn: "Lip filler 1ml", kind: "COSMETIC", price: 350000, cost: 150000, dur: 45, color: "#ec4899", staff: ["doctor"] },
      { name: "ميزوثيرابي", nameEn: "Mesotherapy", kind: "COSMETIC", price: 120000, cost: 30000, dur: 40, color: "#f472b6" },
    ] },
    { name: "العناية بالبشرة", nameEn: "Skin care", services: [
      { name: "هيدرافيشل", nameEn: "HydraFacial", kind: "COSMETIC", price: 100000, cost: 20000, dur: 60, color: "#0891b2" },
      { name: "تقشير كيميائي", nameEn: "Chemical peel", kind: "MEDICAL", price: 80000, cost: 12000, dur: 45, color: "#06b6d4" },
    ] },
    { name: "الاستشارات والمراجعات", nameEn: "Consultations", services: [
      { name: "استشارة جلدية", nameEn: "Dermatology consultation", kind: "CONSULTATION", price: 25000, cost: 0, dur: 20, color: "#059669", staff: ["doctor"] },
      { name: "مراجعة", nameEn: "Follow-up", kind: "FOLLOW_UP", price: 0, cost: 0, dur: 15, color: "#10b981", staff: ["doctor"] },
    ] },
  ],
  "smile-dental": [
    { name: "العلاج", nameEn: "Treatment", services: [
      { name: "كشف وتشخيص", nameEn: "Check-up", kind: "CONSULTATION", price: 15000, cost: 0, dur: 20, color: "#059669" },
      { name: "حشوة تجميلية", nameEn: "Composite filling", kind: "DENTAL", price: 50000, cost: 10000, dur: 45, color: "#0284c7" },
      { name: "علاج عصب", nameEn: "Root canal", kind: "DENTAL", price: 150000, cost: 30000, dur: 60, color: "#1d4ed8" },
      { name: "قلع", nameEn: "Extraction", kind: "DENTAL", price: 30000, cost: 5000, dur: 30, color: "#475569" },
    ] },
    { name: "تجميل الأسنان", nameEn: "Cosmetic dentistry", services: [
      { name: "تنظيف وتلميع", nameEn: "Scaling & polish", kind: "DENTAL", price: 40000, cost: 5000, dur: 40, color: "#0d9488" },
      { name: "تبييض بالليزر", nameEn: "Laser whitening", kind: "COSMETIC", price: 200000, cost: 50000, dur: 60, color: "#eab308" },
      { name: "فينير (للسن)", nameEn: "Veneer (per tooth)", kind: "COSMETIC", price: 250000, cost: 90000, dur: 60, color: "#ca8a04" },
    ] },
  ],
  "shifa-medical": [
    { name: "العيادات الاستشارية", nameEn: "Outpatient clinics", children: [
      { name: "الباطنية", nameEn: "Internal medicine", services: [
        { name: "استشارة باطنية", nameEn: "Internal medicine consult", kind: "CONSULTATION", price: 20, cost: 0, dur: 20, color: "#059669" },
      ] },
      { name: "الجلدية", nameEn: "Dermatology", services: [
        { name: "استشارة جلدية", nameEn: "Dermatology consult", kind: "CONSULTATION", price: 25, cost: 0, dur: 20, color: "#10b981" },
        { name: "علاج حب الشباب", nameEn: "Acne treatment", kind: "MEDICAL", price: 60, cost: 10, dur: 30, color: "#34d399" },
      ] },
    ] },
    { name: "الجراحة التجميلية", nameEn: "Plastic surgery", services: [
      { name: "استشارة جراحة تجميلية", nameEn: "Plastic surgery consult", kind: "CONSULTATION", price: 40, cost: 0, dur: 30, color: "#be123c", staff: ["doctor"] },
      { name: "شفط دهون", nameEn: "Liposuction", kind: "SURGERY", price: 2500, cost: 900, dur: 180, color: "#9f1239", staff: ["doctor"] },
      { name: "تجميل الأنف", nameEn: "Rhinoplasty", kind: "SURGERY", price: 3000, cost: 1100, dur: 150, color: "#881337", staff: ["doctor"] },
      { name: "مراجعة ما بعد العملية", nameEn: "Post-op follow-up", kind: "FOLLOW_UP", price: 0, cost: 0, dur: 20, color: "#e11d48", staff: ["doctor"] },
    ] },
  ],
};

const ROOMS: Record<string, Record<string, [string, string][]>> = {
  "elite-beauty": { MAIN: [["غرفة ليزر 1", "LASER"], ["غرفة ليزر 2", "LASER"], ["غرفة الحقن", "TREATMENT"], ["غرفة الاستشارة", "CONSULTATION"]], ZAY: [["غرفة ليزر", "LASER"], ["غرفة العناية", "TREATMENT"]] },
  "smile-dental": { MAIN: [["كرسي 1", "DENTAL"], ["كرسي 2", "DENTAL"]] },
  "shifa-medical": { MAIN: [["عيادة 1", "CONSULTATION"], ["عيادة 2", "CONSULTATION"], ["صالة العمليات", "OPERATING"]], JAZ: [["عيادة الجزائر", "CONSULTATION"]], ZUB: [["عيادة الزبير", "CONSULTATION"]] },
};

const EXTRA_STAFF: Record<string, { email: string; name: string; role: string; job: string; branches: string[] }[]> = {
  "elite-beauty": [
    { email: "dr.rana@elite.test", name: "د. رنا الجبوري", role: "doctor", job: "طبيبة تجميل", branches: ["ZAY"] },
    { email: "laser@elite.test", name: "سارة محمود", role: "laser_technician", job: "أخصائية ليزر", branches: ["MAIN"] },
  ],
  "smile-dental": [{ email: "dr.ari@smile.test", name: "د. آري جمال", role: "doctor", job: "طبيب أسنان تجميلي", branches: ["MAIN"] }],
  "shifa-medical": [
    { email: "dr.ali@shifa.test", name: "د. علي الحلفي", role: "doctor", job: "باطنية", branches: ["MAIN", "ZUB"] },
    { email: "dr.hiba@shifa.test", name: "د. هبة الأسدي", role: "doctor", job: "جلدية", branches: ["JAZ"] },
  ],
};

const CLIENTS_PER: Record<string, number> = { "elite-beauty": 180, "smile-dental": 70, "shifa-medical": 120 };
const TZ_OFFSET_H = 3; // Asia/Baghdad

async function seedTenant(tx: Tx, slug: string, rand: () => number, pwHash: string) {
  const tenant = await tx.tenant.findUnique({ where: { slug } });
  if (!tenant) return;
  if (await tx.service.count({ where: { tenantId: tenant.id } })) return console.log(`  ${slug}: already has Phase 2 data, skipped`);
  const tenantId = tenant.id;
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const branches = await tx.branch.findMany({ where: { tenantId } });
  const byCode = Object.fromEntries(branches.map((b) => [b.code, b]));
  const roles = await tx.role.findMany({ where: { tenantId } });

  // practitioners
  for (const s of EXTRA_STAFF[slug] ?? []) {
    await tx.user.create({ data: {
      tenantId, email: s.email, fullName: s.name, jobTitle: s.job, passwordHash: pwHash, roleId: roles.find((r) => r.key === s.role)!.id,
      branchAccess: { create: s.branches.map((c) => ({ tenantId, branchId: byCode[c].id })) },
    } });
  }
  const practitioners = await tx.user.findMany({
    where: { tenantId, status: "ACTIVE", role: { key: { in: ["doctor", "nurse", "laser_technician"] } } },
    include: { role: true, branchAccess: true },
  });

  // service tree
  const services: { id: string; dur: number; price: number; staff: string[] | undefined; kind: string; name: string }[] = [];
  async function addCat(c: Cat, parentId: string | null, order: number) {
    const cat = await tx.serviceCategory.create({ data: { tenantId, parentId, name: c.name, nameEn: c.nameEn, sortOrder: order } });
    for (const s of c.services ?? []) {
      const svc = await tx.service.create({ data: {
        tenantId, categoryId: cat.id, name: s.name, nameEn: s.nameEn, kind: s.kind as never, price: s.price, cost: s.cost, durationMin: s.dur, color: s.color,
        execCommissionType: s.kind === "SURGERY" ? "PERCENT" : "PERCENT", execCommissionValue: s.kind === "SURGERY" ? 15 : 10,
        marketingCommissionType: "PERCENT", marketingCommissionValue: 5,
      } });
      const qualified = s.staff ? practitioners.filter((p) => s.staff!.includes(p.role!.key)) : [];
      if (qualified.length) await tx.serviceStaff.createMany({ data: qualified.map((p) => ({ tenantId, serviceId: svc.id, userId: p.id })) });
      services.push({ id: svc.id, dur: s.dur, price: s.price, staff: qualified.length ? qualified.map((p) => p.id) : undefined, kind: s.kind, name: s.name });
    }
    for (const [i, ch] of (c.children ?? []).entries()) await addCat(ch, cat.id, i);
  }
  for (const [i, c] of TREES[slug].entries()) await addCat(c, null, i);
  // Zayouna branch is 10% cheaper on laser
  if (byCode.ZAY) {
    const laser = services.filter((s) => s.kind === "LASER");
    await tx.serviceBranchPrice.createMany({ data: laser.map((s) => ({ tenantId, serviceId: s.id, branchId: byCode.ZAY.id, price: Math.round(s.price * 0.9) })) });
  }

  // rooms
  const rooms: Record<string, { id: string; kind: string }[]> = {};
  for (const [code, list] of Object.entries(ROOMS[slug] ?? {})) {
    rooms[byCode[code].id] = [];
    for (const [name, kind] of list) rooms[byCode[code].id].push(await tx.room.create({ data: { tenantId, branchId: byCode[code].id, name, kind } }));
  }

  // clients
  const now = Date.now();
  const female = slug === "elite-beauty" ? 0.85 : 0.55;
  const srcTotal = SOURCES.reduce((s, x) => s + x[1], 0);
  const pickSource = () => { let r = rand() * srcTotal; for (const [k, w] of SOURCES) if ((r -= w) < 0) return k; return "other"; };
  const clients: { id: string; branchId: string; createdAt: Date }[] = [];
  const usedPhones = new Set<string>();
  for (let i = 0; i < CLIENTS_PER[slug]; i++) {
    const isF = rand() < female;
    const name = `${pick(isF ? FEMALE : MALE)} ${pick(MALE)} ${pick(LAST)}`;
    let digits: string;
    do digits = `9647${pick(["7", "8", "5"])}${pick(["0", "1", "2", "3", "4", "5"])}${String(Math.floor(rand() * 1e7)).padStart(7, "0")}`; while (usedPhones.has(digits.slice(-9)));
    usedPhones.add(digits.slice(-9));
    const createdAt = new Date(now - Math.floor(rand() * 200) * 86400000 - Math.floor(rand() * 8) * 3600000);
    const branch = pick(branches);
    const lead = rand() < 0.12;
    const c = await tx.client.create({ data: {
      tenantId, code: `C-${String(i + 1).padStart(6, "0")}`, fullName: name, phone: `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`,
      phoneNormalized: digits, gender: isF ? "FEMALE" : "MALE",
      birthDate: new Date(Date.UTC(1965 + Math.floor(rand() * 40), Math.floor(rand() * 12), 1 + Math.floor(rand() * 28))),
      email: rand() < 0.4 ? `client${i + 1}@mail.test` : null, source: pickSource(), status: lead ? "LEAD" : "ACTIVE",
      category: rand() < 0.08 ? "VIP" : "REGULAR", tags: rand() < 0.35 ? [pick(TAGS)] : [], branchId: branch.id, createdAt,
      address: rand() < 0.5 ? pick(["بغداد - المنصور", "بغداد - الكرادة", "بغداد - زيونة", "أربيل - عينكاوة", "البصرة - العشار", "البصرة - الجزائر"]) : null,
    } });
    if (!lead) clients.push({ id: c.id, branchId: branch.id, createdAt });
  }
  await tx.tenantCounter.create({ data: { tenantId, key: "client", value: CLIENTS_PER[slug] } });

  // appointments: for each day & practitioner fill a few slots without overlap
  const appts: Prisma.AppointmentCreateManyInput[] = [];
  const lastVisit = new Map<string, Date>();
  const roomBusy = new Map<string, [number, number][]>();
  const todayLocal = new Date(now + TZ_OFFSET_H * 3600000); todayLocal.setUTCHours(0, 0, 0, 0);
  for (let day = -90; day <= 21; day++) {
    const d0 = new Date(+todayLocal + day * 86400000);
    if (d0.getUTCDay() === 5) continue; // Friday off
    for (const p of practitioners) {
      const pBranches = p.allBranches ? branches.map((b) => b.id) : p.branchAccess.map((b) => b.branchId);
      const branchId = pBranches[Math.abs(day) % pBranches.length];
      const svcFor = services.filter((s) => !s.staff || s.staff.includes(p.id));
      if (!svcFor.length) continue;
      let t = 10 * 60 + Math.floor(rand() * 4) * 15; // minutes since local midnight
      const busyness = day < 0 ? 0.55 : day === 0 ? 0.7 : Math.max(0.15, 0.6 - day * 0.03);
      while (t < 18 * 60) {
        const s = pick(svcFor);
        if (t + s.dur > 19 * 60) break;
        if (rand() < busyness) {
          const startsAt = new Date(+d0 + (t - TZ_OFFSET_H * 60) * 60000);
          const endsAt = new Date(+startsAt + s.dur * 60000);
          const pool = clients.filter((c) => c.createdAt < startsAt);
          if (pool.length) {
            const client = pick(pool);
            // room: first free room in branch
            let roomId: string | null = null;
            for (const r of rooms[branchId] ?? []) {
              const busy = roomBusy.get(r.id) ?? [];
              if (!busy.some(([a, b]) => a < +endsAt && b > +startsAt)) { roomId = r.id; busy.push([+startsAt, +endsAt]); roomBusy.set(r.id, busy); break; }
            }
            let status: AppointmentStatus;
            const r = rand();
            if (+endsAt < now) status = r < 0.78 ? "COMPLETED" : r < 0.9 ? "CANCELLED" : "NO_SHOW";
            else if (day === 0 && +startsAt < now) status = "CHECKED_IN";
            else status = r < 0.55 ? "CONFIRMED" : "SCHEDULED";
            appts.push({
              tenantId, branchId, clientId: client.id, serviceId: s.id, staffId: p.id, roomId, startsAt, endsAt, status,
              price: s.price * (branchId === byCode.ZAY?.id && s.kind === "LASER" ? 0.9 : 1),
              bookingSource: pick(["phone", "whatsapp", "walk_in", "instagram"]),
              completedAt: status === "COMPLETED" ? endsAt : null, cancelledAt: status === "CANCELLED" ? new Date(+startsAt - 86400000) : null,
              cancelReason: status === "CANCELLED" ? pick(["ظرف طارئ", "سفر", "طلب التأجيل", "مرض"]) : null,
              confirmedAt: status === "CONFIRMED" ? new Date(+startsAt - 2 * 86400000) : null,
              createdAt: new Date(Math.max(+client.createdAt, +startsAt - 7 * 86400000)),
            });
            if (status === "COMPLETED" && (!lastVisit.get(client.id) || lastVisit.get(client.id)! < startsAt)) lastVisit.set(client.id, startsAt);
          }
        }
        t += s.dur + (rand() < 0.5 ? 0 : 15);
      }
    }
  }
  for (let i = 0; i < appts.length; i += 1000) await tx.appointment.createMany({ data: appts.slice(i, i + 1000) });
  for (const [id, at] of lastVisit) await tx.client.update({ where: { id }, data: { lastVisitAt: at } });

  // interactions + medical
  const inter: Prisma.ClientInteractionCreateManyInput[] = [];
  const records: Prisma.MedicalRecordCreateManyInput[] = [];
  const entries: Prisma.MedicalEntryCreateManyInput[] = [];
  const doctor = practitioners.find((p) => p.role?.key === "doctor");
  for (const c of clients) {
    inter.push({ tenantId, clientId: c.id, type: "SYSTEM", content: "client.created", createdAt: c.createdAt });
    if (rand() < 0.3) inter.push({ tenantId, clientId: c.id, type: pick(["CALL", "WHATSAPP", "NOTE"]), content: pick(["تم التواصل لتأكيد الموعد", "استفسرت عن عروض الليزر", "تفضل المواعيد المسائية", "أرسلنا قائمة الأسعار عبر واتساب"]), createdAt: new Date(+c.createdAt + 86400000) });
    if (rand() < 0.45) {
      records.push({ tenantId, clientId: c.id, bloodType: pick(["A+", "B+", "O+", "AB+", "O-", "A-"]),
        allergies: rand() < 0.3 ? pick(["البنسلين", "الليدوكائين", "اللاتكس", "الأسبرين"]) : null,
        currentMedications: rand() < 0.3 ? pick(["ميتفورمين 500 ملغ", "حبوب منع الحمل", "إيزوتريتينوين 20 ملغ", "ثايروكسين 50 مكغ"]) : null,
        chronicConditions: rand() < 0.2 ? pick(["سكري النوع الثاني", "ضغط الدم", "قصور الغدة الدرقية", "تكيس المبايض"]) : null,
        medicalHistory: rand() < 0.3 ? "لا توجد عمليات سابقة" : null });
      if (doctor && rand() < 0.6) entries.push({ tenantId, clientId: c.id, authorId: doctor.id, type: pick(["DIAGNOSIS", "TREATMENT_PLAN", "NOTE"]),
        title: pick(["فرط تصبغ", "حب الشباب درجة 2", "خطة ليزر 6 جلسات", "شعر زائد هرموني", "تقييم أولي"]),
        content: pick(["يوصى بجلسات كل 4 أسابيع مع واقي شمس.", "تم شرح الخطة العلاجية والمضاعفات المحتملة ووافق المريض.", "تحسن ملحوظ بعد الجلسة الثالثة.", "المتابعة بعد أسبوعين."]),
        createdAt: new Date(+c.createdAt + 2 * 86400000) });
    }
  }
  await tx.clientInteraction.createMany({ data: inter });
  await tx.medicalRecord.createMany({ data: records });
  await tx.medicalEntry.createMany({ data: entries });
  // waitlist samples
  for (const c of clients.slice(0, 4)) {
    await tx.waitlistEntry.create({ data: { tenantId, branchId: c.branchId, clientId: c.id, serviceId: pick(services).id, preferredDate: new Date(+todayLocal + 3 * 86400000), preferredTime: "مساءً", notes: "يرغب بأقرب موعد متاح" } });
  }
  console.log(`  ${slug}: ${services.length} services, ${clients.length} clients, ${appts.length} appointments`);
}

export async function seedPhase2(tx: Tx, pwHash: string) {
  const rand = rng(20261110);
  for (const slug of Object.keys(TREES)) await seedTenant(tx, slug, rand, pwHash);
}

// Standalone run
if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-phase2.ts")) {
  (async () => {
    const hash = await hashPassword("Demo@12345");
    await withPlatform((tx) => seedPhase2(tx, hash));
    console.log("Phase 2 seed complete.");
  })().catch((e) => { console.error(e); process.exit(1); }).finally(disconnectAll);
}

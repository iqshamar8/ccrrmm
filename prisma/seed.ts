/**
 * Demo data: 3 plans, 1 platform owner, 4 tenants with branches and users in
 * every default role. Run after a reset:  npm run db:reset
 *
 * All demo accounts use the password in DEMO_PASSWORD (see docs/DEMO_ACCOUNTS.md).
 */
import "dotenv/config";
import { OPTIONAL_MODULES } from "../src/lib/permissions";
import { hashPassword } from "../src/server/auth";
import { disconnectAll, withPlatform } from "../src/server/db";
import { provisionTenant } from "../src/server/services/platform";
import { seedPhase2 } from "./seed-phase2";
import { seedPhase3 } from "./seed-phase3";
import { seedPhase4 } from "./seed-phase4";
import { seedPhase5 } from "./seed-phase5";
import { seedPhase6 } from "./seed-phase6";

export const DEMO_PASSWORD = "Demo@12345";

const PHASE_2_4 = ["clients", "medical", "appointments", "services", "programs", "subscriptions", "surgeries", "reviews",
  "invoices", "pos", "coupons", "loyalty", "hr", "commissions"];

async function main() {
  await withPlatform(async (tx) => {
    // ------------------------------------------------------------- plans --
    const starter = await tx.plan.create({ data: {
      code: "starter", nameAr: "الأساسية", nameEn: "Starter", description: "عيادة واحدة بفريق صغير",
      priceMonthly: 49, priceYearly: 490, trialDays: 14, maxUsers: 5, maxBranches: 1, storageMb: 2048, sortOrder: 1,
      features: ["clients", "medical", "appointments", "services", "invoices", "pos", "reports"],
    } });
    const pro = await tx.plan.create({ data: {
      code: "professional", nameAr: "الاحترافية", nameEn: "Professional", description: "مراكز متوسطة مع فروع متعددة",
      priceMonthly: 149, priceYearly: 1490, trialDays: 14, maxUsers: 25, maxBranches: 3, storageMb: 10240, sortOrder: 2,
      features: [...PHASE_2_4, "inventory", "reports", "notifications", "marketing"],
    } });
    const enterprise = await tx.plan.create({ data: {
      code: "enterprise", nameAr: "المؤسسات", nameEn: "Enterprise", description: "مستشفيات ومجمعات ومجموعات متعددة الفروع",
      priceMonthly: 449, priceYearly: 4490, trialDays: 30, maxUsers: 500, maxBranches: 50, storageMb: 102400, sortOrder: 3,
      features: [...OPTIONAL_MODULES],
    } });

    // ---------------------------------------------------- platform owner --
    await tx.user.create({ data: {
      email: "owner@medcrm.test", fullName: "مالك المنصة", isPlatformAdmin: true,
      passwordHash: await hashPassword(DEMO_PASSWORD), locale: "ar",
    } });

    // ----------------------------------------------------------- tenants --
    const pw = DEMO_PASSWORD;
    const elite = await provisionTenant(tx, {
      name: "عيادات النخبة للتجميل والليزر", slug: "elite-beauty", type: "BEAUTY_LASER_CENTER", planId: pro.id,
      startTrial: false, billingCycle: "YEARLY", baseCurrency: "IQD", contactEmail: "info@elite.test", contactPhone: "+964 770 000 1001",
      address: "بغداد - المنصور - شارع 14 رمضان", mainBranchName: "فرع المنصور",
      admin: { fullName: "د. سارة الكبيسي", email: "admin@elite.test", password: pw },
    }, null);
    const smile = await provisionTenant(tx, {
      name: "مركز ابتسامة لطب الأسنان", slug: "smile-dental", type: "DENTAL_CENTER", planId: starter.id,
      startTrial: true, baseCurrency: "IQD", contactEmail: "hello@smile.test", contactPhone: "+964 750 000 2002",
      address: "أربيل - شارع 100", mainBranchName: "الفرع الرئيسي",
      admin: { fullName: "د. كاوه أحمد", email: "admin@smile.test", password: pw },
    }, null);
    const shifa = await provisionTenant(tx, {
      name: "مجمع الشفاء الطبي", slug: "shifa-medical", type: "HOSPITAL", planId: enterprise.id,
      startTrial: false, billingCycle: "MONTHLY", baseCurrency: "USD", contactEmail: "contact@shifa.test",
      address: "البصرة - العشار", mainBranchName: "المجمع الرئيسي",
      admin: { fullName: "أ. محمد الساعدي", email: "admin@shifa.test", password: pw },
    }, null);
    const glow = await provisionTenant(tx, {
      name: "مركز جلو للجلدية", slug: "glow-derma", type: "DERMATOLOGY_CENTER", planId: starter.id,
      startTrial: true, contactEmail: "glow@glow.test", mainBranchName: "الفرع الرئيسي",
      admin: { fullName: "د. ليلى حسن", email: "admin@glow.test", password: pw },
    }, null);
    await tx.tenant.update({ where: { id: glow.id }, data: { status: "SUSPENDED" } });

    // ------------------------------------- extra branches & role accounts --
    const hash = await hashPassword(pw);
    async function staff(tenantId: string, list: { email: string; name: string; role: string; job: string; branches: string[]; all?: boolean }[]) {
      const roles = await tx.role.findMany({ where: { tenantId } });
      for (const s of list) {
        await tx.user.create({ data: {
          tenantId, email: s.email, fullName: s.name, jobTitle: s.job, passwordHash: hash,
          roleId: roles.find((r) => r.key === s.role)!.id, allBranches: !!s.all,
          branchAccess: { create: s.branches.map((branchId) => ({ tenantId, branchId })) },
        } });
      }
    }

    const eliteMain = await tx.branch.findFirstOrThrow({ where: { tenantId: elite.id, isMain: true } });
    const eliteZayouna = await tx.branch.create({ data: { tenantId: elite.id, name: "فرع زيونة", code: "ZAY", phone: "+964 770 000 1002", address: "بغداد - زيونة" } });
    await staff(elite.id, [
      { email: "manager@elite.test", name: "علي حسين", role: "branch_manager", job: "مدير فرع زيونة", branches: [eliteZayouna.id] },
      { email: "accountant@elite.test", name: "زينب كريم", role: "accountant", job: "محاسبة", branches: [eliteMain.id, eliteZayouna.id], all: true },
      { email: "reception@elite.test", name: "مريم جاسم", role: "receptionist", job: "استقبال", branches: [eliteMain.id] },
      { email: "doctor@elite.test", name: "د. أحمد العبيدي", role: "doctor", job: "طبيب جلدية وليزر", branches: [eliteMain.id, eliteZayouna.id] },
      { email: "nurse@elite.test", name: "نور الهدى", role: "nurse", job: "ممرضة", branches: [eliteMain.id] },
      { email: "sales@elite.test", name: "حسن فاضل", role: "sales", job: "مبيعات", branches: [eliteMain.id] },
      { email: "stock@elite.test", name: "عمر سالم", role: "inventory_manager", job: "أمين مخزن", branches: [eliteMain.id] },
      { email: "hr@elite.test", name: "رنا طارق", role: "hr_manager", job: "موارد بشرية", branches: [eliteMain.id], all: true },
      { email: "marketing@elite.test", name: "يوسف ماجد", role: "marketing", job: "تسويق رقمي", branches: [eliteMain.id], all: true },
    ]);

    const smileMain = await tx.branch.findFirstOrThrow({ where: { tenantId: smile.id, isMain: true } });
    await staff(smile.id, [
      { email: "reception@smile.test", name: "شيلان عمر", role: "receptionist", job: "استقبال", branches: [smileMain.id] },
      { email: "doctor@smile.test", name: "د. هيمن رشيد", role: "doctor", job: "طبيب أسنان", branches: [smileMain.id] },
    ]);

    const shifaMain = await tx.branch.findFirstOrThrow({ where: { tenantId: shifa.id, isMain: true } });
    const shifaB = await tx.branch.create({ data: { tenantId: shifa.id, name: "عيادات الجزائر", code: "JAZ", address: "البصرة - الجزائر" } });
    const shifaC = await tx.branch.create({ data: { tenantId: shifa.id, name: "عيادات الزبير", code: "ZUB", address: "البصرة - الزبير" } });
    await staff(shifa.id, [
      { email: "manager@shifa.test", name: "كرار عبد الله", role: "branch_manager", job: "مدير عيادات الجزائر", branches: [shifaB.id] },
      { email: "doctor@shifa.test", name: "د. فاطمة الموسوي", role: "doctor", job: "جراحة تجميلية", branches: [shifaMain.id, shifaC.id] },
      { email: "reception@shifa.test", name: "حيدر ناصر", role: "receptionist", job: "استقبال", branches: [shifaMain.id] },
    ]);

    // A custom role example
    await tx.role.create({ data: {
      tenantId: elite.id, key: "laser_technician", name: "Laser technician", nameAr: "أخصائي ليزر",
      description: "دور مخصص: مشاهدة العملاء والمواعيد وتحديث الملف الطبي", isSystem: false,
      permissions: ["dashboard.view", "clients.view", "appointments.view", "appointments.update", "medical.view", "medical.update", "medical.view_data"],
    } });

    // Phase 2: services, rooms, clients, appointments, medical records
    await seedPhase2(tx, hash);
    // Phase 3: programs, client subscriptions, surgeries, reviews
    await seedPhase3(tx);
  }, { timeout: 300000 });

  // Phase 4 runs through the real billing/HR services (their own transactions).
  await seedPhase4();
  // Phase 5: ledger backfill, inventory, accounting, corporate contracts.
  await seedPhase5();
  // Phase 6: messaging history, influencers, segments, offers, campaigns.
  await seedPhase6();

  console.log("Seed complete. Demo password for all accounts:", DEMO_PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(disconnectAll);

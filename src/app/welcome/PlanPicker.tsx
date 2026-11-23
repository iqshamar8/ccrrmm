"use client";
import { useMemo, useState } from "react";
import { type Locale, makeTr } from "@/lib/i18n";

/** Plans as seeded in prisma/seed.ts (prices in USD). Keep in sync if plans change. */
type Plan = {
  code: "starter" | "professional" | "enterprise";
  ar: string; en: string; forAr: string; forEn: string;
  monthly: number; yearly: number; trialDays: number;
  users: number; branches: number; storageGb: number;
  needs: Need[]; // optional sections this plan includes
  pointsAr: string[]; pointsEn: string[];
};
type Need = "treatment" | "stock" | "hr" | "marketing" | "accounting" | "corporate";

const PLANS: Plan[] = [
  { code: "starter", ar: "الأساسية", en: "Starter", forAr: "عيادة واحدة بفريق صغير", forEn: "One clinic, a small team",
    monthly: 49, yearly: 490, trialDays: 14, users: 5, branches: 1, storageGb: 2, needs: [],
    pointsAr: ["العملاء والملف الطبي", "المواعيد والخدمات", "الفواتير ونقطة البيع", "التقارير"],
    pointsEn: ["Clients & medical records", "Appointments & services", "Invoices & point of sale", "Reports"] },
  { code: "professional", ar: "الاحترافية", en: "Professional", forAr: "مراكز متوسطة مع فروع متعددة", forEn: "Mid-size centres, several branches",
    monthly: 149, yearly: 1490, trialDays: 14, users: 25, branches: 3, storageGb: 10, needs: ["treatment", "stock", "hr", "marketing"],
    pointsAr: ["كل ما في الأساسية", "البرامج العلاجية والعمليات والمراجعات", "المخازن والموارد البشرية والعمولات", "التسويق والكوبونات والولاء"],
    pointsEn: ["Everything in Starter", "Treatment programs, surgeries, follow-ups", "Inventory, HR and commissions", "Marketing, coupons and loyalty"] },
  { code: "enterprise", ar: "المؤسسات", en: "Enterprise", forAr: "مستشفيات ومجمعات ومجموعات", forEn: "Hospitals, complexes and groups",
    monthly: 449, yearly: 4490, trialDays: 30, users: 500, branches: 50, storageGb: 100, needs: ["treatment", "stock", "hr", "marketing", "accounting", "corporate"],
    pointsAr: ["كل ما في الاحترافية", "محاسبة بقيد مزدوج وقوائم مالية", "عقود الشركات وخصوماتها", "حتى 50 فرعاً و500 مستخدم"],
    pointsEn: ["Everything in Professional", "Double-entry accounting & statements", "Corporate contracts & discounts", "Up to 50 branches and 500 users"] },
];

const NEEDS: { key: Need; ar: string; en: string }[] = [
  { key: "treatment", ar: "برامج علاجية وعمليات", en: "Treatment programs & surgeries" },
  { key: "stock", ar: "مخازن ومواد", en: "Inventory & materials" },
  { key: "hr", ar: "موظفون ورواتب", en: "Staff & payroll" },
  { key: "marketing", ar: "حملات وتسويق", en: "Campaigns & marketing" },
  { key: "accounting", ar: "محاسبة كاملة", en: "Full accounting" },
  { key: "corporate", ar: "عقود شركات", en: "Corporate contracts" },
];

const DEMO_MAIL = "mailto:?subject=" + encodeURIComponent("MedCRM، طلب عرض تجريبي / Demo request");

export function PlanPicker({ locale }: { locale: Locale }) {
  const tr = makeTr(locale);
  const [branches, setBranches] = useState(1);
  const [users, setUsers] = useState(5);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [yearly, setYearly] = useState(false);

  const fit = useMemo(
    () => PLANS.find((p) => p.branches >= branches && p.users >= users && needs.every((n) => p.needs.includes(n))) ?? PLANS[2],
    [branches, users, needs],
  );
  const num = (n: number) => new Intl.NumberFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-US").format(n);
  const toggle = (n: Need) => setNeeds((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));

  return (
    <div className="price">
      <form className="pick lp-reveal" onSubmit={(e) => e.preventDefault()} aria-label={tr("اختر خطتك", "Find your plan")}>
        <h3>{tr("ما حجم مؤسستك؟", "How big is your practice?")}</h3>
        <label>
          <span className="pick__val"><span>{tr("الفروع", "Branches")}</span><output>{num(branches)}</output></span>
          <input type="range" min={1} max={50} value={branches} onChange={(e) => setBranches(Number(e.target.value))} />
        </label>
        <label>
          <span className="pick__val"><span>{tr("المستخدمون", "Staff accounts")}</span><output>{num(users)}</output></span>
          <input type="range" min={1} max={500} value={users} onChange={(e) => setUsers(Number(e.target.value))} />
        </label>
        <fieldset className="pick__mods" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 17, marginBottom: 10 }}>{tr("تحتاج أيضاً", "You also need")}</legend>
          {NEEDS.map((n) => (
            <label key={n.key}>
              <input type="checkbox" checked={needs.includes(n.key)} onChange={() => toggle(n.key)} />
              {tr(n.ar, n.en)}
            </label>
          ))}
        </fieldset>
        <div className="pick__seg" role="group" aria-label={tr("طريقة الدفع", "Billing")}>
          <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>{tr("شهري", "Monthly")}</button>
          <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>{tr("سنوي، شهران مجاناً", "Yearly, 2 months free")}</button>
        </div>
      </form>

      <div className="plans" aria-live="polite">
        {PLANS.map((p, i) => {
          const isFit = p.code === fit.code;
          return (
            <article key={p.code} className={`plan lp-reveal lp-reveal--${Math.min(i + 1, 3)}`} data-fit={isFit}>
              {isFit && <span className="plan__fit">{tr("تناسبك", "Your fit")}</span>}
              <h3>{tr(`${p.ar}: ${p.forAr}`, `${p.en}: ${p.forEn}`)}</h3>
              <p className="plan__price tabular">
                ${num(yearly ? p.yearly : p.monthly)}{" "}
                <small>{yearly ? tr("/ سنة", "/ year") : tr("/ شهر", "/ month")}</small>
              </p>
              <ul>
                {(locale === "ar" ? p.pointsAr : p.pointsEn).map((x) => <li key={x}>{x}</li>)}
                <li>{tr(`${num(p.users)} مستخدم · ${num(p.branches)} ${p.branches === 1 ? "فرع" : "فروع"} · ${num(p.storageGb)} GB`,
                  `${num(p.users)} users · ${num(p.branches)} ${p.branches === 1 ? "branch" : "branches"} · ${num(p.storageGb)} GB`)}</li>
                <li>{tr(`تجربة مجانية ${num(p.trialDays)} يوماً`, `${num(p.trialDays)}-day free trial`)}</li>
              </ul>
              <a className={`lp-btn ${isFit ? "lp-btn--lime" : "lp-btn--line"}`} href={DEMO_MAIL}>
                {tr("ابدأ التجربة", "Start the trial")}
              </a>
            </article>
          );
        })}
      </div>
    </div>
  );
}

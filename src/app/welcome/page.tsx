import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { isLocale, makeTr, type Locale } from "@/lib/i18n";
import { Effects, LangToggle } from "./Effects";
import { PlanPicker } from "./PlanPicker";
import { ClientFile, DayCalendar, Invoice, Today } from "./fragments";
import "./landing.css";

export const metadata: Metadata = {
  title: "MedCRM | نظام إدارة العيادات والمراكز الطبية",
  description: "مواعيد، ملفات طبية، فواتير، مخزون وتذكيرات واتساب في نظام واحد لعيادات التجميل والأسنان والجلدية والمجمعات الطبية.",
};

// Until a real inbox exists, "request a demo" opens the visitor's mail app.
const DEMO_MAIL = "mailto:?subject=" + encodeURIComponent("MedCRM، طلب عرض تجريبي / Demo request");

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
);

export default async function Landing() {
  const l = (await cookies()).get("locale")?.value;
  const locale: Locale = isLocale(l) ? l : "ar";
  const tr = makeTr(locale);

  return (
    <div className="lp" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
      <Effects />
      <div className="lp-lights" aria-hidden="true">
        <div className="lp-beam" />
        <div className="lp-light lp-light--a" />
        <div className="lp-light lp-light--b" />
        <div className="lp-light lp-light--c" />
        <div className="lp-light lp-light--lime" />
        <div className="lp-spot" />
        <div className="lp-grain" />
      </div>

      {/* ------------------------------------------------------------- nav */}
      <header className="lp-nav lp-wrap">
        <div className="lp-nav__bar">
          <Link href="/" className="lp-brand" aria-label="MedCRM">
            <span className="lp-brand__mark" aria-hidden="true">M</span>MedCRM
          </Link>
          <nav className="lp-nav__links" aria-label={tr("أقسام الصفحة", "Page sections")}>
            <a href="#flow">{tr("كيف يعمل", "How it works")}</a>
            <a href="#whatsapp">{tr("واتساب", "WhatsApp")}</a>
            <a href="#security">{tr("الأمان", "Security")}</a>
            <a href="#pricing">{tr("الأسعار", "Pricing")}</a>
          </nav>
          <div className="lp-nav__end">
            <LangToggle locale={locale} />
            <Link href="/login" className="lp-btn lp-btn--lime lp-btn--sm">{tr("تسجيل الدخول", "Sign in")}<Arrow /></Link>
          </div>
        </div>
      </header>

      <main>
        {/* ------------------------------------------------------------- hero */}
        <section className="lp-hero lp-wrap" aria-labelledby="hero-title">
          <h1 id="hero-title" className="lp-rise lp-rise--1">{tr("عيادتك كلها في شاشة واحدة", "Your whole clinic, one screen")}</h1>
          <p className="lp-hero__sub lp-rise lp-rise--3">
            {tr("مواعيد، ملفات طبية، فواتير، مخزون وتذكيرات واتساب في نظام واحد لعيادات التجميل والأسنان والجلدية والمجمعات الطبية، بالعربية أولاً.",
              "Appointments, medical records, invoices, stock and WhatsApp reminders in one system for aesthetic, dental, dermatology and multi-branch clinics, Arabic first.")}
          </p>
          <div className="lp-hero__actions lp-rise lp-rise--4">
            <a href="#pricing" className="lp-btn lp-btn--line">{tr("شاهد الخطط والأسعار", "See plans & pricing")}</a>
            <a href={DEMO_MAIL} className="lp-btn lp-btn--lime">{tr("اطلب عرضاً تجريبياً", "Book a live demo")}<Arrow /></a>
          </div>
          <p className="lp-hero__trial lp-rise lp-rise--4" style={{ marginTop: 22 }}><span className="lp-hero__dot" aria-hidden="true" />
            {tr("تجربة مجانية كاملة لمدة", "A full free trial for")} <b>{tr("14 يوماً", "14 days")}</b>
          </p>

          <div className="lp-shots">
            <figure className="lp-shot lp-rise lp-rise--5" data-ui><DayCalendar tr={tr} />
              <figcaption className="lp-shot__cap">{tr("تقويم الأطباء، الحجز المزدوج ممنوع تلقائياً", "Doctors' calendar, double booking is blocked")}</figcaption></figure>
            <figure className="lp-shot lp-rise lp-rise--6" data-ui><Invoice tr={tr} />
              <figcaption className="lp-shot__cap">{tr("فاتورة بأقساط ودفعة جزئية", "An invoice with an instalment plan")}</figcaption></figure>
            <figure className="lp-shot lp-shot--tall lp-rise lp-rise--7" data-ui><Today tr={tr} /></figure>
          </div>
        </section>

        {/* ------------------------------------------------------------- flow */}
        <section id="flow" className="lp-section lp-wrap" aria-labelledby="flow-title">
          <h2 id="flow-title" className="lp-h2 lp-reveal">{tr("من الحجز حتى آخر دفعة", "From the booking to the last payment")}</h2>
          <p className="lp-lead lp-reveal lp-reveal--2">
            {tr("كل زيارة تمر بالخطوات نفسها، ويكمل النظام ما بعدها وحده: الجلسة تُخصم من البرنامج، والمواد من المخزن، والقيد يُسجَّل في الحسابات.",
              "Every visit follows the same steps, and the system finishes the rest by itself: the session comes off the program, the materials off the stock, the entry into the books.")}
          </p>
          <div className="flow">
            <ol className="flow__list">
              {[
                [tr("الحجز", "Booking"), tr("تقويم يومي وأسبوعي لكل طبيب وكل غرفة، حجز متكرر وقائمة انتظار. قاعدة البيانات نفسها تمنع حجز الطبيب أو الغرفة مرتين.", "Day and week calendars per doctor and per room, recurring bookings and a waitlist. The database itself refuses a doctor or room booked twice.")],
                [tr("الزيارة", "The visit"), tr("تأكيد ثم حضور ثم إنهاء. الملف الطبي: الحساسية، الأدوية، التشخيص، وصور قبل وبعد، وكل اطلاع عليه يُسجَّل.", "Confirm, check in, complete. The medical record holds allergies, medication, diagnoses and before/after photos, and every look at it is logged.")],
                [tr("البرنامج العلاجي", "The treatment program"), tr("باقات جلسات بصلاحية وتباعد، تُخصم الجلسة عند إنهاء الزيارة، مع تجميد وتجديد وتنبيه للبرامج المتوقفة.", "Session packages with validity and spacing; a session is used when the visit completes, with freeze, renewal and a list of stalled programs.")],
                [tr("الفاتورة", "The invoice"), tr("فاتورة بضغطة واحدة من الزيارة أو البرنامج أو العملية، دفعات جزئية وأقساط واسترداد، وكوبونات ونقاط ولاء وخصومات الشركات.", "One-click invoices from a visit, program or surgery; partial payments, instalments and refunds; coupons, loyalty points and corporate discounts.")],
                [tr("ما بعد الزيارة", "After the visit"), tr("تذكير بالموعد القادم، متابعة بعد الجلسة، وتنبيه بالمراجعات الطبية المتأخرة، للمريض على واتساب وللفريق في صندوق الإشعارات.", "A reminder for the next visit, a follow-up after the session and alerts for overdue medical reviews, to the patient on WhatsApp, to the team in their inbox.")],
              ].map(([h, p], i) => (
                <li key={h} className={`flow__item lp-reveal${i ? ` lp-reveal--${Math.min(i, 3)}` : ""}`} data-active={i === 2 ? "true" : undefined}>
                  <h3>{h}</h3><p>{p}</p>
                </li>
              ))}
            </ol>
            <div className="flow__screen">
              <figure className="lp-shot" data-ui><ClientFile tr={tr} />
                <figcaption className="lp-shot__cap">{tr("ملف المريض: البرنامج يتقدّم مع كل جلسة", "The patient file: the program moves with every session")}</figcaption></figure>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- whatsapp */}
        <section id="whatsapp" className="lp-section lp-wrap" aria-labelledby="wa-title">
          <div className="wa">
            <div className="wa__phone lp-reveal" data-ui aria-label={tr("مثال محادثة تذكير على واتساب", "Example WhatsApp reminder conversation")} role="img">
              <div className="wa__screen">
                <div className="wa__top"><span aria-hidden="true">ع</span><div><b>{tr("عيادات النخبة", "Elite Clinics")}</b><div style={{ fontSize: 12, opacity: 0.8 }}>{tr("حساب أعمال", "Business account")}</div></div></div>
                <div className="wa__msgs" dir={locale === "ar" ? "rtl" : "ltr"}>
                  <div className="wa__msg wa__msg--out">{tr("مرحباً نور، نذكّرك بموعد جلسة الليزر غداً الساعة 4:30 مساءً مع د. سارة، فرع زيونة. للتأكيد اكتب 1، للتأجيل اكتب 2.", "Hi Noor, a reminder of your laser session tomorrow at 4:30 pm with Dr. Sara, Zayouna branch. Reply 1 to confirm, 2 to reschedule.")}<time>10:02<span className="wa__ticks" aria-label="read"><svg viewBox="0 0 18 12" width="16" height="11" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 6.5 4.5 10 11 2M7 9.5 7.5 10 14 2"/></svg></span></time></div>
                  <div className="wa__msg">1<time>10:09</time></div>
                  <div className="wa__msg wa__msg--out">{tr("تم التأكيد. نراك غداً. متبقٍّ في برنامجك 3 جلسات من 6.", "Confirmed. See you tomorrow, 3 of your 6 program sessions left.")}<time>10:09<span className="wa__ticks" aria-label="read"><svg viewBox="0 0 18 12" width="16" height="11" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 6.5 4.5 10 11 2M7 9.5 7.5 10 14 2"/></svg></span></time></div>
                </div>
              </div>
            </div>
            <div>
              <h2 id="wa-title" className="lp-h2 lp-reveal">{tr("التذكير يصل المريض وحده", "Reminders reach the patient on their own")}</h2>
              <p className="lp-lead lp-reveal lp-reveal--2">{tr("ربط رسمي بواتساب للأعمال من Meta، بقوالب معتمدة يكتبها فريقك مرة واحدة.", "An official WhatsApp Business connection from Meta, with approved templates your team writes once.")}</p>
              <ul className="wa__list lp-reveal lp-reveal--3">
                <li><span><b>{tr("تأكيد الحجز وتذكير الموعد", "Booking confirmations and reminders")}</b>: {tr("بتوقيت تحدده، وخارج ساعات الهدوء.", "at the times you set, never in quiet hours.")}</span></li>
                <li><span><b>{tr("لا تذكير لموعد أُلغي", "No reminder for a cancelled visit")}</b>: {tr("كل رسالة يُتحقق منها قبل الإرسال.", "every message is re-checked before it goes.")}</span></li>
                <li><span><b>{tr("حالة كل رسالة", "Every message tracked")}</b>: {tr("أُرسلت، وصلت، قُرئت أو فشلت، مع إعادة المحاولة.", "sent, delivered, read or failed, with retry.")}</span></li>
                <li><span><b>{tr("أعياد الميلاد والمتابعات والعروض", "Birthdays, follow-ups and offers")}</b>: {tr("ومن يكتب «STOP» يخرج من الرسائل التسويقية فوراً.", "and anyone who replies STOP leaves marketing at once.")}</span></li>
              </ul>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- security */}
        <section id="security" className="lp-section lp-wrap" aria-labelledby="sec-title" style={{ paddingTop: 0 }}>
          <div className="sec">
            <h2 id="sec-title" className="lp-h2 lp-reveal">{tr("بيانات كل عيادة معزولة فعلاً", "Every clinic's data, truly walled off")}</h2>
            <p className="lp-lead lp-reveal lp-reveal--2">{tr("العزل لا يعتمد على الكود وحده: قاعدة البيانات نفسها ترفض أن ترى عيادةٌ بيانات غيرها.", "Isolation doesn't rest on code alone: the database itself refuses to show one clinic another's data.")}</p>
            <div className="sec__grid">
              {[
                [tr("عزل على مستوى قاعدة البيانات", "Isolation in the database"), tr("سياسات أمان على كل صف في PostgreSQL، وصلاحيات قاعدة بيانات منفصلة للعيادات ولإدارة المنصة.", "Row-level security on every PostgreSQL table, with separate database roles for clinics and for platform admin.")],
                [tr("صلاحيات لكل دور وكل فرع", "Permissions per role and branch"), tr("عشرة أدوار جاهزة، ومصفوفة عرض وإضافة وتعديل وحذف واعتماد وطباعة وتصدير، وحصر الموظف بفروعه.", "Ten ready roles, a view/create/edit/delete/approve/print/export matrix, and staff limited to their own branches.")],
                [tr("سجل لكل عملية", "A log of every action"), tr("من أنشأ ومن عدّل ومن اطّلع على ملف طبي ومتى، دون نسخ المحتوى الطبي نفسه إلى السجل.", "Who created, who changed, who opened a medical record and when, without copying medical content into the log.")],
                [tr("دخول محمي", "Protected sign-in"), tr("تحقق بخطوتين، قفل بعد محاولات فاشلة، وإنهاء كل الجلسات بضغطة. مفاتيح واتساب مشفّرة بـ AES-256.", "Two-step verification, lockout after failed attempts and signing out every session at once. WhatsApp keys encrypted with AES-256.")],
              ].map(([h, p], i) => (
                <div key={h} className={`sec__item lp-reveal${i % 2 ? " lp-reveal--2" : ""}`}><h3>{h}</h3><p>{p}</p></div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- modules */}
        <section id="modules" className="lp-section lp-wrap" aria-labelledby="mods-title" style={{ paddingTop: 0 }}>
          <h2 id="mods-title" className="lp-h2 lp-reveal">{tr("كل أقسام العيادة في اشتراك واحد", "Every part of the clinic, one subscription")}</h2>
          <div className="mods">
            {[
              [tr("المرضى", "Patients"), [tr("العملاء والعملاء المحتملون", "Clients & leads"), tr("الملف الطبي", "Medical records"), tr("المواعيد وقائمة الانتظار", "Appointments & waitlist"), tr("المراجعات الطبية", "Medical follow-ups")]],
              [tr("العلاج", "Treatment"), [tr("الخدمات وتسعيرها حسب الفرع", "Services, priced per branch"), tr("البرامج العلاجية", "Treatment programs"), tr("اشتراكات العملاء", "Client memberships"), tr("العمليات الجراحية", "Surgeries")]],
              [tr("المبيعات", "Sales"), [tr("الفواتير والأقساط", "Invoices & instalments"), tr("نقطة البيع", "Point of sale"), tr("الكوبونات ونقاط الولاء", "Coupons & loyalty"), tr("عقود الشركات", "Corporate contracts")]],
              [tr("الفريق", "Team"), [tr("الحضور والورديات", "Attendance & shifts"), tr("الإجازات والسلف", "Leave & advances"), tr("الرواتب الشهرية", "Monthly payroll"), tr("العمولات والأداء", "Commissions & performance")]],
              [tr("المال والمخزون", "Money & stock"), [tr("مخازن بتواريخ صلاحية", "Stock with expiry dates"), tr("أوامر الشراء والجرد", "Purchase orders & counts"), tr("محاسبة بقيد مزدوج", "Double-entry accounting"), tr("الأرباح والميزانية والتدفق", "P&L, balance sheet, cash flow")]],
              [tr("النمو", "Growth"), [tr("الحملات والشرائح", "Campaigns & segments"), tr("المؤثرون وعمولاتهم", "Influencers & their commissions"), tr("قوائم المتابعة", "Follow-up worklists"), tr("25 تقريراً مع تصدير Excel", "25 reports with Excel export")]],
            ].map(([g, items], i) => (
              <div key={g as string} className={`mods__group lp-reveal lp-reveal--${(i % 3) + 1}`}>
                <h3>{g as string}</h3>
                <ul>{(items as string[]).map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------------- pricing */}
        <section id="pricing" className="lp-section lp-wrap" aria-labelledby="price-title" style={{ paddingTop: 0 }}>
          <h2 id="price-title" className="lp-h2 lp-reveal">{tr("خطة تناسب حجم مؤسستك", "A plan sized to your practice")}</h2>
          <p className="lp-lead lp-reveal lp-reveal--2">{tr("حرّك المؤشرات واختر ما تحتاجه، وتظهر الخطة المناسبة وسعرها. الأسعار بالدولار الأمريكي.", "Move the sliders and tick what you need; the fitting plan lights up with its price. Prices in US dollars.")}</p>
          <PlanPicker locale={locale} />
        </section>

        {/* ------------------------------------------------------------- close */}
        <section className="close lp-wrap" aria-labelledby="close-title">
          <h2 id="close-title" className="lp-h2 lp-reveal">{tr("جاهز تنقل عيادتك؟", "Ready to move your clinic over?")}</h2>
          <p className="lp-lead lp-reveal lp-reveal--2">{tr("نجهّز مؤسستك وفروعها وأدوار فريقك، وتبدأ بتجربة مجانية كاملة.", "We set up your organisation, branches and team roles, and you start with a full free trial.")}</p>
          <div className="lp-hero__actions lp-reveal lp-reveal--3">
            <Link href="/login" className="lp-btn lp-btn--line">{tr("لدي حساب، دخول", "I have an account")}</Link>
            <a href={DEMO_MAIL} className="lp-btn lp-btn--lime">{tr("اطلب عرضاً تجريبياً", "Book a live demo")}<Arrow /></a>
          </div>
          <p className="lp-word" aria-hidden="true" dir="ltr">MedCRM</p>
        </section>
      </main>

      <footer className="lp-wrap lp-foot">
        <span>© {new Date().getFullYear()} MedCRM</span>
        <nav aria-label={tr("روابط التذييل", "Footer links")}>
          <a href="#flow">{tr("كيف يعمل", "How it works")}</a>
          <a href="#security">{tr("الأمان", "Security")}</a>
          <a href="#pricing">{tr("الأسعار", "Pricing")}</a>
          <Link href="/login">{tr("تسجيل الدخول", "Sign in")}</Link>
        </nav>
      </footer>
    </div>
  );
}

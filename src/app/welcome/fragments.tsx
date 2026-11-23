import type { makeTr } from "@/lib/i18n";

/* ===================================================================== */
/* App fragments: small, real-looking pieces of MedCRM drawn in HTML.     */
/* Sample data only; it adds up.                                          */
/* ===================================================================== */
export type Tr = ReturnType<typeof makeTr>;

export function DayCalendar({ tr }: { tr: Tr }) {
  // 6 rows of 44px = 10:00 → 16:00; top = (hour - 10) * 44
  const ev = (top: number, h: number, cls: string, name: string, svc: string) => (
    <div className={`cal__ev cal__ev--${cls}`} style={{ top, height: h }}><b>{name}</b>{svc}</div>
  );
  return (
    <div className="ui">
      <div className="ui__head">
        <span className="ui__title">{tr("مواعيد اليوم", "Today's appointments")}</span>
        <span className="ui__chip ui__chip--ok">{tr("14 موعداً · 3 حضروا", "14 booked · 3 checked in")}</span>
      </div>
      <div className="ui__body">
        <div className="cal">
          <span />
          <span className="cal__h">{tr("د. سارة الكبيسي", "Dr. Sara Al-Kubaisi")}</span>
          <span className="cal__h">{tr("د. علي حسن", "Dr. Ali Hassan")}</span>
          <div>{["10:00", "11:00", "12:00", "1:00", "2:00", "3:00"].map((t) => <div key={t} className="cal__t">{t}</div>)}</div>
          <div className="cal__col">
            {ev(0, 40, "a", tr("نور محمد", "Noor M."), tr("ليزر إزالة شعر", "Laser hair removal"))}
            {ev(66, 62, "b", tr("رنا جاسم", "Rana J."), tr("فيلر شفاه", "Lip filler"))}
            {ev(176, 40, "c", tr("هبة علي", "Hiba A."), tr("تنظيف بشرة", "Facial"))}
          </div>
          <div className="cal__col">
            {ev(22, 62, "d", tr("أحمد كريم", "Ahmed K."), tr("زراعة شعر، استشارة", "Hair transplant consult"))}
            {ev(132, 40, "a", tr("زينب حيدر", "Zainab H."), tr("بوتوكس", "Botox"))}
            {ev(198, 62, "b", tr("مريم سعد", "Maryam S."), tr("جلسة بلازما", "PRP session"))}
          </div>
          <div className="cal__now" style={{ top: 128 }} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export function Invoice({ tr }: { tr: Tr }) {
  return (
    <div className="ui">
      <div className="ui__head">
        <span className="ui__title" dir="ltr">INV-2026-00184</span>
        <span className="ui__chip ui__chip--warn">{tr("مدفوعة جزئياً", "Partly paid")}</span>
      </div>
      <div className="ui__body inv">
        <div className="inv__row"><span><b>{tr("رنا جاسم", "Rana Jassim")}</b><br /><span className="ui__muted">{tr("فرع زيونة · 23 تشرين الثاني", "Zayouna · 23 Nov")}</span></span><span className="ui__chip">{tr("كوبون RANA10", "Coupon RANA10")}</span></div>
        <div>
          <div className="inv__line"><span>{tr("برنامج ليزر، 6 جلسات", "Laser program, 6 sessions")}</span><b className="tabular">$540</b><span className="ui__muted">{tr("6 × 90", "6 × 90")}</span></div>
          <div className="inv__line"><span>{tr("فيلر شفاه 1 مل", "Lip filler 1 ml")}</span><b className="tabular">$260</b></div>
          <div className="inv__line"><span>{tr("خصم الكوبون 10%", "Coupon 10% off")}</span><b className="tabular">−$80</b></div>
        </div>
        <div className="inv__total"><span>{tr("الإجمالي", "Total")}</span><span className="tabular">$720</span></div>
        <div className="inv__row ui__muted"><span>{tr("مدفوع $480 · متبقٍّ $240", "Paid $480 · due $240")}</span><span>{tr("قسطان", "2 instalments")}</span></div>
        <div className="inv__bar" aria-hidden="true"><span style={{ width: "66.7%" }} /></div>
        <div className="inv__row"><span className="ui__muted">{tr("القسط القادم 10 كانون الأول", "Next instalment 10 Dec")}</span><span className="ui__chip ui__chip--lime">{tr("+72 نقطة ولاء", "+72 loyalty points")}</span></div>
      </div>
    </div>
  );
}

export function Today({ tr }: { tr: Tr }) {
  // 7 days of collected revenue, scaled into a 0..80 tall sparkline
  const v = [1180, 1420, 980, 1650, 1530, 1890, 2140];
  const max = 2200; const pts = v.map((x, i) => `${(i / 6) * 100},${86 - (x / max) * 80}`).join(" ");
  return (
    <div className="ui">
      <div className="ui__head"><span className="ui__title">{tr("اليوم", "Today")}</span></div>
      <div className="ui__body kpi">
        <div><div className="kpi__n tabular">38</div><span className="ui__muted">{tr("زيارة", "visits")}</span></div>
        <div><div className="kpi__n tabular">$2,140</div><span className="ui__muted">{tr("محصّل اليوم", "collected today")}</span></div>
        <svg className="kpi__spark" viewBox="0 0 100 90" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={pts} fill="none" stroke="#0f766e" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          <circle cx="100" cy={86 - (v[6] / max) * 80} r="3" fill="#0f766e" />
        </svg>
        <span className="ui__muted">{tr("أعلى يوم هذا الأسبوع", "Best day this week")}</span>
      </div>
    </div>
  );
}

export function ClientFile({ tr }: { tr: Tr }) {
  return (
    <div className="ui">
      <div className="ui__head">
        <div className="rec__who"><span className="rec__av" aria-hidden="true">ن</span>
          <div><b>{tr("نور محمد", "Noor Mohammed")}</b><div className="ui__muted" dir="ltr">C-00412 · 0770 *** 3381</div></div></div>
        <span className="ui__chip ui__chip--ok">{tr("نشط", "Active")}</span>
      </div>
      <div className="ui__body rec">
        <div className="rec__grid">
          <div className="rec__cell"><small>{tr("حساسية", "Allergies")}</small><b>{tr("ليدوكائين", "Lidocaine")}</b></div>
          <div className="rec__cell"><small>{tr("نوع البشرة", "Skin type")}</small><b>Fitzpatrick III</b></div>
        </div>
        <div className="rec__cell">
          <small>{tr("برنامج ليزر إزالة الشعر، صالح حتى 20 آذار", "Laser hair removal program, valid to 20 Mar")}</small>
          <b>{tr("3 من 6 جلسات", "3 of 6 sessions")}</b>
          <div className="rec__prog" aria-hidden="true"><i data-on="" /><i data-on="" /><i data-on="" /><i /><i /><i /></div>
        </div>
        <div className="rec__tl">
          <div><span className="ui__chip ui__chip--lime">{tr("غداً", "Tomorrow")}</span><span>{tr("الجلسة 4 · 4:30 م · د. سارة", "Session 4 · 4:30 pm · Dr. Sara")}</span></div>
          <div><span className="ui__chip">{tr("9 تشرين 2", "9 Nov")}</span><span>{tr("الجلسة 3 · طاقة 18 J · بدون مضاعفات", "Session 3 · 18 J · no complications")}</span></div>
          <div><span className="ui__chip">{tr("12 تشرين 1", "12 Oct")}</span><span>{tr("صور قبل/بعد · 4 صور", "Before/after · 4 photos")}</span></div>
        </div>
      </div>
    </div>
  );
}

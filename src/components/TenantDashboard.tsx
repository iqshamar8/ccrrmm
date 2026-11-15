"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Card, Select, Spinner, StatCard, Table, Td, Tr } from "@/components/ui";
import { BarChart, LineChart, RankBars } from "@/components/charts";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import { subStatusLabel } from "@/lib/labels";

type G = "day" | "week" | "month" | "year";
type Dash = {
  granularity: G; timezone: string; finance: boolean;
  kpis: { clientsTotal: number | null; newClients: number | null; leads: number | null; converted: number | null; appointmentsToday: number | null; upcoming: number | null;
    completed: number | null; cancelled: number | null; noShow: number | null; completedValue: number | null };
  series: { bucket: string; completed: number; cancelled: number; booked: number; newClients: number; value: number | null }[];
  topServices: { id: string; name: string; count: number; value: number | null }[];
  topStaff: { id: string; name: string; count: number; value: number | null }[];
  branches: { id: string; name: string; completed: number; booked: number; value: number | null }[];
  money: null | { revenue: number; refunds: number; sales: number; invoices: number; receivables: number; overdue: number; unpaidInvoices: number; series: { bucket: string; amount: number }[]; profit: null | { revenue: number; expenses: number; net: number } };
  phase3: {
    subscriptions: null | { active: number; expiringIn7: number; expired: number; sold: number; soldValue: number | null };
    programs: null | { active: number; completed: number };
    surgeries: null | { completed: number; value: number | null; upcoming: number };
    reviews: null | { completed: number; overdue: number };
  };
};

const PRESETS = [
  { k: "today", days: 1, ar: "اليوم", en: "Today" },
  { k: "7d", days: 7, ar: "7 أيام", en: "7 days" },
  { k: "30d", days: 30, ar: "30 يوماً", en: "30 days" },
  { k: "90d", days: 90, ar: "3 أشهر", en: "3 months" },
  { k: "12m", days: 365, ar: "12 شهراً", en: "12 months" },
] as const;

const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Every bucket in range, aligned like PostgreSQL date_trunc (weeks start Monday). */
function buckets(from: Date, to: Date, g: G) {
  const out: Date[] = [];
  let c = dayStart(from);
  if (g === "week") c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  if (g === "month") c = new Date(c.getFullYear(), c.getMonth(), 1);
  if (g === "year") c = new Date(c.getFullYear(), 0, 1);
  while (c < to && out.length < 400) {
    out.push(new Date(c));
    if (g === "day") c.setDate(c.getDate() + 1);
    else if (g === "week") c.setDate(c.getDate() + 7);
    else if (g === "month") c.setMonth(c.getMonth() + 1);
    else c.setFullYear(c.getFullYear() + 1);
  }
  return out;
}

export default function TenantDashboard() {
  const s = useSession();
  const { tr, locale, can } = s;
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["k"]>("30d");
  const [gOverride, setG] = useState<G | "">("");
  const [branchId, setBranchId] = useState("");
  const [table, setTable] = useState(false);
  const { from, to } = useMemo(() => {
    const p = PRESETS.find((x) => x.k === preset)!;
    const t = dayStart(new Date()); t.setDate(t.getDate() + 1);
    const f = new Date(t); f.setDate(f.getDate() - p.days);
    return { from: f, to: t };
  }, [preset]);
  const days = (+to - +from) / 86400000;
  const g: G = gOverride || (days <= 31 ? "day" : days <= 120 ? "week" : "month");
  const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), granularity: g, ...(branchId ? { branchId } : {}) });
  const { data, loading } = useResource<Dash>(`/api/dashboard?${qs}`);
  const branches = useResource<{ id: string; name: string }[]>(can("branches.view") ? "/api/branches" : null);

  const series = useMemo(() => {
    if (!data) return [];
    const m = new Map(data.series.map((r) => [r.bucket.slice(0, 10), r]));
    // Plain d/m for day & week buckets: Intl's Arabic output embeds RTL marks that scramble inside an LTR axis.
    const fmtB = (d: Date) => g === "year" ? String(d.getFullYear())
      : g === "month" ? new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", { month: "short", year: "2-digit" }).format(d).replace(/[‎‏]/g, "")
      : `${d.getDate()}/${d.getMonth() + 1}`;
    return buckets(from, to, g).map((d) => {
      const r = m.get(key(d));
      return { label: fmtB(d), completed: r?.completed ?? 0, cancelled: r?.cancelled ?? 0, booked: r?.booked ?? 0, newClients: r?.newClients ?? 0, value: r?.value ?? 0 };
    });
  }, [data, from, to, g, locale]);

  // Revenue per bucket, aligned with the same buckets as the visit series.
  const revSeries = useMemo(() => {
    if (!data?.money) return [];
    const m = new Map(data.money.series.map((r) => [r.bucket.slice(0, 10), r.amount]));
    return buckets(from, to, g).map((d, i) => ({ label: series[i]?.label ?? "", amount: m.get(key(d)) ?? 0 }));
  }, [data, from, to, g, series]);

  const money = (v: number | null) => (v === null ? "—" : fmtMoney(v, s.tenant?.baseCurrency ?? "USD", locale));
  const k = data?.kpis;
  const sub = s.tenant?.subscription;
  const conv = k && k.newClients ? Math.round(((k.converted ?? 0) / Math.max(1, k.newClients)) * 100) : null;
  const attend = k && k.completed !== null ? Math.round((k.completed / Math.max(1, k.completed + (k.noShow ?? 0))) * 100) : null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{tr("مرحباً", "Welcome")}، {s.user.fullName}</h1>
          <p className="mt-1 text-sm text-muted">{s.tenant?.name} · {locale === "ar" ? s.tenant?.plan?.nameAr : s.tenant?.plan?.nameEn}
            {sub && <> · <Badge tone={sub.status === "ACTIVE" ? "green" : "amber"}>{subStatusLabel(sub.status, locale)}</Badge></>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-surface p-0.5">
            {PRESETS.map((p) => (
              <button key={p.k} onClick={() => setPreset(p.k)} className={`rounded-md px-3 py-1 text-xs ${preset === p.k ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{tr(p.ar, p.en)}</button>
            ))}
          </div>
          <Select className="h-8 w-auto text-xs" value={gOverride} onChange={(e) => setG(e.target.value as G | "")} aria-label={tr("التجميع", "Grouping")}>
            <option value="">{tr("تجميع تلقائي", "Auto grouping")}</option>
            <option value="day">{tr("يومي", "Daily")}</option><option value="week">{tr("أسبوعي", "Weekly")}</option>
            <option value="month">{tr("شهري", "Monthly")}</option><option value="year">{tr("سنوي", "Yearly")}</option>
          </Select>
          {branches.data && branches.data.length > 1 && (
            <Select className="h-8 w-auto text-xs" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{tr("كل الفروع", "All branches")}</option>{branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
        </div>
      </div>

      {loading && !data ? <div className="grid place-items-center py-24"><Spinner /></div> : data && k && (
        <div className={loading ? "opacity-60 transition-opacity" : ""}>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {k.appointmentsToday !== null && <StatCard label={tr("مواعيد اليوم", "Today's appointments")} value={k.appointmentsToday} hint={<Link href="/appointments" className="text-brand">{tr("فتح التقويم", "Open calendar")} ←</Link>} />}
            {k.upcoming !== null && <StatCard label={tr("المواعيد القادمة", "Upcoming")} value={k.upcoming} hint={tr("محجوزة أو مؤكدة", "scheduled or confirmed")} />}
            {k.completed !== null && <StatCard label={tr("الزيارات المكتملة", "Completed visits")} value={k.completed} hint={attend !== null ? `${tr("نسبة الحضور", "Attendance")} ${attend}%` : undefined} />}
            {k.cancelled !== null && <StatCard label={tr("الملغاة / عدم الحضور", "Cancelled / no-show")} value={`${k.cancelled} / ${k.noShow}`} />}
            {k.clientsTotal !== null && <StatCard label={tr("إجمالي العملاء", "Total clients")} value={k.clientsTotal} hint={`${k.leads} ${tr("عميل محتمل", "leads")}`} />}
            {k.newClients !== null && <StatCard label={tr("عملاء جدد", "New clients")} value={k.newClients} hint={conv !== null ? `${k.converted} ${tr("تحوّلوا من محتمل", "converted from leads")}` : undefined} />}
            {data.finance && <StatCard label={tr("قيمة الخدمات المنفذة", "Value of completed services")} value={<span className="text-xl">{money(k.completedValue)}</span>} hint={tr("سعر الخدمات المنفذة بالدفع المباشر", "Pay-per-visit services delivered")} />}
          </div>

          {data.money && (
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <StatCard label={tr("الإيرادات المحصّلة", "Revenue collected")} value={<span className="text-xl">{money(data.money.revenue)}</span>}
                hint={data.money.refunds ? `${tr("بعد خصم مسترد", "net of refunds")} ${money(data.money.refunds)}` : tr("دفعات ناقص المسترد", "payments minus refunds")} />
              <StatCard label={tr("إجمالي المبيعات (الفواتير الصادرة)", "Sales (issued invoices)")} value={<span className="text-xl">{money(data.money.sales)}</span>} hint={`${data.money.invoices} ${tr("فاتورة", "invoices")}`} />
              <StatCard label={tr("المستحقات المالية", "Receivables")} value={<span className="text-xl">{money(data.money.receivables)}</span>}
                hint={<Link href="/invoices" className={data.money.overdue ? "text-danger" : "text-brand"}>{money(data.money.overdue)} {tr("متأخرة", "overdue")} · {data.money.unpaidInvoices} {tr("فاتورة", "invoices")}</Link>} />
              <Card className="min-w-0 p-3">
                <p className="mb-1 text-xs text-muted">{tr("الإيرادات خلال الفترة", "Revenue over time")}</p>
                <BarChart height={110} label={tr("الإيرادات", "Revenue")} valueKey="amount" data={revSeries} />
              </Card>
              {data.money.profit && <>
                <StatCard label={tr("الإيرادات المستحقة (الدفاتر)", "Revenue earned (ledger)")} value={<span className="text-xl">{money(data.money.profit.revenue)}</span>} hint={tr("بعد الخصومات وبدون الضريبة", "after discounts, excl. tax")} />
                <StatCard label={tr("المصروفات", "Expenses")} value={<span className="text-xl">{money(data.money.profit.expenses)}</span>} hint={tr("مواد، رواتب، عمولات، مصاريف تشغيل", "materials, payroll, commissions, operating")} />
                <StatCard label={tr("صافي الربح", "Net profit")} value={<span className={`text-xl ${data.money.profit.net < 0 ? "text-danger" : "text-success"}`}>{money(data.money.profit.net)}</span>}
                  hint={<Link href="/accounting/reports" className="text-brand">{data.money.profit.revenue ? `${Math.round((data.money.profit.net / data.money.profit.revenue) * 100)}% ${tr("هامش", "margin")}` : tr("التقارير المالية", "Financial reports")}</Link>} />
              </>}
            </div>
          )}
          {(() => {
            const p3 = data.phase3;
            const tiles: React.ReactNode[] = [];
            if (p3.subscriptions) {
              tiles.push(<StatCard key="sa" label={tr("الاشتراكات النشطة", "Active subscriptions")} value={p3.subscriptions.active}
                hint={<Link href="/subscriptions" className={p3.subscriptions.expiringIn7 ? "text-warning" : "text-brand"}>{p3.subscriptions.expiringIn7} {tr("تنتهي خلال 7 أيام", "end within 7 days")}</Link>} />);
              tiles.push(<StatCard key="ss" label={tr("اشتراكات مباعة / منتهية", "Sold / expired")} value={`${p3.subscriptions.sold} / ${p3.subscriptions.expired}`}
                hint={p3.subscriptions.soldValue !== null ? money(p3.subscriptions.soldValue) : undefined} />);
            }
            if (p3.programs) tiles.push(<StatCard key="pg" label={tr("البرامج العلاجية النشطة", "Active programs")} value={p3.programs.active} hint={`${p3.programs.completed} ${tr("اكتملت في الفترة", "completed in period")}`} />);
            if (p3.surgeries) tiles.push(<StatCard key="sg" label={tr("العمليات الجراحية", "Surgeries")} value={p3.surgeries.completed}
              hint={<Link href="/surgeries" className="text-brand">{p3.surgeries.upcoming} {tr("قادمة", "upcoming")}{p3.surgeries.value !== null ? ` · ${money(p3.surgeries.value)}` : ""}</Link>} />);
            if (p3.reviews) tiles.push(<StatCard key="rv" label={tr("المراجعات الطبية", "Medical reviews")} value={p3.reviews.completed}
              hint={<Link href="/reviews" className={p3.reviews.overdue ? "text-danger" : "text-brand"}>{p3.reviews.overdue} {tr("متأخرة", "overdue")}</Link>} />);
            return tiles.length ? <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{tiles}</div> : null;
          })()}

          <div className="mb-2 flex justify-end">
            <button onClick={() => setTable(!table)} className="text-xs text-brand">{table ? tr("عرض الرسوم البيانية", "Show charts") : tr("عرض كجدول", "Show as table")}</button>
          </div>
          {table ? (
            <Card className="mb-4">
              <Table head={[tr("الفترة", "Period"), tr("المحجوزة", "Booked"), tr("المكتملة", "Completed"), tr("الملغاة/الغياب", "Cancelled/no-show"), tr("عملاء جدد", "New clients"), ...(data.finance ? [tr("القيمة", "Value")] : [])]}>
                {series.map((r) => <Tr key={r.label}><Td>{r.label}</Td><Td className="tabular">{r.booked}</Td><Td className="tabular">{r.completed}</Td><Td className="tabular">{r.cancelled}</Td><Td className="tabular">{r.newClients}</Td>{data.finance && <Td className="tabular">{money(r.value)}</Td>}</Tr>)}
              </Table>
            </Card>
          ) : (
            <div className="mb-4 grid gap-4 lg:grid-cols-5">
              {can("appointments.view") && (
                <Card className="min-w-0 p-4 lg:col-span-3">
                  <p className="mb-3 font-medium">{tr("الزيارات خلال الفترة", "Visits over time")}</p>
                  <LineChart data={series} series={[
                    { key: "completed", label: tr("مكتملة", "Completed"), color: "var(--series-1)" },
                    { key: "cancelled", label: tr("ملغاة / لم يحضر", "Cancelled / no-show"), color: "var(--series-2)" },
                  ]} />
                </Card>
              )}
              {can("clients.view") && (
                <Card className="min-w-0 p-4 lg:col-span-2">
                  <p className="mb-3 font-medium">{tr("العملاء الجدد", "New clients")}</p>
                  <BarChart data={series} valueKey="newClients" label={tr("عملاء جدد", "New clients")} />
                </Card>
              )}
            </div>
          )}

          {can("appointments.view") && (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-4">
                <p className="mb-3 font-medium">{tr("الخدمات الأكثر تنفيذاً", "Top services")}</p>
                <RankBars valueLabel={tr("زيارة", "visits")} rows={data.topServices.map((x) => ({ id: x.id, name: x.name, value: x.count, extra: x.value !== null ? money(x.value) : undefined }))} />
              </Card>
              <Card className="p-4">
                <p className="mb-3 font-medium">{tr("أفضل الأطباء والموظفين أداءً", "Top performers")}</p>
                <RankBars valueLabel={tr("زيارة", "visits")} rows={data.topStaff.map((x) => ({ id: x.id, name: x.name, value: x.count, extra: x.value !== null ? money(x.value) : undefined }))} />
              </Card>
              <Card className="p-4">
                <p className="mb-3 font-medium">{tr("أداء الفروع", "Branch performance")}</p>
                {data.branches.length > 0
                  ? <RankBars valueLabel={tr("زيارة مكتملة", "completed")} rows={data.branches.map((b) => ({ id: b.id, name: b.name, value: b.completed, extra: b.value !== null ? money(b.value) : `${b.booked} ${tr("محجوز", "booked")}` }))} />
                  : <p className="py-6 text-center text-sm text-muted">{tr("يظهر عند صلاحية مشاهدة كل الفروع", "Visible with all-branch access")}</p>}
              </Card>
            </div>
          )}
          <p className="mt-4 text-xs text-muted">
            {tr(`الفترة: ${fmtDate(from, locale)} – ${fmtDate(new Date(+to - 1), locale)} · المنطقة الزمنية ${data.timezone}. الأرباح والمصروفات من الدفاتر المحاسبية (أساس الاستحقاق).`,
              `Period: ${fmtDate(from, locale)} – ${fmtDate(new Date(+to - 1), locale)} · timezone ${data.timezone}. Profit and expenses come from the ledger (accrual basis).`)}
          </p>
        </div>
      )}
    </>
  );
}

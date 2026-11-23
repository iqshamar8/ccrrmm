"use client";
import { useEffect, useMemo, useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Card, EmptyState, Input, LoadingBlock, PageHeader, Select, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { BarChart, LineChart } from "@/components/charts";
import { fmtDate, fmtMoney } from "@/lib/i18n";

type Meta = { key: string; group: string; ar: string; en: string; range: boolean; days: { ar: string; en: string; def: number } | null };
type Col = { key: string; ar: string; en: string; type?: "text" | "number" | "money" | "percent" | "date" };
type Result = { key: string; title: { ar: string; en: string }; from: string; to: string; columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> | null;
  summary?: { ar: string; en: string; value: number | string | null; type?: string }[]; chart?: { label: string; values: string[]; kind?: "bar" | "line" } };

const GROUPS: [string, string, string][] = [
  ["clients", "العملاء", "Clients"], ["staff", "الموظفون", "Staff"], ["services", "الخدمات", "Services"], ["surgeries", "العمليات الجراحية", "Surgeries"],
  ["reviews", "المراجعات الطبية", "Medical reviews"], ["inventory", "المخازن", "Inventory"], ["finance", "المالية", "Finance"], ["extra", "إحصائيات إضافية", "More statistics"], ["compare", "المقارنات", "Comparisons"],
];
const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3, #1f9e78)", "var(--series-4, #9b59b6)"];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function ReportsPage() {
  const { tr, can, locale, tenant } = useSession();
  const list = useResource<Meta[]>(can("reports.view") ? "/api/reports" : null);
  const [key, setKey] = useState<string>("");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [branchId, setBranch] = useState("");
  const [days, setDays] = useState("");
  const branches = useResource<{ id: string; name: string }[]>(can("branches.view") ? "/api/branches" : null);
  useEffect(() => { const k = new URLSearchParams(window.location.search).get("r"); if (k) setKey(k); }, []);
  useEffect(() => { if (!key && list.data?.length) setKey(list.data[0].key); }, [list.data, key]);
  const meta = list.data?.find((m) => m.key === key);
  // `to` inclusive in the UI → exclusive next day for the API.
  const qs = new URLSearchParams({ from, to: iso(new Date(+new Date(to) + 86400000)), branchId, days: days || String(meta?.days?.def ?? ""), lang: locale === "en" ? "en" : "ar" }).toString();
  const report = useResource<Result>(meta ? `/api/reports/${key}?${qs}` : null);
  if (!can("reports.view")) return <Forbidden />;
  const cur = tenant?.baseCurrency ?? "USD";
  const fmt = (v: unknown, t?: string) => {
    if (v === null || v === undefined || v === "") return "—";
    if (t === "money") return fmtMoney(Number(v), cur, locale);
    if (t === "percent") return `${Number(v).toLocaleString(locale === "en" ? "en" : "ar-IQ", { maximumFractionDigits: 1 })}%`;
    if (t === "number") return Number(v).toLocaleString(locale === "en" ? "en" : "ar-IQ", { maximumFractionDigits: 2 });
    if (t === "date") return fmtDate(String(v), locale);
    return String(v);
  };
  const presets: [string, () => void][] = [
    [tr("7 أيام", "7 days"), () => { setFrom(iso(new Date(Date.now() - 7 * 86400000))); setTo(iso(new Date())); }],
    [tr("30 يوماً", "30 days"), () => { setFrom(iso(new Date(Date.now() - 30 * 86400000))); setTo(iso(new Date())); }],
    [tr("هذا الشهر", "This month"), () => { const d = new Date(); setFrom(iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)))); setTo(iso(d)); }],
    [tr("90 يوماً", "90 days"), () => { setFrom(iso(new Date(Date.now() - 90 * 86400000))); setTo(iso(new Date())); }],
    [tr("هذه السنة", "This year"), () => { setFrom(`${new Date().getUTCFullYear()}-01-01`); setTo(iso(new Date())); }],
  ];
  const r = report.data;
  return (
    <>
      <div className="print:hidden">
        <PageHeader title={tr("مركز التقارير", "Reports")} subtitle={tr("تقارير العملاء والموظفين والخدمات والعمليات والمراجعات والمخازن والمالية والتسويق، مع المقارنات وتصدير Excel وPDF.", "Clients, staff, services, surgeries, reviews, inventory, finance and marketing — with comparisons and Excel/PDF export.")} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Card className="hidden h-fit p-2 lg:block print:hidden">
          {list.loading && !list.data ? <LoadingBlock cols={1} /> : GROUPS.map(([g, ar, en]) => {
            const items = (list.data ?? []).filter((m) => m.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="mb-2">
                <p className="px-2 py-1 text-xs font-semibold text-muted">{tr(ar, en)}</p>
                {items.map((m) => <button key={m.key} onClick={() => { setKey(m.key); setDays(""); window.history.replaceState(null, "", `?r=${m.key}`); }} className={`block w-full rounded-lg px-2 py-1.5 text-start text-sm ${key === m.key ? "bg-brand/10 font-medium text-brand" : "hover:bg-surface-2"}`}>{tr(m.ar, m.en)}</button>)}
              </div>
            );
          })}
        </Card>
        <div className="min-w-0 space-y-4">
          {!!list.data?.length && <Select className="lg:hidden print:hidden" value={key} onChange={(e) => { setKey(e.target.value); setDays(""); window.history.replaceState(null, "", `?r=${e.target.value}`); }}>
            {GROUPS.map(([g, ar, en]) => { const items = list.data!.filter((m) => m.group === g); return items.length ? <optgroup key={g} label={tr(ar, en)}>{items.map((m) => <option key={m.key} value={m.key}>{tr(m.ar, m.en)}</option>)}</optgroup> : null; })}
          </Select>}
          {meta && <Card className="flex flex-wrap items-center gap-2 p-3 print:hidden">
            {meta.range && <><Input type="date" dir="ltr" className="max-w-[10rem]" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="text-muted">→</span><Input type="date" dir="ltr" className="max-w-[10rem]" value={to} onChange={(e) => setTo(e.target.value)} /></>}
            {meta.days && <label className="flex items-center gap-1 text-sm">{tr(meta.days.ar, meta.days.en)}<Input type="number" min={1} dir="ltr" className="w-24" value={days || String(meta.days.def)} onChange={(e) => setDays(e.target.value)} /></label>}
            {(branches.data?.length ?? 0) > 1 && <Select className="max-w-xs" value={branchId} onChange={(e) => setBranch(e.target.value)}><option value="">{tr("كل الفروع", "All branches")}</option>{(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
            {meta.range && presets.map(([l, f]) => <Button key={l} size="sm" variant="ghost" onClick={f}>{l}</Button>)}
            <span className="flex-1" />
            {can("reports.export") && <>
              <a href={`/api/reports/${key}/export?${qs}&format=xlsx`}><Button size="sm" variant="secondary">Excel</Button></a>
              <a href={`/api/reports/${key}/export?${qs}&format=csv`}><Button size="sm" variant="ghost">CSV</Button></a>
            </>}
            {can("reports.print") && <Button size="sm" variant="secondary" onClick={() => window.print()}>{tr("طباعة / PDF", "Print / PDF")}</Button>}
          </Card>}
          {!meta && !list.loading && <EmptyState title={tr("لا توجد تقارير متاحة لصلاحياتك", "No reports available for your role")} />}
          {meta && (report.loading && !r ? <Card><LoadingBlock cols={5} /></Card> : report.error ? <Card className="p-6 text-danger">{report.error}</Card> : r && <ReportView r={r} fmt={fmt} />)}
        </div>
      </div>
    </>
  );
}

function ReportView({ r, fmt }: { r: Result; fmt: (v: unknown, t?: string) => string }) {
  const { tr, locale, tenant } = useSession();
  const L = (c: { ar: string; en: string }) => (locale === "en" ? c.en : c.ar);
  const chart = useMemo(() => {
    if (!r.chart || !r.chart.values.length || r.rows.length < 2) return null;
    const pts = r.rows.slice(0, 40).map((row) => ({ label: String(row[r.chart!.label] ?? "—").slice(0, 24), ...Object.fromEntries(r.chart!.values.map((v) => [v, Number(row[v] ?? 0)])) }));
    return { pts, series: r.chart.values.map((v, i) => ({ key: v, label: L(r.columns.find((c) => c.key === v) ?? { ar: v, en: v }), color: COLORS[i % COLORS.length] })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, locale]);
  return (
    <div className="space-y-4">
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{L(r.title)}</h1>
        <p className="text-sm">{tenant?.name} · {fmtDate(r.from, locale)} → {fmtDate(new Date(+new Date(r.to) - 1).toISOString(), locale)}</p>
      </div>
      <h2 className="text-lg font-semibold print:hidden">{L(r.title)}</h2>
      {!!r.summary?.length && <div className="grid gap-3 sm:grid-cols-4">{r.summary.map((s) => <StatCard key={s.en} label={L(s)} value={fmt(s.value, s.type ?? "number")} />)}</div>}
      {chart && <Card className="p-4 print:break-inside-avoid">
        {r.chart?.kind === "line" || chart.series.length > 1
          ? <LineChart data={chart.pts} series={chart.series} />
          : <BarChart data={chart.pts} valueKey={chart.series[0].key} label={chart.series[0].label} />}
      </Card>}
      <Card>
        <Table head={r.columns.map((c) => L(c))}>
          {r.rows.map((row, i) => <Tr key={i}>{r.columns.map((c) => <Td key={c.key} className={c.type && c.type !== "text" ? "tabular whitespace-nowrap" : ""}>{fmt(row[c.key], c.type)}</Td>)}</Tr>)}
          {r.totals && r.rows.length > 1 && <Tr>{r.columns.map((c, i) => <Td key={c.key} className="font-semibold tabular">{i === 0 ? tr("الإجمالي", "Total") : r.totals![c.key] === undefined || r.totals![c.key] === "" ? "" : fmt(r.totals![c.key], c.type)}</Td>)}</Tr>}
        </Table>
        {!r.rows.length && <EmptyState title={tr("لا توجد بيانات في هذه الفترة", "No data for this period")} />}
      </Card>
    </div>
  );
}

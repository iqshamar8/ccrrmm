"use client";
import { useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Input, LoadingBlock, LoadingRows, PageHeader, Select, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { AccountingTabs, accName, LedgerModal, SOURCES } from "@/components/accounting/shared";
import { RankBars } from "@/components/charts";

type Row = { id: string; code: string; name: string; nameEn: string | null; amount: string };
type Income = { rows: (Row & { type: "REVENUE" | "EXPENSE" })[]; revenue: string; expenses: string; net: string; branches: { id: string; name: string; revenue: string; expenses: string; net: string }[] };
type BS = { assets: Row[]; liabilities: Row[]; equity: Row[]; earnings: string; totalAssets: string; totalLiabilities: string; totalEquity: string; balanced: boolean };
type CF = { opening: string; rows: { source: string; inflow: string; outflow: string; net: string }[]; net: string; closing: string };
type TB = { rows: { id: string; code: string; name: string; nameEn: string | null; debit: string; credit: string }[]; totals: { debit: string; credit: string } };
type Tab = "income" | "balance" | "cash" | "trial" | "payables";

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };

export default function ReportsPage() {
  const { tr, can } = useSession();
  const [tab, setTab] = useState<Tab>("income");
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(""); const [branchId, setBranch] = useState("");
  const branches = useResource<{ id: string; name: string }[]>(can("branches.view") ? "/api/branches" : null);
  const [ledger, setLedger] = useState<string | null>(null);
  if (!can("accounting.view")) return <Forbidden />;
  // `to` is inclusive in the UI → exclusive next-day bound for the API.
  const toEx = to ? new Date(+new Date(to) + 86400000).toISOString().slice(0, 10) : "";
  const qs = `from=${from}&to=${toEx}&branchId=${branchId}`;
  const tabs: [Tab, string][] = [["income", tr("الأرباح والخسائر", "Profit & loss")], ["balance", tr("الميزانية العمومية", "Balance sheet")], ["cash", tr("التدفق النقدي", "Cash flow")], ["trial", tr("ميزان المراجعة", "Trial balance")], ["payables", tr("ذمم الموردين", "Payables")]];
  const presets: [string, () => void][] = [
    [tr("هذا الشهر", "This month"), () => { setFrom(monthStart()); setTo(""); }],
    [tr("آخر 90 يوماً", "Last 90 days"), () => { setFrom(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)); setTo(""); }],
    [tr("هذه السنة", "This year"), () => { setFrom(`${new Date().getUTCFullYear()}-01-01`); setTo(""); }],
    [tr("الكل", "All time"), () => { setFrom(""); setTo(""); }],
  ];
  return (
    <>
      <PageHeader title={tr("المحاسبة", "Accounting")} subtitle={tr("تقارير من دفتر الأستاذ مباشرة — لكل فرع أو مجمّعة.", "Reports straight from the ledger — per branch or consolidated.")} />
      <AccountingTabs active="reports" />
      <div className="mb-3 flex gap-1 overflow-x-auto">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-brand text-white" : "bg-surface-2 text-muted"}`}>{l}</button>)}</div>
      {tab !== "payables" && <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        {tab !== "balance" && <><Input type="date" dir="ltr" className="max-w-[10rem]" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="text-muted">→</span></>}
        <Input type="date" dir="ltr" className="max-w-[10rem]" value={to} onChange={(e) => setTo(e.target.value)} title={tab === "balance" ? tr("كما في تاريخ", "As of") : ""} />
        <Select className="max-w-xs" value={branchId} onChange={(e) => setBranch(e.target.value)}><option value="">{tr("كل الفروع (مجمّع)", "All branches (consolidated)")}</option>{(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        {tab !== "balance" && presets.map(([l, f]) => <Button key={l} size="sm" variant="ghost" onClick={f}>{l}</Button>)}
      </Card>}
      {tab === "income" && <IncomeReport qs={qs} onAccount={setLedger} />}
      {tab === "balance" && <BalanceReport asOf={to} branchId={branchId} onAccount={setLedger} />}
      {tab === "cash" && <CashReport qs={qs} />}
      {tab === "trial" && <TrialReport qs={qs} onAccount={setLedger} />}
      {tab === "payables" && <Payables />}
      <LedgerModal id={ledger} onClose={() => setLedger(null)} from={tab === "balance" ? "" : from} to={toEx} />
    </>
  );
}

function Lines({ rows, onAccount }: { rows: Row[]; onAccount: (id: string) => void }) {
  const { locale } = useSession();
  const money = useMoney();
  return <>{rows.map((r) => <Tr key={r.id} onClick={() => onAccount(r.id)}><Td><span dir="ltr" className="font-mono text-xs text-muted">{r.code}</span> {accName(r, locale)}</Td><Td className="tabular text-end">{money(r.amount)}</Td></Tr>)}</>;
}
function Total({ label, value, strong }: { label: string; value: string | number; strong?: boolean }) {
  const money = useMoney();
  return <Tr><Td className={strong ? "font-bold" : "font-semibold"}>{label}</Td><Td className={`tabular text-end ${strong ? "font-bold" : "font-semibold"}`}>{money(value)}</Td></Tr>;
}

function IncomeReport({ qs, onAccount }: { qs: string; onAccount: (id: string) => void }) {
  const { tr } = useSession();
  const money = useMoney();
  const { data, loading } = useResource<Income>(`/api/accounting/reports/income?${qs}&byBranch=1`);
  if (loading && !data) return <Card><LoadingBlock cols={2} /></Card>;
  if (!data) return null;
  const margin = Number(data.revenue) ? Math.round((Number(data.net) / Number(data.revenue)) * 100) : 0;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label={tr("الإيرادات", "Revenue")} value={money(data.revenue)} />
        <StatCard label={tr("المصروفات", "Expenses")} value={money(data.expenses)} />
        <StatCard label={tr("صافي الربح", "Net profit")} value={<span className={Number(data.net) < 0 ? "text-danger" : "text-success"}>{money(data.net)}</span>} />
        <StatCard label={tr("هامش الربح", "Net margin")} value={`${margin}%`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Table head={[tr("الحساب", "Account"), tr("المبلغ", "Amount")]}>
            <Tr><Td className="font-semibold text-brand">{tr("الإيرادات", "Revenue")}</Td><Td /></Tr>
            <Lines rows={data.rows.filter((r) => r.type === "REVENUE")} onAccount={onAccount} />
            <Total label={tr("إجمالي الإيرادات", "Total revenue")} value={data.revenue} />
            <Tr><Td className="font-semibold text-brand">{tr("المصروفات", "Expenses")}</Td><Td /></Tr>
            <Lines rows={data.rows.filter((r) => r.type === "EXPENSE")} onAccount={onAccount} />
            <Total label={tr("إجمالي المصروفات", "Total expenses")} value={data.expenses} />
            <Total label={tr("صافي الربح / الخسارة", "Net profit / loss")} value={data.net} strong />
          </Table>
        </Card>
        {data.branches.length > 0 && <Card className="p-4">
          <div className="mb-2 font-medium">{tr("الأداء حسب الفرع", "By branch")}</div>
          <div className="mb-3"><RankBars rows={data.branches.map((b) => ({ id: b.id, name: b.name, value: Math.max(0, Number(b.net)), extra: tr("صافي", "net") }))} valueLabel={tr("صافي الربح", "Net profit")} /></div>
          <Table head={[tr("الفرع", "Branch"), tr("الإيرادات", "Revenue"), tr("المصروفات", "Expenses"), tr("الصافي", "Net")]}>
            {data.branches.map((b) => <Tr key={b.id}><Td className="font-medium">{b.name}</Td><Td className="tabular">{money(b.revenue)}</Td><Td className="tabular">{money(b.expenses)}</Td><Td className="tabular font-medium">{money(b.net)}</Td></Tr>)}
          </Table>
          <p className="mt-2 text-xs text-muted">{tr("الرواتب والمصروفات العامة غير المرتبطة بفرع تظهر في المجمّع فقط.", "Payroll and expenses not tied to a branch appear in the consolidated view only.")}</p>
        </Card>}
      </div>
    </div>
  );
}

function BalanceReport({ asOf, branchId, onAccount }: { asOf: string; branchId: string; onAccount: (id: string) => void }) {
  const { tr } = useSession();
  const { data, loading } = useResource<BS>(`/api/accounting/reports/balance-sheet?asOf=${asOf}&branchId=${branchId}`);
  if (loading && !data) return <Card><LoadingBlock cols={2} /></Card>;
  if (!data) return null;
  return (
    <div className="space-y-3">
      <div>{data.balanced ? <Badge tone="green">{tr("الميزانية متوازنة", "Balanced")}</Badge> : <Badge tone="red">{tr("غير متوازنة", "Not balanced")}</Badge>}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><Table head={[tr("الأصول", "Assets"), ""]}><Lines rows={data.assets} onAccount={onAccount} /><Total label={tr("إجمالي الأصول", "Total assets")} value={data.totalAssets} strong /></Table></Card>
        <Card><Table head={[tr("الخصوم وحقوق الملكية", "Liabilities & equity"), ""]}>
          <Lines rows={data.liabilities} onAccount={onAccount} /><Total label={tr("إجمالي الخصوم", "Total liabilities")} value={data.totalLiabilities} />
          <Lines rows={data.equity} onAccount={onAccount} />
          <Tr><Td>{tr("أرباح الفترة (غير مقفلة)", "Current earnings (unclosed)")}</Td><Td className="tabular text-end"><EarningsCell v={data.earnings} /></Td></Tr>
          <Total label={tr("إجمالي حقوق الملكية", "Total equity")} value={data.totalEquity} />
          <Total label={tr("الخصوم + حقوق الملكية", "Liabilities + equity")} value={Number(data.totalLiabilities) + Number(data.totalEquity)} strong />
        </Table></Card>
      </div>
    </div>
  );
}
function EarningsCell({ v }: { v: string }) { const money = useMoney(); return <>{money(v)}</>; }

function CashReport({ qs }: { qs: string }) {
  const { tr } = useSession();
  const money = useMoney();
  const { data, loading } = useResource<CF>(`/api/accounting/reports/cash-flow?${qs}`);
  if (loading && !data) return <Card><LoadingBlock cols={4} /></Card>;
  if (!data) return null;
  return (
    <Card>
      <Table head={[tr("المصدر", "Source"), tr("وارد", "In"), tr("صادر", "Out"), tr("الصافي", "Net")]}>
        <Tr><Td className="font-semibold">{tr("رصيد أول المدة", "Opening balance")}</Td><Td /><Td /><Td className="tabular font-semibold">{money(data.opening)}</Td></Tr>
        {data.rows.map((r) => <Tr key={r.source}><Td>{tr(...(SOURCES[r.source] ?? [r.source, r.source]))}</Td><Td className="tabular text-success">{money(r.inflow)}</Td><Td className="tabular text-danger">{money(r.outflow)}</Td><Td className="tabular">{money(r.net)}</Td></Tr>)}
        <Tr><Td className="font-semibold">{tr("صافي التغير", "Net change")}</Td><Td /><Td /><Td className="tabular font-semibold">{money(data.net)}</Td></Tr>
        <Tr><Td className="font-bold">{tr("رصيد آخر المدة", "Closing balance")}</Td><Td /><Td /><Td className="tabular font-bold">{money(data.closing)}</Td></Tr>
      </Table>
    </Card>
  );
}

function TrialReport({ qs, onAccount }: { qs: string; onAccount: (id: string) => void }) {
  const { tr, locale } = useSession();
  const money = useMoney();
  const { data, loading } = useResource<TB>(`/api/accounting/reports/trial-balance?${qs}`);
  if (loading && !data) return <Card><LoadingBlock cols={3} /></Card>;
  if (!data) return null;
  const ok = Number(data.totals.debit).toFixed(2) === Number(data.totals.credit).toFixed(2);
  return (
    <Card>
      <Table head={[tr("الحساب", "Account"), tr("مدين", "Debit"), tr("دائن", "Credit")]}>
        {data.rows.map((r) => <Tr key={r.id} onClick={() => onAccount(r.id)}><Td><span dir="ltr" className="font-mono text-xs text-muted">{r.code}</span> {accName(r, locale)}</Td><Td className="tabular">{money(r.debit)}</Td><Td className="tabular">{money(r.credit)}</Td></Tr>)}
        <Tr><Td className="font-bold">{tr("الإجمالي", "Total")} {ok ? <Badge tone="green">✓</Badge> : <Badge tone="red">≠</Badge>}</Td><Td className="tabular font-bold">{money(data.totals.debit)}</Td><Td className="tabular font-bold">{money(data.totals.credit)}</Td></Tr>
      </Table>
      {!data.rows.length && <EmptyState title={tr("لا توجد حركات في الفترة", "No activity in the period")} />}
    </Card>
  );
}

function Payables() {
  const { tr } = useSession();
  const money = useMoney();
  const { data, loading } = useResource<{ supplier: { id: string; name: string; phone: string | null }; balance: string }[]>("/api/accounting/reports/payables");
  return (
    <Card>
      <Table head={[tr("المورد", "Supplier"), tr("الهاتف", "Phone"), tr("المستحق له", "Balance owed")]}>
        {loading && !data ? <LoadingRows cols={3} /> : (data ?? []).map((r) => <Tr key={r.supplier.id}><Td className="font-medium">{r.supplier.name}</Td><Td dir="ltr" className="text-muted">{r.supplier.phone ?? "—"}</Td><Td className="tabular font-medium">{money(r.balance)}</Td></Tr>)}
      </Table>
      {!loading && !data?.length && <EmptyState title={tr("لا توجد ذمم للموردين", "Nothing owed to suppliers")} />}
    </Card>
  );
}

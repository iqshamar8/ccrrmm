"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { AccountingTabs, type CashAccount, LedgerModal } from "@/components/accounting/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Rate = { id: string; currency: string; rate: string; date: string };

export default function CashPage() {
  const { tr, can, tenant, locale } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<CashAccount[]>(can("accounting.view") ? "/api/accounting/cash-accounts" : null);
  const rates = useResource<Rate[]>(can("accounting.view") ? "/api/accounting/rates" : null);
  const branches = useResource<{ id: string; name: string }[]>(can("branches.view") ? "/api/branches" : null);
  const [edit, setEdit] = useState<CashAccount | "new" | null>(null);
  const [ledger, setLedger] = useState<string | null>(null);
  const [r, setR] = useState({ currency: "", rate: "", date: new Date().toISOString().slice(0, 10) });
  const { pending, run } = useSubmit();
  if (!can("accounting.view")) return <Forbidden />;
  const latest = Object.values((rates.data ?? []).reduce<Record<string, Rate>>((m, x) => (m[x.currency] ? m : { ...m, [x.currency]: x }), {}));
  const total = (data ?? []).reduce((s, c) => s + Number(c.balance), 0);
  return (
    <>
      <PageHeader title={tr("المحاسبة", "Accounting")} subtitle={tr("صندوق نقدي لكل فرع وحسابات بنكية، وأسعار صرف العملات الأجنبية مقابل العملة الأساسية.", "A cash box per branch, bank accounts, and exchange rates against the base currency.")}
        actions={can("accounting.create") && <Button onClick={() => setEdit("new")}>+ {tr("صندوق / بنك", "Cash box / bank")}</Button>} />
      <AccountingTabs active="cash" />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-2"><span className="font-medium">{tr("الصناديق والبنوك", "Cash boxes & banks")}</span><span className="tabular text-sm">{tr("الإجمالي", "Total")}: <b>{money(total)}</b></span></div>
          <Table head={[tr("الاسم", "Name"), tr("النوع", "Type"), tr("الفرع", "Branch"), tr("الرصيد", "Balance"), ""]}>
            {loading && !data ? <LoadingRows cols={5} /> : (data ?? []).map((c) => (
              <Tr key={c.id} onClick={() => setLedger(c.accountId)}>
                <Td className="font-medium">{c.name} {c.isDefault && <Badge tone="brand">{tr("افتراضي", "Default")}</Badge>} {!c.isActive && <Badge>{tr("معطل", "Inactive")}</Badge>}{c.accountNo && <div className="text-xs text-muted" dir="ltr">{c.bankName} · {c.accountNo}</div>}</Td>
                <Td><Badge tone={c.kind === "CASH" ? "green" : "blue"}>{c.kind === "CASH" ? tr("صندوق", "Cash") : tr("بنك", "Bank")}</Badge></Td>
                <Td className="text-muted">{c.branch?.name ?? tr("كل الفروع", "All branches")}</Td>
                <Td className={`tabular font-medium ${Number(c.balance) < 0 ? "text-danger" : ""}`}>{money(c.balance)}</Td>
                <Td>{can("accounting.update") && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEdit(c); }}>{tr("تعديل", "Edit")}</Button>}</Td>
              </Tr>
            ))}
          </Table>
        </Card>
        <Card>
          <div className="border-b border-line px-4 py-2 font-medium">{tr("أسعار الصرف", "Exchange rates")} <span className="text-xs text-muted">— 1 {tr("وحدة", "unit")} = ? {tenant?.baseCurrency}</span></div>
          {can("accounting.create") && <form className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-2 border-b border-line p-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("/api/accounting/rates", { method: "POST", body: { ...r, rate: Number(r.rate) } }), tr("تم الحفظ", "Saved"))) { setR({ ...r, rate: "" }); rates.reload(); } }}>
            <Input dir="ltr" required maxLength={3} placeholder="EUR" value={r.currency} onChange={(e) => setR({ ...r, currency: e.target.value.toUpperCase() })} />
            <Input type="number" min={0} step="any" dir="ltr" required placeholder={tr("السعر", "Rate")} value={r.rate} onChange={(e) => setR({ ...r, rate: e.target.value })} />
            <Input type="date" dir="ltr" required value={r.date} onChange={(e) => setR({ ...r, date: e.target.value })} />
            <Button type="submit" loading={pending}>+</Button>
          </form>}
          <Table head={[tr("العملة", "Currency"), tr("آخر سعر", "Latest rate"), tr("من تاريخ", "Since")]}>
            {latest.map((x) => <Tr key={x.id}><Td className="font-mono">{x.currency}</Td><Td className="tabular" dir="ltr">{Number(x.rate)}</Td><Td className="text-muted">{fmtDate(x.date, locale)}</Td></Tr>)}
          </Table>
          {!rates.loading && !latest.length && <EmptyState title={tr("لا توجد عملات أجنبية", "No foreign currencies")} />}
        </Card>
      </div>
      <LedgerModal id={ledger} onClose={() => setLedger(null)} />
      <CashModal c={edit} branches={branches.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

function CashModal({ c, branches, onClose, onSaved }: { c: CashAccount | "new" | null; branches: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const isNew = c === "new";
  const blank = { kind: "CASH" as "CASH" | "BANK", name: "", branchId: "", bankName: "", accountNo: "", isDefault: false, isActive: true };
  const [f, setF] = useState(blank);
  const [for_, setFor] = useState<string | null>(null);
  const key = c === "new" ? "new" : c?.id ?? null;
  if (key !== for_) { setFor(key); setF(c && c !== "new" ? { kind: c.kind, name: c.name, branchId: c.branchId ?? "", bankName: c.bankName ?? "", accountNo: c.accountNo ?? "", isDefault: c.isDefault, isActive: c.isActive } : blank); }
  const { pending, fields, run } = useSubmit();
  return (
    <Modal open={!!c} onClose={onClose} title={isNew ? tr("صندوق / حساب بنكي جديد", "New cash box / bank") : tr("تعديل", "Edit")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="cash" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="cash" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api(isNew ? "/api/accounting/cash-accounts" : `/api/accounting/cash-accounts/${(c as CashAccount).id}`, { method: isNew ? "POST" : "PATCH", body: { ...f, branchId: f.branchId || null } }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("النوع", "Type")}><Select disabled={!isNew} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "CASH" | "BANK" })}><option value="CASH">{tr("صندوق نقدي", "Cash box")}</option><option value="BANK">{tr("حساب بنكي", "Bank account")}</option></Select></Field>
        <Field label={tr("الفرع", "Branch")}><Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">{tr("كل الفروع", "All branches")}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label={tr("الاسم", "Name")} className="sm:col-span-2" error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        {f.kind === "BANK" && <>
          <Field label={tr("المصرف", "Bank")}><Input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
          <Field label={tr("رقم الحساب / IBAN", "Account no. / IBAN")}><Input dir="ltr" value={f.accountNo} onChange={(e) => setF({ ...f, accountNo: e.target.value })} /></Field>
        </>}
        <Checkbox label={f.kind === "CASH" ? tr("الصندوق الافتراضي للفرع", "Branch default") : tr("البنك الافتراضي", "Default bank")} checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
        <Checkbox label={tr("فعّال", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
      </form>
    </Modal>
  );
}

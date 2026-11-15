"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { type Account, type AccountType, AccountingTabs, accName, LedgerModal, TYPES } from "@/components/accounting/shared";
import { api } from "@/lib/client";

export default function ChartOfAccountsPage() {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Account[]>(can("accounting.view") ? "/api/accounting/accounts" : null);
  const [ledger, setLedger] = useState<string | null>(null);
  const [edit, setEdit] = useState<Account | "new" | null>(null);
  if (!can("accounting.view")) return <Forbidden />;
  const rows = data ?? [];
  const depth = (a: Account): number => { let d = 0, p = a.parentId; while (p) { d++; p = rows.find((x) => x.id === p)?.parentId ?? null; } return d; };
  // Group totals roll up from their leaves.
  const rollup = (a: Account): number => a.isGroup ? rows.filter((c) => c.parentId === a.id).reduce((s, c) => s + rollup(c), 0) : Number(a.balance);
  const ordered = [...rows].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return (
    <>
      <PageHeader title={tr("المحاسبة", "Accounting")} subtitle={tr("قيد مزدوج: كل فاتورة وتحصيل وحركة مخزون ورواتب تُرحّل تلقائياً. القيود لا تُعدّل ولا تُحذف — تُعكس.", "Double-entry: invoices, collections, stock and payroll post automatically. Entries are never edited or deleted — they're reversed.")}
        actions={can("accounting.create") && <Button onClick={() => setEdit("new")}>+ {tr("حساب", "Account")}</Button>} />
      <AccountingTabs active="chart" />
      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        {(Object.keys(TYPES) as AccountType[]).map((t) => {
          const top = rows.filter((a) => a.type === t && !a.parentId);
          return <Card key={t} className="p-3"><div className="text-xs text-muted">{tr(...TYPES[t])}</div><div className="tabular text-lg font-semibold">{money(top.reduce((s, a) => s + rollup(a), 0))}</div></Card>;
        })}
      </div>
      <Card>
        <Table head={[tr("الرمز", "Code"), tr("الحساب", "Account"), tr("النوع", "Type"), tr("مدين", "Debit"), tr("دائن", "Credit"), tr("الرصيد", "Balance"), ""]}>
          {loading && !data ? <LoadingRows cols={7} /> : ordered.map((a) => (
            <Tr key={a.id} onClick={a.isGroup ? undefined : () => setLedger(a.id)}>
              <Td><span dir="ltr" className="font-mono text-xs">{a.code}</span></Td>
              <Td className={a.isGroup ? "font-semibold" : ""}><span style={{ paddingInlineStart: depth(a) * 16 }}>{accName(a, locale)}</span>{a.systemKey && <span className="ms-2"><Badge>{tr("نظامي", "System")}</Badge></span>}{!a.isActive && <span className="ms-1"><Badge>{tr("معطل", "Inactive")}</Badge></span>}</Td>
              <Td className="text-muted">{tr(...TYPES[a.type])}</Td>
              <Td className="tabular text-muted">{a.isGroup ? "" : money(a.debit)}</Td><Td className="tabular text-muted">{a.isGroup ? "" : money(a.credit)}</Td>
              <Td className={`tabular ${a.isGroup ? "font-semibold" : "font-medium"}`}>{money(rollup(a))}</Td>
              <Td>{can("accounting.update") && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEdit(a); }}>{tr("تعديل", "Edit")}</Button>}</Td>
            </Tr>
          ))}
        </Table>
      </Card>
      <LedgerModal id={ledger} onClose={() => setLedger(null)} />
      <AccountModal acc={edit} accounts={rows} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

function AccountModal({ acc, accounts, onClose, onSaved }: { acc: Account | "new" | null; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const { tr, locale } = useSession();
  const isNew = acc === "new";
  const [f, setF] = useState({ code: "", name: "", nameEn: "", type: "EXPENSE" as AccountType, parentId: "", isGroup: false, isActive: true });
  const [for_, setFor] = useState<string | null>(null);
  const key = acc === "new" ? "new" : acc?.id ?? null;
  if (key !== for_) {
    setFor(key);
    if (acc && acc !== "new") setF({ code: acc.code, name: acc.name, nameEn: acc.nameEn ?? "", type: acc.type, parentId: acc.parentId ?? "", isGroup: acc.isGroup, isActive: acc.isActive });
    else if (acc === "new") setF({ code: "", name: "", nameEn: "", type: "EXPENSE", parentId: "", isGroup: false, isActive: true });
  }
  const { pending, fields, run } = useSubmit();
  const system = acc && acc !== "new" && !!acc.systemKey;
  return (
    <Modal open={!!acc} onClose={onClose} title={isNew ? tr("حساب جديد", "New account") : tr("تعديل الحساب", "Edit account")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="acc" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="acc" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api(isNew ? "/api/accounting/accounts" : `/api/accounting/accounts/${(acc as Account).id}`, { method: isNew ? "POST" : "PATCH", body: { ...f, parentId: f.parentId || null } }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("الرمز", "Code")} error={fields.code}><Input dir="ltr" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label={tr("النوع", "Type")}><Select disabled={!!system} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AccountType, parentId: "" })}>{(Object.keys(TYPES) as AccountType[]).map((t) => <option key={t} value={t}>{tr(...TYPES[t])}</option>)}</Select></Field>
        <Field label={tr("الاسم", "Name")} error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("الاسم بالإنجليزية", "English name")}><Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <Field label={tr("الحساب الأب", "Parent")} className="sm:col-span-2" error={fields.parentId}><Select value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
          <option value="">—</option>{accounts.filter((a) => a.isGroup && a.type === f.type && a.id !== (acc as Account)?.id).map((a) => <option key={a.id} value={a.id}>{a.code} — {accName(a, locale)}</option>)}
        </Select></Field>
        <Checkbox label={tr("حساب تجميعي (لا يُرحّل عليه)", "Group account (no postings)")} disabled={!!system} checked={f.isGroup} onChange={(e) => setF({ ...f, isGroup: e.target.checked })} />
        <Checkbox label={tr("فعّال", "Active")} disabled={!!system} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        {system && <p className="text-xs text-muted sm:col-span-2">{tr("حساب نظامي تستخدمه الترحيلات التلقائية؛ لا يتغير نوعه.", "System account used by automatic postings; its type is fixed.")}</p>}
      </form>
    </Modal>
  );
}

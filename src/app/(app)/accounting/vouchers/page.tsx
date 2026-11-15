"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { AccountingTabs, AccountOptions, type CashAccount, useLeafAccounts } from "@/components/accounting/shared";
import { api } from "@/lib/client";
import { fmtDate, fmtMoney } from "@/lib/i18n";

type Voucher = { id: string; code: string; type: "RECEIPT" | "PAYMENT"; status: "POSTED" | "VOID"; date: string; amount: string; currency: string; fcAmount: string; rate: string; payee: string | null; description: string;
  account?: { code: string; name: string }; cash?: { name: string }; supplier: { name: string } | null };

export default function VouchersPage() {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const [type, setType] = useState(""); const [exp, setExp] = useState(false); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const { data, loading, reload } = useResource<Voucher[]>(can("accounting.view") ? `/api/accounting/vouchers?type=${type}&from=${from}&to=${to}${exp ? "&expenses=1" : ""}` : null);
  const [create, setCreate] = useState<"RECEIPT" | "PAYMENT" | null>(null);
  const [voidOf, setVoidOf] = useState<Voucher | null>(null);
  if (!can("accounting.view")) return <Forbidden />;
  const live = (data ?? []).filter((v) => v.status === "POSTED");
  const totalIn = live.filter((v) => v.type === "RECEIPT").reduce((s, v) => s + Number(v.amount), 0);
  const totalOut = live.filter((v) => v.type === "PAYMENT").reduce((s, v) => s + Number(v.amount), 0);
  return (
    <>
      <PageHeader title={tr("المحاسبة", "Accounting")} subtitle={tr("سندات القبض والصرف: المصروفات (إيجار، كهرباء، تسويق…)، دفعات الموردين، والإيرادات الأخرى — بأي عملة.", "Receipt and payment vouchers: expenses (rent, utilities, marketing…), supplier payments and other income — in any currency.")}
        actions={can("accounting.create") && <div className="flex gap-2"><Button onClick={() => setCreate("PAYMENT")}>+ {tr("سند صرف", "Payment voucher")}</Button><Button variant="secondary" onClick={() => setCreate("RECEIPT")}>+ {tr("سند قبض", "Receipt voucher")}</Button></div>} />
      <AccountingTabs active="vouchers" />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={tr("المقبوضات", "Received")} value={money(totalIn)} />
        <StatCard label={tr("المدفوعات", "Paid out")} value={money(totalOut)} />
        <StatCard label={tr("عدد السندات", "Vouchers")} value={live.length} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Select className="max-w-[12rem]" value={type} onChange={(e) => setType(e.target.value)}><option value="">{tr("كل السندات", "All vouchers")}</option><option value="PAYMENT">{tr("صرف", "Payments")}</option><option value="RECEIPT">{tr("قبض", "Receipts")}</option></Select>
          <Input type="date" dir="ltr" className="max-w-[10rem]" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" dir="ltr" className="max-w-[10rem]" value={to} onChange={(e) => setTo(e.target.value)} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={exp} onChange={(e) => setExp(e.target.checked)} />{tr("المصروفات فقط", "Expenses only")}</label>
        </div>
        <Table head={[tr("الرقم", "No."), tr("التاريخ", "Date"), tr("الحساب", "Account"), tr("البيان", "Description"), tr("الصندوق", "Cash box"), tr("المبلغ", "Amount"), ""]}>
          {loading && !data ? <LoadingRows cols={7} /> : (data ?? []).map((v) => (
            <Tr key={v.id}>
              <Td><span dir="ltr" className="font-mono text-xs">{v.code}</span> {v.status === "VOID" && <Badge tone="red">{tr("ملغي", "Void")}</Badge>}</Td>
              <Td className="text-muted">{fmtDate(v.date, locale)}</Td>
              <Td className="text-sm">{v.account ? <><span dir="ltr" className="font-mono text-xs">{v.account.code}</span> {v.account.name}</> : "—"}{v.supplier && <div className="text-xs text-muted">{v.supplier.name}</div>}</Td>
              <Td className="text-sm">{v.description}{v.payee && <div className="text-xs text-muted">{v.payee}</div>}</Td>
              <Td className="text-muted">{v.cash?.name}</Td>
              <Td className={`tabular ${v.status === "VOID" ? "line-through text-muted" : v.type === "PAYMENT" ? "text-danger" : "text-success"}`}>
                {v.type === "PAYMENT" ? "−" : "+"}{money(v.amount)}
                {Number(v.rate) !== 1 && <div className="text-xs text-muted" dir="ltr">{fmtMoney(Number(v.fcAmount), v.currency, locale)} × {Number(v.rate)}</div>}
              </Td>
              <Td>{v.status === "POSTED" && can("accounting.approve") && <Button size="sm" variant="ghost" onClick={() => setVoidOf(v)}>{tr("إلغاء", "Void")}</Button>}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && !data?.length && <EmptyState title={tr("لا توجد سندات", "No vouchers")} />}
      </Card>
      <VoucherModal type={create} onClose={() => setCreate(null)} onDone={() => { setCreate(null); reload(); }} />
      <VoidModal v={voidOf} onClose={() => setVoidOf(null)} onDone={() => { setVoidOf(null); reload(); }} />
    </>
  );
}

function VoucherModal({ type, onClose, onDone }: { type: "RECEIPT" | "PAYMENT" | null; onClose: () => void; onDone: () => void }) {
  const { tr, tenant } = useSession();
  const accounts = useLeafAccounts(!!type);
  const cash = useResource<CashAccount[]>(type ? "/api/accounting/cash-accounts" : null);
  const rates = useResource<{ currency: string }[]>(type ? "/api/accounting/rates" : null);
  const sups = useResource<{ id: string; name: string }[]>(type ? "/api/inventory/suppliers" : null);
  const base = tenant?.baseCurrency ?? "USD";
  const blank = { date: new Date().toISOString().slice(0, 10), cashAccountId: "", counterAccountId: "", amount: "", currency: base, supplierId: "", payee: "", description: "" };
  const [f, setF] = useState(blank);
  const { pending, fields, run } = useSubmit();
  const counter = accounts.find((a) => a.id === f.counterAccountId);
  const isAP = counter?.systemKey === "AP";
  const currencies = [base, ...new Set((rates.data ?? []).map((r) => r.currency))];
  const pay = type === "PAYMENT";
  return (
    <Modal open={!!type} onClose={onClose} title={pay ? tr("سند صرف", "Payment voucher") : tr("سند قبض", "Receipt voucher")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="vch" type="submit" loading={pending}>{tr("ترحيل", "Post")}</Button></>}>
      <form id="vch" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f, type, amount: Number(f.amount), supplierId: isAP ? f.supplierId || null : null };
        if (await run(() => api("/api/accounting/vouchers", { method: "POST", body }), tr("تم ترحيل السند", "Voucher posted"))) { setF(blank); onDone(); }
      }}>
        <Field label={pay ? tr("يُصرف من", "Pay from") : tr("يُقبض في", "Receive into")}><Select required value={f.cashAccountId} onChange={(e) => setF({ ...f, cashAccountId: e.target.value })}><option value="">—</option>{(cash.data ?? []).filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label={tr("التاريخ", "Date")}><Input type="date" dir="ltr" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={pay ? tr("حساب المصروف / الجهة", "Expense / counter account") : tr("حساب الإيراد / الجهة", "Income / counter account")} className="sm:col-span-2" error={fields.counterAccountId}>
          <Select required value={f.counterAccountId} onChange={(e) => setF({ ...f, counterAccountId: e.target.value })}><option value="">—</option><AccountOptions accounts={accounts.filter((a) => !(cash.data ?? []).some((c) => c.accountId === a.id))} types={pay ? ["EXPENSE", "LIABILITY", "ASSET", "EQUITY"] : ["REVENUE", "ASSET", "LIABILITY", "EQUITY"]} /></Select>
        </Field>
        {isAP && <Field label={tr("المورد", "Supplier")} className="sm:col-span-2"><Select required value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{(sups.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
        <Field label={tr("المبلغ", "Amount")} error={fields.amount}><Input type="number" min={0} step="any" dir="ltr" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={tr("العملة", "Currency")} hint={f.currency !== base ? tr("يُحوّل بسعر الصرف المسجل لتاريخ السند", "Converted at the rate on file for the voucher date") : undefined}>
          <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
        <Field label={pay ? tr("المستفيد", "Payee") : tr("الدافع", "Paid by")}><Input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></Field>
        <Field label={tr("البيان", "Description")} error={fields.description}><Input required minLength={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

function VoidModal({ v, onClose, onDone }: { v: Voucher | null; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const [reason, setReason] = useState("");
  const { pending, run } = useSubmit();
  return (
    <Modal open={!!v} onClose={onClose} title={`${tr("إلغاء السند", "Void voucher")} ${v?.code ?? ""}`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("رجوع", "Back")}</Button><Button variant="danger" disabled={reason.trim().length < 2} loading={pending} onClick={async () => { if (await run(() => api(`/api/accounting/vouchers/${v!.id}/void`, { method: "POST", body: { reason } }), tr("تم إلغاء السند", "Voucher voided"))) { setReason(""); onDone(); } }}>{tr("إلغاء السند", "Void")}</Button></>}>
      <p className="mb-2 text-sm text-muted">{tr("يُرحّل قيد عكسي ويبقى السند ظاهراً كملغي.", "A reversing entry is posted; the voucher stays visible as void.")}</p>
      <Field label={tr("السبب", "Reason")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

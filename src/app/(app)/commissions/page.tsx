"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import type { Staff } from "@/components/appointments/shared";
import { useMoney } from "@/components/billing/useMoney";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { COMMISSION_SOURCE, COMMISSION_STATUS, l4, t4 } from "@/lib/labels4";

type Entry = { id: string; source: string; amount: string; baseAmount: string; rateType: string; rateValue: string; status: string; earnedAt: string; note: string | null; user: { id: string; fullName: string }; invoice: { id: string; code: string | null } | null };
type Data = { items: Entry[]; summary: { user: { id: string; fullName: string }; pending: string; approved: string; paid: string }[]; ownOnly: boolean };

export default function CommissionsPage() {
  const { tr, locale, can } = useSession();
  const money = useMoney();
  const [status, setStatus] = useState("PENDING");
  const [userId, setUserId] = useState("");
  const [source, setSource] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adj, setAdj] = useState(false);
  const ok = can("commissions.view");
  const { data, loading, reload } = useResource<Data>(ok ? `/api/commissions?status=${status}&userId=${userId}&source=${source}` : null);
  const staff = useResource<Staff[]>(ok && can("commissions.approve") ? "/api/staff" : null);
  const act = useSubmit();
  const total = useMemo(() => (data?.items ?? []).reduce((s, e) => s + Number(e.amount), 0), [data]);
  if (!ok) return <Forbidden />;
  const approver = can("commissions.approve");
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async (action: "APPROVE" | "VOID") => { if (await act.run(() => api("/api/commissions/status", { body: { ids: [...sel], action } }), tr("تم التحديث", "Updated"))) { setSel(new Set()); reload(); } };

  return (
    <>
      <PageHeader title={data?.ownOnly ? tr("عمولاتي", "My commissions") : tr("العمولات", "Commissions")}
        subtitle={tr("تُحتسب تلقائياً عند سداد الفاتورة — الاعتماد ثم الصرف ضمن الرواتب", "Generated automatically when invoices are paid — approve, then paid via payroll")}
        actions={approver && can("commissions.create") && <Button variant="secondary" onClick={() => setAdj(true)}>+ {tr("تسوية يدوية", "Manual adjustment")}</Button>} />
      {!data?.ownOnly && (data?.summary.length ?? 0) > 0 && (
        <Card className="mb-4">
          <Table head={[tr("الموظف", "Staff"), tr("قيد الاعتماد", "Pending"), tr("معتمدة (بانتظار الصرف)", "Approved"), tr("مدفوعة", "Paid")]}>
            {data!.summary.map((s) => (
              <Tr key={s.user.id} onClick={() => setUserId(s.user.id)}><Td className="font-medium">{s.user.fullName}</Td><Td className="tabular">{money(s.pending)}</Td><Td className="tabular">{money(s.approved)}</Td><Td className="tabular text-muted">{money(s.paid)}</Td></Tr>
            ))}
          </Table>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Select className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setSel(new Set()); }}>
            <option value="">{tr("كل الحالات", "All")}</option>{Object.entries(COMMISSION_STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
          </Select>
          <Select className="w-auto" value={source} onChange={(e) => setSource(e.target.value)}><option value="">{tr("كل المصادر", "All sources")}</option>{Object.entries(COMMISSION_SOURCE).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select>
          {staff.data && <Select className="w-auto" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">{tr("كل الموظفين", "All staff")}</option>{staff.data.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select>}
          <span className="ms-auto text-sm">{tr("المجموع", "Total")} <b className="tabular">{money(total)}</b></span>
          {approver && sel.size > 0 && <>
            <Button size="sm" loading={act.pending} onClick={() => bulk("APPROVE")}>{tr(`اعتماد (${sel.size})`, `Approve (${sel.size})`)}</Button>
            <Button size="sm" variant="ghost" className="text-danger" loading={act.pending} onClick={() => bulk("VOID")}>{tr("إلغاء", "Void")}</Button>
          </>}
        </div>
        <Table head={[approver ? <input key="all" type="checkbox" aria-label="select all" checked={!!data?.items.length && sel.size === data.items.filter((e) => ["PENDING", "APPROVED"].includes(e.status)).length} onChange={(e) => setSel(e.target.checked ? new Set(data!.items.filter((x) => ["PENDING", "APPROVED"].includes(x.status)).map((x) => x.id)) : new Set())} /> : "", tr("الموظف", "Staff"), tr("المصدر", "Source"), tr("الفاتورة", "Invoice"), tr("القاعدة", "Rule"), tr("المبلغ", "Amount"), tr("التاريخ", "Date"), tr("الحالة", "Status")]}>
          {loading && !data ? <LoadingRows cols={8} /> : data?.items.map((e) => (
            <Tr key={e.id}>
              <Td>{approver && ["PENDING", "APPROVED"].includes(e.status) && <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} aria-label="select" />}</Td>
              <Td>{e.user.fullName}</Td>
              <Td className="text-muted">{l4(COMMISSION_SOURCE, e.source, locale)}{e.note && <p className="text-xs">{e.note}</p>}</Td>
              <Td>{e.invoice ? <Link className="text-brand" dir="ltr" href={`/invoices/${e.invoice.id}`}>{e.invoice.code}</Link> : "—"}</Td>
              <Td className="text-xs text-muted tabular">{e.rateType === "PERCENT" ? `${Number(e.rateValue)}% × ${money(e.baseAmount)}` : money(e.rateValue)}</Td>
              <Td className={`font-medium tabular ${Number(e.amount) < 0 ? "text-danger" : ""}`}>{money(e.amount)}</Td>
              <Td className="whitespace-nowrap text-muted">{fmtDate(e.earnedAt, locale)}</Td>
              <Td><Badge tone={t4(COMMISSION_STATUS, e.status)}>{l4(COMMISSION_STATUS, e.status, locale)}</Badge></Td>
            </Tr>
          ))}
        </Table>
        {!loading && data?.items.length === 0 && <EmptyState title={tr("لا توجد عمولات", "No commissions")} />}
      </Card>
      <AdjustModal open={adj} staff={staff.data ?? []} onClose={() => setAdj(false)} onDone={() => { setAdj(false); reload(); }} />
    </>
  );
}

function AdjustModal({ open, staff, onClose, onDone }: { open: boolean; staff: Staff[]; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const [f, setF] = useState({ userId: "", amount: "", note: "" });
  const { pending, run } = useSubmit();
  return (
    <Modal open={open} onClose={onClose} title={tr("تسوية عمولة يدوية", "Manual commission adjustment")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button loading={pending} disabled={!f.userId || !Number(f.amount) || f.note.length < 2}
        onClick={async () => { if (await run(() => api("/api/commissions/adjust", { body: f }), tr("تمت الإضافة", "Added"))) { setF({ userId: "", amount: "", note: "" }); onDone(); } }}>{tr("حفظ", "Save")}</Button></>}>
      <div className="grid gap-3">
        <Field label={tr("الموظف", "Staff")}><Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select></Field>
        <Field label={tr("المبلغ (سالب للخصم)", "Amount (negative to deduct)")}><Input type="number" step="any" dir="ltr" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={tr("السبب", "Reason")}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

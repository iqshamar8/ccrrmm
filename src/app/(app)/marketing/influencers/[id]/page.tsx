"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import InfluencerModal, { PLATFORMS } from "@/components/marketing/InfluencerModal";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Comm = { id: string; source: string; baseAmount: string; amount: string; status: string; earnedAt: string; paidAt: string | null; note: string | null; invoice: { id: string; code: string } | null };
type Full = { id: string; name: string; handle: string | null; platform: string | null; phone: string | null; email: string | null; commissionType: string; commissionValue: string; attributionDays: number; notes: string | null; isActive: boolean;
  coupons: { id: string; code: string; name: string }[]; clients: { id: string; code: string; fullName: string; phone: string; status: string; createdAt: string; lastVisitAt: string | null }[]; commissions: Comm[] };
const ST: Record<string, [string, string, "gray" | "blue" | "green" | "red"]> = { PENDING: ["مستحقة", "Pending", "gray"], APPROVED: ["معتمدة", "Approved", "blue"], PAID: ["مدفوعة", "Paid", "green"], VOID: ["ملغاة", "Void", "red"] };
const SRC: Record<string, [string, string]> = { REFERRAL: ["عميل محال", "Referral"], COUPON: ["كود الخصم", "Coupon"], ADJUSTMENT: ["تسوية", "Adjustment"] };

export default function InfluencerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const { data, reload } = useResource<Full>(can("marketing.view") ? `/api/marketing/influencers/${id}` : null);
  const cash = useResource<{ id: string; name: string }[]>(can("finance.view_data") && (can("accounting.view") || can("invoices.view")) ? "/api/accounting/cash-accounts" : null);
  const coupons = useResource<{ id: string; code: string; name: string }[]>(can("coupons.view") ? "/api/coupons" : null);
  const [sel, setSel] = useState<string[]>([]);
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [codes, setCodes] = useState(false);
  const [cashId, setCashId] = useState("");
  const [adj, setAdj] = useState({ amount: "", note: "" });
  const { pending, run } = useSubmit();
  if (!can("marketing.view")) return <Forbidden />;
  if (!data) return <Card className="p-8 text-center text-muted">…</Card>;
  const sumBy = (st: string) => data.commissions.filter((c) => c.status === st).reduce((a, c) => a + Number(c.amount), 0);
  const act = async (action: "APPROVE" | "VOID") => { if (await run(() => api(`/api/marketing/influencers/${id}/commissions`, { method: "POST", body: { action, ids: sel } }), tr("تم", "Done"))) { setSel([]); reload(); } };
  const toggle = (cid: string) => setSel((s) => (s.includes(cid) ? s.filter((x) => x !== cid) : [...s, cid]));
  return (
    <>
      <PageHeader title={data.name} subtitle={[data.handle, data.platform ? PLATFORMS[data.platform] : null, data.phone].filter(Boolean).join(" · ")}
        actions={<div className="flex flex-wrap gap-2">
          <Link href="/marketing/influencers"><Button variant="secondary">{tr("رجوع", "Back")}</Button></Link>
          {can("marketing.update") && <Button variant="secondary" onClick={() => setEdit(true)}>{tr("تعديل", "Edit")}</Button>}
          {can("marketing.update") && can("coupons.view") && <Button variant="secondary" onClick={() => setCodes(true)}>{tr("أكواد الخصم", "Discount codes")}</Button>}
          {can("marketing.update") && can("finance.view_data") && sumBy("APPROVED") > 0 && <Button onClick={() => setPay(true)}>{tr("صرف العمولات المعتمدة", "Pay approved")} ({money(sumBy("APPROVED"))})</Button>}
        </div>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={tr("العمولة", "Commission")} value={data.commissionType === "PERCENT" ? `${Number(data.commissionValue)}%` : money(data.commissionValue)} hint={`${data.attributionDays} ${tr("يوم احتساب", "days attribution")}`} />
        <StatCard label={tr("مستحقة", "Pending")} value={money(sumBy("PENDING"))} />
        <StatCard label={tr("معتمدة", "Approved")} value={money(sumBy("APPROVED"))} />
        <StatCard label={tr("مدفوعة", "Paid")} value={money(sumBy("PAID"))} />
      </div>
      {data.coupons.length > 0 && <p className="mb-3 text-sm">{tr("أكواده:", "Codes:")} {data.coupons.map((c) => <Badge key={c.id} tone="brand">{c.code}</Badge>)}</p>}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
            <span className="font-medium">{tr("العمولات", "Commissions")}</span>
            {can("marketing.update") && sel.length > 0 && <div className="flex gap-1"><Button size="sm" loading={pending} onClick={() => act("APPROVE")}>{tr("اعتماد", "Approve")} ({sel.length})</Button><Button size="sm" variant="ghost" loading={pending} onClick={() => act("VOID")}>{tr("إلغاء", "Void")}</Button></div>}
          </div>
          <Table head={["", tr("التاريخ", "Date"), tr("المصدر", "Source"), tr("الفاتورة", "Invoice"), tr("الأساس", "Base"), tr("العمولة", "Amount"), tr("الحالة", "Status")]}>
            {data.commissions.map((c) => { const s = ST[c.status]; return (
              <Tr key={c.id}>
                <Td>{["PENDING", "APPROVED"].includes(c.status) && can("marketing.update") && <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} />}</Td>
                <Td className="text-xs text-muted">{fmtDate(c.earnedAt, locale)}</Td>
                <Td className="text-xs">{tr(...(SRC[c.source] ?? [c.source, c.source]))}{c.note && <div className="text-muted">{c.note}</div>}</Td>
                <Td>{c.invoice ? <Link className="font-mono text-xs text-brand hover:underline" dir="ltr" href={`/invoices/${c.invoice.id}`}>{c.invoice.code}</Link> : "—"}</Td>
                <Td className="tabular text-muted">{money(c.baseAmount)}</Td>
                <Td className={`tabular ${Number(c.amount) < 0 ? "text-danger" : ""}`}>{money(c.amount)}</Td>
                <Td><Badge tone={s[2]}>{tr(s[0], s[1])}</Badge></Td>
              </Tr>
            ); })}
          </Table>
          {!data.commissions.length && <EmptyState title={tr("لا توجد عمولات بعد", "No commissions yet")} />}
          {can("marketing.update") && <form className="flex flex-wrap items-end gap-2 border-t border-line p-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/api/marketing/influencers/${id}/adjust`, { method: "POST", body: { amount: Number(adj.amount), note: adj.note } }), tr("تمت إضافة التسوية", "Adjustment added"))) { setAdj({ amount: "", note: "" }); reload(); } }}>
            <Field label={tr("تسوية (+ مكافأة / − خصم)", "Adjustment (+ bonus / − deduction)")}><Input type="number" step="any" dir="ltr" required className="w-32" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
            <Field label={tr("السبب", "Reason")}><Input required minLength={2} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
            <Button type="submit" variant="secondary" loading={pending}>{tr("إضافة", "Add")}</Button>
          </form>}
        </Card>
        <Card>
          <div className="border-b border-line px-4 py-2 font-medium">{tr("العملاء القادمون عن طريقه", "Referred clients")} ({data.clients.length})</div>
          <Table head={[tr("العميل", "Client"), tr("انضم", "Joined"), tr("الحالة", "Status")]}>
            {data.clients.map((c) => <Tr key={c.id}><Td><Link className="text-brand hover:underline" href={`/clients/${c.id}`}>{c.fullName}</Link><div className="text-xs text-muted" dir="ltr">{c.phone}</div></Td><Td className="text-xs text-muted">{fmtDate(c.createdAt, locale)}</Td><Td><Badge tone={c.status === "ACTIVE" ? "green" : "gray"}>{c.status === "LEAD" ? tr("محتمل", "Lead") : c.status === "ACTIVE" ? tr("عميل", "Client") : c.status}</Badge></Td></Tr>)}
          </Table>
          {!data.clients.length && <EmptyState title={tr("لا يوجد عملاء", "No clients")} text={tr("اختر المؤثر في ملف العميل (حقل «جاء عن طريق مؤثر»).", "Pick the influencer on the client form (“Referred by influencer”).")} />}
        </Card>
      </div>
      <InfluencerModal x={edit ? data : null} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />
      <Modal open={pay} onClose={() => setPay(false)} title={tr("صرف العمولات المعتمدة", "Pay approved commissions")}
        footer={<><Button variant="secondary" onClick={() => setPay(false)}>{tr("رجوع", "Back")}</Button><Button loading={pending} onClick={async () => { if (await run(() => api(`/api/marketing/influencers/${id}/commissions`, { method: "POST", body: { action: "PAY", ids: [], cashAccountId: cashId || null } }), tr("تم الصرف وترحيل القيد", "Paid and posted"))) { setPay(false); reload(); } }}>{tr("صرف", "Pay")} {money(sumBy("APPROVED"))}</Button></>}>
        <p className="mb-3 text-sm">{tr("يُرحّل قيد: مدين مصروف التسويق / دائن الصندوق.", "Posts: Dr Marketing expense / Cr cash box.")}</p>
        <Field label={tr("يُصرف من", "Pay from")}><Select value={cashId} onChange={(e) => setCashId(e.target.value)}><option value="">{tr("الصندوق الافتراضي", "Default cash box")}</option>{(cash.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      </Modal>
      <CodesModal open={codes} onClose={() => setCodes(false)} id={id} all={coupons.data ?? []} current={data.coupons.map((c) => c.id)} onSaved={() => { setCodes(false); reload(); }} />
    </>
  );
}

function CodesModal({ open, onClose, id, all, current, onSaved }: { open: boolean; onClose: () => void; id: string; all: { id: string; code: string; name: string }[]; current: string[]; onSaved: () => void }) {
  const { tr } = useSession();
  const [sel, setSel] = useState<string[] | null>(null);
  const v = sel ?? current;
  const { pending, run } = useSubmit();
  return (
    <Modal open={open} onClose={() => { setSel(null); onClose(); }} title={tr("أكواد الخصم الخاصة بالمؤثر", "Influencer's discount codes")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button loading={pending} onClick={async () => { if (await run(() => api(`/api/marketing/influencers/${id}/coupons`, { method: "PUT", body: { couponIds: v } }), tr("تم الحفظ", "Saved"))) { setSel(null); onSaved(); } }}>{tr("حفظ", "Save")}</Button></>}>
      <p className="mb-2 text-xs text-muted">{tr("كل فاتورة مدفوعة تستخدم أحد هذه الأكواد تحتسب عمولة للمؤثر.", "Every paid invoice using one of these codes earns the influencer a commission.")}</p>
      <div className="max-h-72 space-y-1 overflow-y-auto">{all.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...v, c.id] : v.filter((x) => x !== c.id))} /><span dir="ltr" className="font-mono">{c.code}</span> <span className="text-muted">{c.name}</span></label>)}</div>
    </Modal>
  );
}

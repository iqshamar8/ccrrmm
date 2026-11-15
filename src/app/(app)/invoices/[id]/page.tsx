"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, Select, Spinner, Table, Td, Tr } from "@/components/ui";
import { useMoney } from "@/components/billing/useMoney";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { COMMISSION_SOURCE, COMMISSION_STATUS, INVOICE_STATUS, INVOICE_TYPE, l4, LINE_KIND, PAY_METHOD, t4 } from "@/lib/labels4";

export type InvoiceFull = {
  id: string; code: string | null; status: string; type: string; currency: string; issuedAt: string | null; dueDate: string | null; createdAt: string;
  subtotal: string; discountAmount: string; couponDiscount: string; loyaltyDiscount: string; taxTotal: string; total: string; paidTotal: string; refundedTotal: string; balance: string;
  loyaltyPointsRedeemed: number; notes: string | null; cancelReason: string | null; taxName: string; footer: string | null;
  client: { id: string; code: string; fullName: string; phone: string } | null; branch: { name: string; phone: string | null; address: string | null };
  coupon: { code: string; name: string } | null; salesStaff: { fullName: string } | null;
  tenant: { name: string; logoUrl: string | null; contactPhone: string | null; address: string | null; contactEmail: string | null };
  lines: { id: string; kind: string; description: string; quantity: string; unitPrice: string; discount: string; taxRate: string; lineTotal: string; taxAmount: string; performedBy: { fullName: string } | null }[];
  payments: { id: string; kind: string; receiptNo: string; amount: string; method: string; reference: string | null; note: string | null; paidAt: string }[];
  installments: { id: string; seq: number; dueDate: string; amount: string; paid: string; due: string; status: string }[];
  loyalty: { id: string; type: string; points: number; createdAt: string }[];
  commissions: { id: string; source: string; amount: string; status: string; user: { fullName: string } }[];
};

export default function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tr, locale, can } = useSession();
  const money = useMoney();
  const router = useRouter();
  const { data: inv, loading, reload } = useResource<InvoiceFull>(`/api/invoices/${id}`);
  const [dialog, setDialog] = useState<null | "pay" | "refund" | "cancel" | "delete">(null);
  const act = useSubmit();
  if (loading && !inv) return <div className="grid place-items-center py-24"><Spinner /></div>;
  if (!inv) return <Card><EmptyState title={tr("الفاتورة غير موجودة", "Invoice not found")} /></Card>;
  const open = ["ISSUED", "PARTIALLY_PAID"].includes(inv.status);
  const issue = async () => { if (await act.run(() => api(`/api/invoices/${id}/issue`, { body: {} }), tr("تم إصدار الفاتورة", "Invoice issued"))) reload(); };

  return (
    <>
      <Link href="/invoices" className="mb-3 inline-block text-sm text-muted hover:text-ink">← {tr("الفواتير", "Invoices")}</Link>
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold" dir="ltr">{inv.code ?? tr("مسودة فاتورة", "Draft invoice")}</h1>
              <Badge tone={t4(INVOICE_STATUS, inv.status)}>{l4(INVOICE_STATUS, inv.status, locale)}</Badge>
              <Badge>{l4(INVOICE_TYPE, inv.type, locale)}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {inv.client ? <Link className="text-brand" href={`/clients/${inv.client.id}`}>{inv.client.fullName}</Link> : tr("عميل نقدي", "Walk-in")} · {inv.branch.name}
              {inv.issuedAt && <> · {tr("صدرت", "Issued")} {fmtDate(inv.issuedAt, locale, true)}</>}{inv.dueDate && <> · {tr("تستحق", "Due")} {fmtDate(inv.dueDate, locale)}</>}
            </p>
            {inv.cancelReason && <p className="mt-1 text-sm text-muted">{tr("سبب الإلغاء:", "Cancelled:")} {inv.cancelReason}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {inv.status === "DRAFT" ? <>
              {can("invoices.update") && <Link href={`/invoices/new?draft=${id}`}><Button variant="secondary">{tr("تعديل", "Edit")}</Button></Link>}
              {can("invoices.delete") && <Button variant="ghost" className="text-danger" onClick={() => setDialog("delete")}>{tr("حذف", "Delete")}</Button>}
              <Button loading={act.pending} onClick={issue}>{tr("إصدار الفاتورة", "Issue invoice")}</Button>
            </> : <>
              <a href={`/print/invoices/${id}`} target="_blank" rel="noreferrer"><Button variant="secondary">{tr("طباعة", "Print")}</Button></a>
              {open && can("invoices.create") && <Button onClick={() => setDialog("pay")}>{tr("تسجيل دفعة", "Record payment")}</Button>}
              {Number(inv.paidTotal) > 0 && can("invoices.approve") && <Button variant="secondary" onClick={() => setDialog("refund")}>{tr("استرجاع", "Refund")}</Button>}
              {Number(inv.paidTotal) === 0 && inv.status !== "CANCELLED" && can("invoices.approve") && <Button variant="ghost" className="text-danger" onClick={() => setDialog("cancel")}>{tr("إلغاء الفاتورة", "Cancel invoice")}</Button>}
            </>}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <Table head={[tr("البند", "Item"), tr("الكمية", "Qty"), tr("السعر", "Price"), tr("الخصم", "Disc."), tr("الإجمالي", "Amount")]}>
              {inv.lines.map((l) => (
                <Tr key={l.id}>
                  <Td><p className="font-medium">{l.description}</p><p className="text-xs text-muted">{l4(LINE_KIND, l.kind, locale)}{l.performedBy && ` · ${l.performedBy.fullName}`}{Number(l.taxRate) > 0 && ` · ${tr("ضريبة", "tax")} ${Number(l.taxRate)}%`}</p></Td>
                  <Td className="tabular">{Number(l.quantity)}</Td><Td className="tabular">{money(l.unitPrice)}</Td>
                  <Td className="tabular text-muted">{Number(l.discount) ? money(l.discount) : "—"}</Td><Td className="font-medium tabular">{money(l.lineTotal)}</Td>
                </Tr>
              ))}
            </Table>
          </Card>
          <Card>
            <div className="border-b border-line px-4 py-3 font-medium">{tr("الدفعات والإيصالات", "Payments & receipts")}</div>
            {inv.payments.length === 0 ? <p className="p-6 text-center text-sm text-muted">{tr("لا توجد دفعات", "No payments yet")}</p> : (
              <Table head={[tr("الإيصال", "Receipt"), tr("التاريخ", "Date"), tr("الطريقة", "Method"), tr("المبلغ", "Amount"), ""]}>
                {inv.payments.map((p) => (
                  <Tr key={p.id}>
                    <Td><span dir="ltr">{p.receiptNo}</span>{p.kind === "REFUND" && <Badge tone="red">{tr("استرجاع", "Refund")}</Badge>}{p.note && <p className="text-xs text-muted">{p.note}</p>}</Td>
                    <Td className="whitespace-nowrap text-muted">{fmtDate(p.paidAt, locale, true)}</Td>
                    <Td>{l4(PAY_METHOD, p.method, locale)}{p.reference && <span className="text-xs text-muted" dir="ltr"> · {p.reference}</span>}</Td>
                    <Td className={`tabular font-medium ${p.kind === "REFUND" ? "text-danger" : ""}`}>{p.kind === "REFUND" ? "−" : ""}{money(p.amount)}</Td>
                    <Td className="text-end"><a className="text-xs text-brand" href={`/print/invoices/${id}?receipt=${p.id}`} target="_blank" rel="noreferrer">{tr("طباعة الإيصال", "Print receipt")}</a></Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Card>
          {inv.installments.length > 0 && (
            <Card>
              <div className="border-b border-line px-4 py-3 font-medium">{tr("جدول الأقساط", "Installment plan")}</div>
              <Table head={["#", tr("الاستحقاق", "Due"), tr("المبلغ", "Amount"), tr("المدفوع", "Paid"), tr("الحالة", "Status")]}>
                {inv.installments.map((x) => (
                  <Tr key={x.id}><Td>{x.seq}</Td><Td>{fmtDate(x.dueDate, locale)}</Td><Td className="tabular">{money(x.amount)}</Td><Td className="tabular">{money(x.paid)}</Td>
                    <Td><Badge tone={x.status === "PAID" ? "green" : x.status === "OVERDUE" ? "red" : x.status === "PARTIAL" ? "blue" : "gray"}>{x.status === "PAID" ? tr("مسدد", "Paid") : x.status === "OVERDUE" ? tr("متأخر", "Overdue") : x.status === "PARTIAL" ? tr("جزئي", "Partial") : tr("قادم", "Upcoming")}</Badge></Td></Tr>
                ))}
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <dl className="space-y-2 text-sm">
              <Row k={tr("المجموع", "Subtotal")} v={money(inv.subtotal)} />
              {Number(inv.discountAmount) > 0 && <Row k={tr("خصم", "Discount")} v={`−${money(inv.discountAmount)}`} />}
              {Number(inv.couponDiscount) > 0 && <Row k={`${tr("كوبون", "Coupon")} ${inv.coupon?.code ?? ""}`} v={`−${money(inv.couponDiscount)}`} />}
              {Number(inv.loyaltyDiscount) > 0 && <Row k={`${tr("نقاط", "Points")} (${inv.loyaltyPointsRedeemed})`} v={`−${money(inv.loyaltyDiscount)}`} />}
              {Number(inv.taxTotal) > 0 && <Row k={inv.taxName} v={money(inv.taxTotal)} />}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>{tr("الإجمالي", "Total")}</dt><dd className="tabular">{money(inv.total)}</dd></div>
              <Row k={tr("المدفوع", "Paid")} v={money(inv.paidTotal)} />
              {Number(inv.refundedTotal) > 0 && <Row k={tr("المسترد", "Refunded")} v={money(inv.refundedTotal)} />}
              {!["DRAFT", "CANCELLED"].includes(inv.status) && <div className={`flex justify-between font-semibold ${Number(inv.balance) > 0 ? "text-warning" : "text-success"}`}><dt>{tr("المتبقي", "Balance")}</dt><dd className="tabular">{money(inv.balance)}</dd></div>}
            </dl>
            {inv.salesStaff && <p className="mt-3 text-xs text-muted">{tr("موظف البيع:", "Sold by:")} {inv.salesStaff.fullName}</p>}
            {inv.notes && <p className="mt-2 rounded-lg bg-surface-2 p-2 text-xs">{inv.notes}</p>}
          </Card>
          {inv.loyalty.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 font-medium">{tr("نقاط الولاء", "Loyalty points")}</p>
              <ul className="space-y-1 text-sm">{inv.loyalty.map((t) => <li key={t.id} className="flex justify-between"><span className="text-muted">{t.type}</span><span className={`tabular ${t.points < 0 ? "text-danger" : "text-success"}`}>{t.points > 0 ? "+" : ""}{t.points}</span></li>)}</ul>
            </Card>
          )}
          {inv.commissions.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 font-medium">{tr("العمولات", "Commissions")}</p>
              <ul className="space-y-2 text-sm">{inv.commissions.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2"><span>{c.user.fullName} <span className="text-xs text-muted">· {l4(COMMISSION_SOURCE, c.source, locale)}</span></span>
                  <span className="flex items-center gap-1"><span className="tabular">{money(c.amount)}</span><Badge tone={t4(COMMISSION_STATUS, c.status)}>{l4(COMMISSION_STATUS, c.status, locale)}</Badge></span></li>
              ))}</ul>
            </Card>
          )}
        </div>
      </div>

      <PaymentModal open={dialog === "pay" || dialog === "refund"} refund={dialog === "refund"} invoice={inv} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      <CancelModal open={dialog === "cancel"} id={id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      <ConfirmModal open={dialog === "delete"} onClose={() => setDialog(null)} loading={act.pending} title={tr("حذف المسودة", "Delete draft")} text={tr("ستُحذف المسودة نهائياً.", "The draft will be deleted.")}
        confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")} onConfirm={async () => { if (await act.run(() => api(`/api/invoices/${id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) router.push("/invoices"); }} />
    </>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="tabular">{v}</dd></div>;

function PaymentModal({ open, refund, invoice, onClose, onDone }: { open: boolean; refund: boolean; invoice: InvoiceFull; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const money = useMoney();
  const max = Number(refund ? invoice.paidTotal : invoice.balance);
  const [f, setF] = useState({ amount: "", method: "CASH", reference: "", note: "" });
  const { pending, run } = useSubmit();
  useEffect(() => { if (open) setF({ amount: String(max), method: "CASH", reference: "", note: "" }); }, [open, max]);
  return (
    <Modal open={open} onClose={onClose} title={refund ? tr("استرجاع مبلغ", "Refund") : tr("تسجيل دفعة", "Record payment")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button variant={refund ? "danger" : "primary"} loading={pending} disabled={!Number(f.amount) || Number(f.amount) > max || (refund && f.note.trim().length < 2)}
        onClick={async () => {
          const ok = await run(() => api(`/api/invoices/${invoice.id}/${refund ? "refund" : "payments"}`, { body: refund ? { amount: f.amount, method: f.method, reason: f.note } : { amount: f.amount, method: f.method, reference: f.reference, note: f.note } }), refund ? tr("تم تسجيل الاسترجاع", "Refund recorded") : tr("تم تسجيل الدفعة وإصدار الإيصال", "Payment recorded"));
          if (ok) onDone();
        }}>{tr("تأكيد", "Confirm")}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{refund ? tr("الحد الأقصى للاسترجاع:", "Max refundable:") : tr("المتبقي:", "Balance due:")} <b className="tabular text-ink">{money(max)}</b></p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("المبلغ", "Amount")}><Input type="number" min={0} max={max} step="any" dir="ltr" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label={tr("الطريقة", "Method")}><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select></Field>
        </div>
        {!refund && f.method !== "CASH" && <Field label={tr("رقم المرجع / العملية", "Reference")}><Input dir="ltr" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>}
        <Field label={refund ? tr("سبب الاسترجاع (إلزامي)", "Reason (required)") : tr("ملاحظة", "Note")}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {refund && <p className="text-xs text-muted">{tr("تُعكس العمولات ونقاط الولاء المكتسبة بنسبة المبلغ المسترد.", "Earned commissions & loyalty are reversed pro-rata.")}</p>}
      </div>
    </Modal>
  );
}

function CancelModal({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const [reason, setReason] = useState("");
  const { pending, run } = useSubmit();
  return (
    <Modal open={open} onClose={onClose} title={tr("إلغاء الفاتورة", "Cancel invoice")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("رجوع", "Back")}</Button><Button variant="danger" loading={pending} disabled={reason.trim().length < 2}
        onClick={async () => { if (await run(() => api(`/api/invoices/${id}/cancel`, { body: { reason } }), tr("تم إلغاء الفاتورة", "Invoice cancelled"))) onDone(); }}>{tr("تأكيد الإلغاء", "Confirm")}</Button></>}>
      <p className="mb-3 text-sm text-muted">{tr("يبقى رقم الفاتورة محفوظاً في السجل. تعود الكوبونات والنقاط، ويمكن إعادة فوترة البنود المرتبطة.", "The number stays on record. Coupon & points are released; linked items can be billed again.")}</p>
      <Input autoFocus placeholder={tr("سبب الإلغاء", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";
import { fmtDate, fmtMoney } from "@/lib/i18n";

type Payment = { id: string; amount: string; method: string; reference: string | null; status: string; createdAt: string };
type Invoice = { id: string; number: string; total: string; currency: string; status: string; dueDate: string; issuedAt: string; plan: { nameAr: string; nameEn: string }; payments: Payment[] };

export default function SubscriptionBillingPage() {
  const s = useSession();
  const { tr, locale, can } = s;
  const allowed = can("settings.view") || (s.tenant?.access === "expired" && s.user.roleKey === "tenant_admin");
  const { data, loading, reload } = useResource<Invoice[]>(allowed ? "/api/platform/invoices" : null);
  if (!allowed) return <Forbidden />;
  return <>
    <PageHeader title={tr("اشتراك المنصة والفواتير", "Platform subscription & invoices")} subtitle={tr("تابع فواتير الاشتراك وسجّل التحويلات البنكية للسداد.", "Review subscription invoices and submit bank transfers for payment.")} />
    {s.tenant?.plan && <Card className="mb-4 p-4"><p className="text-xs text-muted">{tr("الباقة الحالية", "Current plan")}</p><p className="mt-1 font-semibold">{locale === "ar" ? s.tenant.plan.nameAr : s.tenant.plan.nameEn}</p>
      {s.tenant.subscription?.endsAt && <p className="mt-1 text-xs text-muted">{tr("تنتهي الفترة", "Current period ends")} {fmtDate(s.tenant.subscription.endsAt, locale)}</p>}</Card>}
    {loading && !data ? <div className="grid place-items-center py-16"><Spinner /></div> : data?.length ? <div className="grid gap-4">{data.map((invoice) => <InvoiceCard key={invoice.id} invoice={invoice} onSaved={reload} />)}</div>
      : <Card className="p-6 text-center text-sm text-muted">{tr("لا توجد فواتير حتى الآن. تواصل مع إدارة المنصة إذا كنت بحاجة إلى تجديد الاشتراك.", "No invoices yet. Contact the platform team if you need to renew your subscription.")}</Card>}
  </>;
}

function InvoiceCard({ invoice, onSaved }: { invoice: Invoice; onSaved: () => void }) {
  const { tr, locale } = useSession();
  const { pending, fields, run } = useSubmit();
  const confirmed = invoice.payments.filter((p) => p.status === "CONFIRMED").reduce((sum, p) => sum + Number(p.amount), 0);
  const pendingAmount = invoice.payments.filter((p) => p.status === "PENDING").reduce((sum, p) => sum + Number(p.amount), 0);
  const remaining = Math.max(0, Number(invoice.total) - confirmed - pendingAmount);
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const canPay = invoice.status === "ISSUED" && remaining > 0;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => api(`/api/platform/invoices/${invoice.id}/payments`, { method: "POST", body: { amount, method, reference } }), tr("تم تسجيل طلب الدفع للمراجعة", "Payment submitted for review"))) onSaved();
  }
  return <Card className="overflow-hidden">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
      <div><p className="font-semibold">{invoice.number}</p><p className="mt-1 text-xs text-muted">{locale === "ar" ? invoice.plan.nameAr : invoice.plan.nameEn} · {tr("تاريخ الإصدار", "Issued")} {fmtDate(invoice.issuedAt, locale)} · {tr("تستحق", "Due")} {fmtDate(invoice.dueDate, locale)}</p></div>
      <div className="text-end"><p className="font-semibold tabular">{fmtMoney(invoice.total, invoice.currency, locale)}</p><Badge tone={invoice.status === "PAID" ? "green" : invoice.status === "VOID" ? "gray" : "amber"}>{invoice.status}</Badge></div>
    </div>
    <div className="grid gap-3 p-4">
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span>{tr("المدفوع المؤكد", "Confirmed")} {fmtMoney(confirmed, invoice.currency, locale)}</span>
        <span>{tr("قيد المراجعة", "Pending review")} {fmtMoney(pendingAmount, invoice.currency, locale)}</span>
        <span>{tr("المتبقي", "Remaining")} {fmtMoney(remaining, invoice.currency, locale)}</span>
      </div>
      {invoice.payments.map((payment) => <div key={payment.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
        <span>{fmtMoney(payment.amount, invoice.currency, locale)} · {payment.method}</span>
        <Badge tone={payment.status === "CONFIRMED" ? "green" : payment.status === "REJECTED" ? "red" : "amber"}>{payment.status}</Badge>
        {payment.reference && <span dir="ltr" className="text-muted">{payment.reference}</span>}
        <span className="ms-auto text-muted">{fmtDate(payment.createdAt, locale)}</span>
      </div>)}
      {canPay && <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
        <Field label={tr("مبلغ التحويل", "Transfer amount")} error={fields.amount}><Input required type="number" min="0.01" max={remaining} step="0.01" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={tr("طريقة الدفع", "Payment method")}><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="BANK_TRANSFER">{tr("تحويل بنكي", "Bank transfer")}</option><option value="CARD">{tr("بطاقة", "Card")}</option><option value="CASH">{tr("نقداً", "Cash")}</option><option value="OTHER">{tr("أخرى", "Other")}</option></Select></Field>
        <Field label={tr("رقم مرجع التحويل", "Transfer reference")} error={fields.reference}><Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Button type="submit" loading={pending}>{tr("إرسال للمراجعة", "Submit for review")}</Button>
      </form>}
    </div>
  </Card>;
}

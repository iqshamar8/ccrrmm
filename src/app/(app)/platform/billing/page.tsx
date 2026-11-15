"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, PageHeader, Spinner, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";
import { fmtDate, fmtMoney } from "@/lib/i18n";

type Payment = { id: string; invoiceId: string; tenantId: string; amount: string; method: string; reference: string | null; status: string; createdAt: string };
type LifecycleReport = { at: string; scanned: number; invoicesIssued: number; reminders: number; expiredTrials: number; pastDue: number; expired: number; cancelled: number; errors: { subscriptionId: string; error: string }[] };
type Invoice = { id: string; number: string; tenantId: string; tenant: { name: string; slug: string }; plan: { nameAr: string; nameEn: string }; total: string; currency: string; status: string; dueDate: string; issuedAt: string; payments: Payment[] };

export default function PlatformBillingPage() {
  const s = useSession();
  const { tr, locale } = s;
  const { data, loading, reload } = useResource<Invoice[]>(s.user.isPlatformAdmin ? "/api/platform/invoices" : null);
  const [selected, setSelected] = useState<{ payment: Payment; status: "CONFIRMED" | "REJECTED" } | null>(null);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [lastRun, setLastRun] = useState<LifecycleReport | null>(null);
  const { pending, run } = useSubmit();
  if (!s.user.isPlatformAdmin) return <Forbidden />;

  async function runLifecycle() {
    let r: LifecycleReport | undefined;
    await run(async () => { r = await api<LifecycleReport>("/api/platform/lifecycle/run", { method: "POST" }); },
      tr("تم تشغيل دورة الاشتراكات", "Lifecycle run complete"));
    setLifecycleOpen(false);
    if (r) {
      setLastRun(r);
      reload();
    }
  }

  async function review() {
    if (!selected) return;
    const ok = await run(() => api(`/api/platform/payments/${selected.payment.id}`, { method: "PATCH", body: { status: selected.status } }),
      selected.status === "CONFIRMED" ? tr("تم تأكيد الدفعة", "Payment confirmed") : tr("تم رفض الدفعة", "Payment rejected"));
    setSelected(null);
    if (ok) reload();
  }

  return <>
    <PageHeader title={tr("فواتير المنصة", "Platform billing")} subtitle={tr("فواتير الاشتراكات وطلبات الدفع المعلّقة", "Subscription invoices and pending payment submissions")}
      actions={<Button variant="secondary" onClick={() => setLifecycleOpen(true)}>{tr("تشغيل دورة الاشتراكات", "Run lifecycle")}</Button>} />
    {lastRun && <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{tr("آخر تشغيل", "Last run")}: {fmtDate(lastRun.at, locale)}</span>
        <Badge tone="gray">{tr("تم فحص", "Scanned")} {lastRun.scanned}</Badge>
        <Badge tone="green">{tr("فواتير صادرة", "Invoices")} {lastRun.invoicesIssued}</Badge>
        <Badge tone="gray">{tr("تذكيرات", "Reminders")} {lastRun.reminders}</Badge>
        <Badge tone="amber">{tr("متأخرة", "Past due")} {lastRun.pastDue}</Badge>
        <Badge tone="red">{tr("منتهية", "Expired")} {lastRun.expired + lastRun.expiredTrials}</Badge>
        <Badge tone="gray">{tr("ملغاة", "Cancelled")} {lastRun.cancelled}</Badge>
        {lastRun.errors.length > 0 && <Badge tone="red">{tr("أخطاء", "Errors")} {lastRun.errors.length}</Badge>}
      </div>
    </Card>}
    <Card>
      {loading && !data ? <div className="grid place-items-center py-16"><Spinner /></div> : <Table head={[tr("المؤسسة / الفاتورة", "Organization / invoice"), tr("الباقة", "Plan"), tr("المبلغ", "Amount"), tr("الاستحقاق", "Due"), tr("الحالة", "Status"), tr("الدفعات", "Payments")]}>
        {data?.map((invoice) => <Tr key={invoice.id}>
          <Td><p className="font-medium">{invoice.tenant.name}</p><p className="text-xs text-muted" dir="ltr">{invoice.number}</p></Td>
          <Td>{locale === "ar" ? invoice.plan.nameAr : invoice.plan.nameEn}</Td>
          <Td className="tabular">{fmtMoney(invoice.total, invoice.currency, locale)}</Td>
          <Td className="text-muted">{fmtDate(invoice.dueDate, locale)}</Td>
          <Td><Badge tone={invoice.status === "PAID" ? "green" : invoice.status === "VOID" ? "gray" : "amber"}>{invoice.status}</Badge></Td>
          <Td><div className="grid gap-2">{invoice.payments.length ? invoice.payments.map((payment) => <div key={payment.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="tabular">{fmtMoney(payment.amount, invoice.currency, locale)}</span>
            <Badge tone={payment.status === "CONFIRMED" ? "green" : payment.status === "REJECTED" ? "red" : "amber"}>{payment.status}</Badge>
            {payment.reference && <span dir="ltr" className="text-muted">{payment.reference}</span>}
            {payment.status === "PENDING" && <>
              <Button size="sm" onClick={() => setSelected({ payment, status: "CONFIRMED" })}>{tr("تأكيد", "Confirm")}</Button>
              <Button size="sm" variant="danger" onClick={() => setSelected({ payment, status: "REJECTED" })}>{tr("رفض", "Reject")}</Button>
            </>}
          </div>) : <span className="text-muted">—</span>}</div></Td>
        </Tr>)}
      </Table>}
    </Card>
    <ConfirmModal open={!!selected} onClose={() => setSelected(null)} loading={pending} onConfirm={review}
      title={selected?.status === "CONFIRMED" ? tr("تأكيد استلام الدفعة؟", "Confirm payment received?") : tr("رفض طلب الدفع؟", "Reject payment submission?")}
      text={selected?.status === "CONFIRMED" ? tr("سيتم احتساب الدفعة وتفعيل الاشتراك عند اكتمال المبلغ.", "This payment will count toward the invoice; the subscription activates when paid in full.") : tr("لن تُحتسب هذه الدفعة ضمن الرصيد.", "This submission will not count toward the invoice balance.")}
      confirmLabel={tr("تأكيد", "Confirm")} cancelLabel={tr("رجوع", "Back")} />
    <ConfirmModal open={lifecycleOpen} onClose={() => setLifecycleOpen(false)} loading={pending} onConfirm={runLifecycle}
      title={tr("تشغيل دورة الاشتراكات الآن؟", "Run the subscription lifecycle now?")}
      text={tr("سيتم إصدار فواتير التجديد المستحقة، وإرسال التذكيرات، وتحويل الاشتراكات المتأخرة أو المنتهية. التشغيل آمن للتكرار.", "Due renewal invoices will be issued, reminders sent, and overdue or ended subscriptions transitioned. Safe to run repeatedly.")}
      confirmLabel={tr("تشغيل", "Run")} cancelLabel={tr("رجوع", "Back")} />
  </>;
}

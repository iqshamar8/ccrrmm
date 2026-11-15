"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import CampaignModal, { type Campaign } from "@/components/marketing/CampaignModal";
import { filterSummary } from "@/components/marketing/shared";
import { CAMPAIGN_STATUS, OBJECTIVE, STATUS } from "@/components/messaging/labels";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Full = Campaign & { template: { name: string; body: string } | null; offer: { title: string } | null; recipients: { id: string; status: string; body: string; sentAt: string | null; readAt: string | null; error: string | null; client: { id: string; fullName: string; code: string } | null }[] };

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const { data, reload } = useResource<Full>(can("marketing.view") ? `/api/marketing/campaigns/${id}` : null);
  const [edit, setEdit] = useState(false);
  const [launch, setLaunch] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [when, setWhen] = useState("");
  const { pending, run } = useSubmit();
  if (!can("marketing.view")) return <Forbidden />;
  if (!data) return <Card className="p-8 text-center text-muted">…</Card>;
  const s = data.stats, st = CAMPAIGN_STATUS[data.status];
  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <>
      <PageHeader title={data.name} subtitle={`${data.code} · ${tr(...(OBJECTIVE[data.objective] ?? [data.objective, data.objective]))} · ${data.segment?.name ?? filterSummary(data.filter ?? {}, tr)}`}
        actions={<div className="flex flex-wrap gap-2">
          <Link href="/marketing"><Button variant="secondary">{tr("رجوع", "Back")}</Button></Link>
          {can("marketing.update") && <Button variant="secondary" onClick={() => setEdit(true)}>{tr("تعديل", "Edit")}</Button>}
          {data.status === "DRAFT" && can("marketing.update") && can("notifications.create") && <Button onClick={() => setLaunch(true)}>{tr("إطلاق الحملة", "Launch")}</Button>}
          {["DRAFT", "SCHEDULED", "SENDING"].includes(data.status) && can("marketing.update") && <Button variant="ghost" onClick={() => setCancel(true)}>{tr("إلغاء الحملة", "Cancel campaign")}</Button>}
        </div>} />
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm"><Badge tone={st[2]}>{tr(st[0], st[1])}</Badge>
        {data.sentAt && <span className="text-muted">{data.status === "SCHEDULED" ? tr("مجدولة في", "Scheduled for") : tr("أُرسلت في", "Sent")} {fmtDate(data.sentAt, locale, true)}</span>}
        {data.coupon && <Badge tone="brand">{data.coupon.code}</Badge>}{data.offer && <span className="text-muted">{data.offer.title}</span>}
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={tr("المستلمون", "Recipients")} value={s.recipients} hint={s.queued ? `${s.queued} ${tr("بالانتظار", "queued")}` : undefined} />
        <StatCard label={tr("وصلت", "Delivered")} value={s.delivered} hint={rate(s.delivered, s.recipients)} />
        <StatCard label={tr("قُرئت", "Read")} value={s.read} hint={rate(s.read, s.delivered)} />
        <StatCard label={tr("تحويلات", "Conversions")} value={s.converted} hint={`${rate(s.converted, s.delivered)} · ${s.bookings} ${tr("حجز", "bookings")}`} />
        <StatCard label={tr("المبيعات", "Sales")} value={money(s.revenue)} hint={`${tr("خلال", "within")} ${data.attributionDays} ${tr("يوم", "days")}${s.redemptions ? ` · ${s.redemptions} ${tr("استخدام للكوبون", "coupon uses")}` : ""}`} />
        <StatCard label="ROI" value={s.roi === null ? "—" : <span className={s.roi < 0 ? "text-danger" : "text-success"}>{s.roi}%</span>} hint={`${tr("الميزانية", "Budget")} ${money(data.budget)}`} />
      </div>
      {(data.template || data.body) && <Card className="mb-4 p-4"><p className="mb-1 text-xs text-muted">{tr("نص الرسالة", "Message")}</p><p className="whitespace-pre-wrap text-sm">{data.template?.body ?? data.body}</p></Card>}
      <Card>
        <div className="border-b border-line px-4 py-2 font-medium">{tr("المستلمون", "Recipients")} {data.recipients.length < s.recipients && <span className="text-xs text-muted">({tr("آخر 200", "latest 200")})</span>}</div>
        <Table head={[tr("العميل", "Client"), tr("الحالة", "Status"), tr("أُرسلت", "Sent"), tr("قُرئت", "Read")]}>
          {data.recipients.map((m) => { const x = STATUS[m.status]; return (
            <Tr key={m.id}><Td>{m.client ? <Link className="text-brand hover:underline" href={`/clients/${m.client.id}`}>{m.client.fullName}</Link> : "—"}</Td>
              <Td><Badge tone={x[2]}>{tr(x[0], x[1])}</Badge>{m.error && <div className="text-xs text-danger">{m.error}</div>}</Td>
              <Td className="text-xs text-muted">{m.sentAt ? fmtDate(m.sentAt, locale, true) : "—"}</Td><Td className="text-xs text-muted">{m.readAt ? fmtDate(m.readAt, locale, true) : "—"}</Td></Tr>
          ); })}
        </Table>
        {!data.recipients.length && <EmptyState title={tr("لم تُطلق الحملة بعد", "Not launched yet")} />}
      </Card>
      <CampaignModal c={edit ? data : null} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />
      <Modal open={launch} onClose={() => setLaunch(false)} title={tr("إطلاق الحملة", "Launch campaign")}
        footer={<><Button variant="secondary" onClick={() => setLaunch(false)}>{tr("رجوع", "Back")}</Button><Button loading={pending} onClick={async () => {
          const r = await run(() => api<{ queued: number }>(`/api/marketing/campaigns/${id}/launch`, { method: "POST", body: { scheduledAt: when ? new Date(when).toISOString() : null } }), tr("تم إطلاق الحملة", "Campaign launched"));
          if (r) { setLaunch(false); reload(); }
        }}>{when ? tr("جدولة", "Schedule") : tr("إرسال الآن", "Send now")}</Button></>}>
        <p className="mb-3 text-sm">{tr("ستُرسل رسالة واتساب لكل عميل في الجمهور (باستثناء من أوقف الرسائل التسويقية). لا يمكن التراجع بعد الإرسال.", "Each client in the audience gets a WhatsApp message (opted-out clients excluded). This can't be undone once sent.")}</p>
        <Field label={tr("الإرسال في (اختياري)", "Send at (optional)")} hint={tr("اتركه فارغاً للإرسال فوراً. تُحترم ساعات الهدوء.", "Leave empty to send now. Quiet hours apply.")}><Input type="datetime-local" dir="ltr" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      </Modal>
      <ConfirmModal open={cancel} onClose={() => setCancel(false)} loading={pending} title={tr("إلغاء الحملة؟", "Cancel campaign?")} text={tr("تُلغى الرسائل التي لم تُرسل بعد.", "Messages not yet sent are cancelled.")}
        confirmLabel={tr("إلغاء الحملة", "Cancel campaign")} cancelLabel={tr("رجوع", "Back")} onConfirm={async () => { if (await run(() => api(`/api/marketing/campaigns/${id}/cancel`, { method: "POST", body: {} }), tr("تم الإلغاء", "Cancelled"))) { setCancel(false); reload(); } }} />
    </>
  );
}

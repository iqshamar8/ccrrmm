"use client";
import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, LoadingRows, PageHeader, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { MarketingTabs } from "@/components/marketing/shared";
import CampaignModal, { type Campaign, type Stats } from "@/components/marketing/CampaignModal";
import { CAMPAIGN_STATUS, OBJECTIVE } from "@/components/messaging/labels";
import { fmtDate } from "@/lib/i18n";

export default function CampaignsPage() {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Campaign[]>(can("marketing.view") ? "/api/marketing/campaigns" : null);
  const [edit, setEdit] = useState<Campaign | "new" | null>(null);
  if (!can("marketing.view")) return <Forbidden />;
  const rows = data ?? [];
  const sent = rows.filter((c) => c.sentAt);
  const tot = (k: keyof Stats) => sent.reduce((a, c) => a + Number(c.stats[k] ?? 0), 0);
  const budget = sent.reduce((a, c) => a + Number(c.budget), 0);
  return (
    <>
      <PageHeader title={tr("التسويق", "Marketing")} subtitle={tr("حملات واتساب موجهة لشرائح العملاء، مع قياس الاستلام والقراءة والتحويل إلى حجوزات ومبيعات والعائد على الإنفاق.", "Targeted WhatsApp campaigns with delivery, reads, conversions to bookings and sales, and return on spend.")}
        actions={can("marketing.create") && <Button onClick={() => setEdit("new")}>+ {tr("حملة", "Campaign")}</Button>} />
      <MarketingTabs active="campaigns" />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={tr("رسائل مرسلة", "Messages sent")} value={tot("sent").toLocaleString()} hint={tot("sent") ? `${Math.round((tot("read") / Math.max(1, tot("delivered"))) * 100)}% ${tr("قراءة", "read")}` : undefined} />
        <StatCard label={tr("عملاء تحولوا", "Converted clients")} value={tot("converted")} hint={`${tot("bookings")} ${tr("حجز", "bookings")}`} />
        <StatCard label={tr("مبيعات منسوبة للحملات", "Attributed sales")} value={money(tot("revenue"))} />
        <StatCard label={tr("العائد على الإنفاق", "Return on spend")} value={budget ? `${Math.round(((tot("revenue") - budget) / budget) * 100)}%` : "—"} hint={`${tr("الميزانية", "Budget")} ${money(budget)}`} />
      </div>
      <Card>
        <Table head={[tr("الحملة", "Campaign"), tr("الهدف", "Objective"), tr("الجمهور", "Audience"), tr("الإرسال", "Sent"), tr("مستلمة / مقروءة", "Delivered / read"), tr("تحويلات", "Conversions"), tr("المبيعات", "Sales"), tr("ROI", "ROI"), tr("الحالة", "Status")]}>
          {loading && !data ? <LoadingRows cols={9} /> : rows.map((c) => {
            const s = CAMPAIGN_STATUS[c.status];
            return (
              <Tr key={c.id}>
                <Td className="font-medium"><Link className="text-brand hover:underline" href={`/marketing/campaigns/${c.id}`}>{c.name}</Link><div className="text-xs text-muted" dir="ltr">{c.code}</div></Td>
                <Td className="text-sm">{tr(...(OBJECTIVE[c.objective] ?? [c.objective, c.objective]))}</Td>
                <Td className="text-xs text-muted">{c.segment?.name ?? tr("جمهور مخصص", "Custom audience")}</Td>
                <Td className="text-xs text-muted">{c.sentAt ? fmtDate(c.sentAt, locale, true) : "—"}</Td>
                <Td className="tabular text-sm">{c.stats.recipients ? <>{c.stats.delivered} / {c.stats.read}<div className="text-xs text-muted">{tr("من", "of")} {c.stats.recipients}{c.stats.failed ? ` · ${c.stats.failed} ${tr("فشل", "failed")}` : ""}</div></> : "—"}</Td>
                <Td className="tabular">{c.stats.converted || "—"}</Td>
                <Td className="tabular">{Number(c.stats.revenue) ? money(c.stats.revenue) : "—"}</Td>
                <Td className="tabular">{c.stats.roi === null ? "—" : <span className={c.stats.roi < 0 ? "text-danger" : "text-success"}>{c.stats.roi}%</span>}</Td>
                <Td><Badge tone={s[2]}>{tr(s[0], s[1])}</Badge>{c.status === "SCHEDULED" && c.scheduledAt && <div className="text-xs text-muted">{fmtDate(c.scheduledAt, locale, true)}</div>}</Td>
              </Tr>
            );
          })}
        </Table>
        {!loading && !rows.length && <EmptyState title={tr("لا توجد حملات بعد", "No campaigns yet")} />}
      </Card>
      <CampaignModal c={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

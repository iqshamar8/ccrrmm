"use client";
import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, LoadingRows, PageHeader, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { MarketingTabs } from "@/components/marketing/shared";
import InfluencerModal, { type Inf, PLATFORMS } from "@/components/marketing/InfluencerModal";

export default function InfluencersPage() {
  const { tr, can } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Inf[]>(can("marketing.view") ? "/api/marketing/influencers" : null);
  const [edit, setEdit] = useState<Inf | "new" | null>(null);
  if (!can("marketing.view")) return <Forbidden />;
  const rows = data ?? [];
  const sum = (k: keyof Inf["stats"]) => rows.reduce((a, r) => a + Number(r.stats[k]), 0);
  return (
    <>
      <PageHeader title={tr("التسويق", "Marketing")} subtitle={tr("المؤثرون: العملاء القادمون عن طريقهم، المبيعات، وعمولاتهم (تُحتسب عند السداد الكامل وتُعكس عند الاسترجاع).", "Influencers: referred clients, sales and commissions (earned on full payment, reversed on refunds).")}
        actions={can("marketing.create") && <Button onClick={() => setEdit("new")}>+ {tr("مؤثر", "Influencer")}</Button>} />
      <MarketingTabs active="influencers" />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={tr("عملاء عن طريق المؤثرين", "Referred clients")} value={sum("referred")} hint={`${sum("converted")} ${tr("تحولوا لعملاء", "converted")}`} />
        <StatCard label={tr("مبيعاتهم", "Their sales")} value={money(sum("revenue"))} hint={`${sum("invoices")} ${tr("فاتورة", "invoices")}`} />
        <StatCard label={tr("عمولات مستحقة", "Commission due")} value={money(sum("pending") + sum("approved"))} hint={`${money(sum("approved"))} ${tr("معتمدة", "approved")}`} />
        <StatCard label={tr("عمولات مدفوعة", "Commission paid")} value={money(sum("paid"))} />
      </div>
      <Card>
        <Table head={[tr("المؤثر", "Influencer"), tr("المنصة", "Platform"), tr("العمولة", "Commission"), tr("الكوبونات", "Codes"), tr("العملاء", "Clients"), tr("المبيعات", "Sales"), tr("مستحق", "Due"), tr("مدفوع", "Paid")]}>
          {loading && !data ? <LoadingRows cols={8} /> : rows.map((x) => (
            <Tr key={x.id}>
              <Td className="font-medium"><Link className="text-brand hover:underline" href={`/marketing/influencers/${x.id}`}>{x.name}</Link>{!x.isActive && <span className="ms-1"><Badge>{tr("موقوف", "Paused")}</Badge></span>}<div className="text-xs text-muted" dir="ltr">{x.handle}</div></Td>
              <Td className="text-sm">{x.platform ? PLATFORMS[x.platform] ?? x.platform : "—"}</Td>
              <Td className="tabular">{x.commissionType === "PERCENT" ? `${Number(x.commissionValue)}%` : x.commissionType === "FIXED" ? money(x.commissionValue) : "—"}<div className="text-xs text-muted">{x.attributionDays} {tr("يوم", "days")}</div></Td>
              <Td>{x.coupons.map((c) => <Badge key={c.id} tone="brand">{c.code}</Badge>)}</Td>
              <Td className="tabular">{x.stats.referred}<span className="text-xs text-muted"> / {x.stats.converted}</span></Td>
              <Td className="tabular">{money(x.stats.revenue)}</Td>
              <Td className="tabular">{money(Number(x.stats.pending) + Number(x.stats.approved))}</Td>
              <Td className="tabular text-muted">{money(x.stats.paid)}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && !rows.length && <EmptyState title={tr("لا يوجد مؤثرون", "No influencers")} />}
      </Card>
      <InfluencerModal x={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

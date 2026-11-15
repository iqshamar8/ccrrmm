"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { MarketingTabs } from "@/components/marketing/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Offer = { id: string; title: string; description: string | null; startsAt: string; endsAt: string; couponId: string | null; serviceIds: string[]; price: string | null; originalPrice: string | null; isActive: boolean;
  coupon: { code: string; _count: { redemptions: number } } | null; services: { id: string; name: string }[]; _count: { campaigns: number } };

export default function OffersPage() {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Offer[]>(can("marketing.view") ? "/api/marketing/offers" : null);
  const [edit, setEdit] = useState<Offer | "new" | null>(null);
  if (!can("marketing.view")) return <Forbidden />;
  const now = new Date().toISOString();
  return (
    <>
      <PageHeader title={tr("التسويق", "Marketing")} subtitle={tr("العروض والخصومات المنشورة: المدة، الخدمات المشمولة، السعر، والكوبون المرتبط لقياس الاستخدام.", "Published offers: period, services, price and a linked coupon to measure uptake.")}
        actions={can("marketing.create") && <Button onClick={() => setEdit("new")}>+ {tr("عرض", "Offer")}</Button>} />
      <MarketingTabs active="offers" />
      <Card>
        <Table head={[tr("العرض", "Offer"), tr("المدة", "Period"), tr("الخدمات", "Services"), tr("السعر", "Price"), tr("الكوبون / الاستخدام", "Coupon / uses"), tr("حملات", "Campaigns"), tr("الحالة", "Status")]}>
          {loading && !data ? <LoadingRows cols={7} /> : (data ?? []).map((o) => {
            const live = o.isActive && o.startsAt <= now && o.endsAt >= now;
            return (
              <Tr key={o.id} onClick={can("marketing.update") ? () => setEdit(o) : undefined}>
                <Td className="font-medium">{o.title}{o.description && <div className="text-xs text-muted">{o.description}</div>}</Td>
                <Td className="text-xs text-muted">{fmtDate(o.startsAt, locale)} → {fmtDate(o.endsAt, locale)}</Td>
                <Td className="text-xs">{o.services.map((s) => s.name).join("، ") || tr("كل الخدمات", "All services")}</Td>
                <Td className="tabular">{o.price ? <>{money(o.price)}{o.originalPrice && <div className="text-xs text-muted line-through">{money(o.originalPrice)}</div>}</> : "—"}</Td>
                <Td>{o.coupon ? <><Badge tone="brand">{o.coupon.code}</Badge> <span className="tabular text-xs text-muted">{o.coupon._count.redemptions}</span></> : "—"}</Td>
                <Td className="tabular">{o._count.campaigns}</Td>
                <Td><Badge tone={live ? "green" : o.endsAt < now ? "gray" : o.isActive ? "blue" : "gray"}>{live ? tr("ساري", "Live") : o.endsAt < now ? tr("منتهي", "Ended") : o.isActive ? tr("قادم", "Upcoming") : tr("موقوف", "Paused")}</Badge></Td>
              </Tr>
            );
          })}
        </Table>
        {!loading && !data?.length && <EmptyState title={tr("لا توجد عروض", "No offers")} />}
      </Card>
      <OfferModal o={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

function OfferModal({ o, onClose, onSaved }: { o: Offer | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const cat = useResource<{ services: { id: string; name: string }[] }>(o ? "/api/catalog?active=1" : null);
  const coupons = useResource<{ id: string; code: string; name: string }[]>(o ? "/api/coupons" : null);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const blank = { title: "", description: "", startsAt: d(new Date()), endsAt: d(new Date(Date.now() + 30 * 86400000)), couponId: "", serviceIds: [] as string[], price: "", originalPrice: "", isActive: true };
  const [f, setF] = useState(blank);
  const [for_, setFor] = useState<string | null>(null);
  const key = o === "new" ? "new" : o?.id ?? null;
  if (key !== for_) { setFor(key); setF(o && o !== "new" ? { title: o.title, description: o.description ?? "", startsAt: o.startsAt.slice(0, 10), endsAt: o.endsAt.slice(0, 10), couponId: o.couponId ?? "", serviceIds: o.serviceIds, price: o.price ? String(Number(o.price)) : "", originalPrice: o.originalPrice ? String(Number(o.originalPrice)) : "", isActive: o.isActive } : blank); }
  const { pending, fields, run } = useSubmit();
  const isNew = o === "new";
  return (
    <Modal open={!!o} onClose={onClose} wide title={isNew ? tr("عرض جديد", "New offer") : tr("تعديل العرض", "Edit offer")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="ofr" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="ofr" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f, couponId: f.couponId || null, price: f.price === "" ? null : Number(f.price), originalPrice: f.originalPrice === "" ? null : Number(f.originalPrice), startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(`${f.endsAt}T23:59:59`).toISOString() };
        if (await run(() => api(isNew ? "/api/marketing/offers" : `/api/marketing/offers/${(o as Offer).id}`, { method: isNew ? "POST" : "PATCH", body }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("عنوان العرض", "Title")} className="sm:col-span-2" error={fields.title}><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={tr("الوصف", "Description")} className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label={tr("من", "From")}><Input type="date" dir="ltr" required value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
        <Field label={tr("إلى", "To")} error={fields.endsAt}><Input type="date" dir="ltr" required value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        <Field label={tr("سعر العرض", "Offer price")}><Input type="number" min={0} step="any" dir="ltr" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label={tr("السعر الأصلي", "Original price")}><Input type="number" min={0} step="any" dir="ltr" value={f.originalPrice} onChange={(e) => setF({ ...f, originalPrice: e.target.value })} /></Field>
        <Field label={tr("الكوبون المرتبط", "Linked coupon")} hint={tr("لقياس عدد مرات الاستخدام والمبيعات", "To measure uses and sales")}><Select value={f.couponId} onChange={(e) => setF({ ...f, couponId: e.target.value })}><option value="">—</option>{(coupons.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</Select></Field>
        <Checkbox label={tr("فعّال", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        <Field label={tr("الخدمات المشمولة (فارغ = الكل)", "Services (empty = all)")} className="sm:col-span-2">
          <Select multiple className="h-32" value={f.serviceIds} onChange={(e) => setF({ ...f, serviceIds: [...e.target.selectedOptions].map((x) => x.value) })}>{(cat.data?.services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
      </form>
    </Modal>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import type { Catalog, Staff } from "@/components/appointments/shared";
import { useMoney } from "@/components/billing/useMoney";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Coupon = {
  id: string; code: string; name: string; type: "PERCENT" | "FIXED"; value: string; maxDiscount: string | null; minAmount: string | null; startsAt: string | null; endsAt: string | null;
  usageLimit: number | null; perClientLimit: number | null; allServices: boolean; serviceIds: string[]; clientIds: string[]; ownerUserId: string | null;
  commissionType: string; commissionValue: string; isActive: boolean; used: number; totalDiscount: string; owner: { fullName: string } | null;
};

export default function CouponsPage() {
  const { tr, locale, can } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Coupon[]>(can("coupons.view") ? "/api/coupons" : null);
  const [edit, setEdit] = useState<Coupon | "new" | null>(null);
  if (!can("coupons.view")) return <Forbidden />;
  const state = (c: Coupon) => {
    const now = Date.now();
    if (!c.isActive) return [tr("معطل", "Inactive"), "gray"] as const;
    if (c.endsAt && +new Date(c.endsAt) < now) return [tr("منتهي", "Expired"), "red"] as const;
    if (c.startsAt && +new Date(c.startsAt) > now) return [tr("لم يبدأ", "Scheduled"), "blue"] as const;
    if (c.usageLimit && c.used >= c.usageLimit) return [tr("استُنفد", "Used up"), "amber"] as const;
    return [tr("فعّال", "Active"), "green"] as const;
  };
  return (
    <>
      <PageHeader title={tr("الكوبونات والعروض", "Coupons")} subtitle={tr("أكواد الخصم، حدود الاستخدام، الخدمات والعملاء المستهدفون وعمولات المؤثرين", "Discount codes, limits, targeting and influencer commissions")}
        actions={can("coupons.create") && <Button onClick={() => setEdit("new")}>+ {tr("كوبون جديد", "New coupon")}</Button>} />
      <Card>
        <Table head={[tr("الكود", "Code"), tr("الخصم", "Discount"), tr("الصلاحية", "Validity"), tr("الاستخدام", "Usage"), tr("إجمالي الخصومات", "Total discount"), tr("صاحب العمولة", "Owner"), tr("الحالة", "Status")]}>
          {loading && !data ? <LoadingRows cols={7} /> : data?.map((c) => {
            const [label, tone] = state(c);
            return (
              <Tr key={c.id} onClick={can("coupons.update") ? () => setEdit(c) : undefined}>
                <Td><p className="font-mono font-semibold" dir="ltr">{c.code}</p><p className="text-xs text-muted">{c.name}</p></Td>
                <Td className="tabular">{c.type === "PERCENT" ? `${Number(c.value)}%` : money(c.value)}{c.maxDiscount && <p className="text-xs text-muted">{tr("حد أقصى", "max")} {money(c.maxDiscount)}</p>}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{c.startsAt || c.endsAt ? `${fmtDate(c.startsAt, locale)} – ${fmtDate(c.endsAt, locale)}` : tr("مفتوح", "Open")}</Td>
                <Td className="tabular">{c.used}{c.usageLimit ? ` / ${c.usageLimit}` : ""}</Td>
                <Td className="tabular">{money(c.totalDiscount)}</Td>
                <Td className="text-muted">{c.owner?.fullName ?? "—"}{c.commissionType !== "NONE" && <p className="text-xs">{c.commissionType === "PERCENT" ? `${Number(c.commissionValue)}%` : money(c.commissionValue)}</p>}</Td>
                <Td><Badge tone={tone}>{label}</Badge></Td>
              </Tr>
            );
          })}
        </Table>
        {!loading && data?.length === 0 && <EmptyState title={tr("لا توجد كوبونات", "No coupons")} />}
      </Card>
      <CouponModal coupon={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

function CouponModal({ coupon, onClose, onSaved }: { coupon: Coupon | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr, can } = useSession();
  const isNew = coupon === "new";
  const cat = useResource<Catalog>(coupon ? "/api/catalog?active=1" : null);
  const staff = useResource<Staff[]>(coupon ? "/api/staff" : null);
  const blank = { code: "", name: "", type: "PERCENT", value: "10", maxDiscount: "", minAmount: "", startsAt: "", endsAt: "", usageLimit: "", perClientLimit: "", allServices: true, serviceIds: [] as string[], clientIds: [] as string[], ownerUserId: "", commissionType: "NONE", commissionValue: "0", isActive: true };
  const [f, setF] = useState(blank);
  const { pending, fields, run } = useSubmit();
  const del = useSubmit();
  useEffect(() => {
    if (coupon === "new") setF(blank);
    else if (coupon) setF({ ...blank, ...coupon, value: String(Number(coupon.value)), maxDiscount: coupon.maxDiscount ? String(Number(coupon.maxDiscount)) : "", minAmount: coupon.minAmount ? String(Number(coupon.minAmount)) : "",
      startsAt: coupon.startsAt?.slice(0, 10) ?? "", endsAt: coupon.endsAt?.slice(0, 10) ?? "", usageLimit: String(coupon.usageLimit ?? ""), perClientLimit: String(coupon.perClientLimit ?? ""),
      ownerUserId: coupon.ownerUserId ?? "", commissionValue: String(Number(coupon.commissionValue)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupon]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open={!!coupon} onClose={onClose} wide title={isNew ? tr("كوبون جديد", "New coupon") : tr("تعديل الكوبون", "Edit coupon")}
      footer={<div className="flex w-full justify-between">
        <div>{!isNew && can("coupons.delete") && <Button variant="ghost" className="text-danger" loading={del.pending} onClick={async () => { if (await del.run(() => api(`/api/coupons/${(coupon as Coupon).id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) onSaved(); }}>{tr("حذف", "Delete")}</Button>}</div>
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="cp" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></div>
      </div>}>
      <form id="cp" className="grid gap-4 sm:grid-cols-3" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f, startsAt: f.startsAt ? new Date(`${f.startsAt}T00:00:00`) : null, endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59`) : null };
        if (await run(() => api(isNew ? "/api/coupons" : `/api/coupons/${(coupon as Coupon).id}`, { method: isNew ? "POST" : "PATCH", body }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("الكود", "Code")} error={fields.code}><Input required dir="ltr" className="font-mono uppercase" value={f.code} onChange={set("code")} placeholder="SUMMER25" /></Field>
        <Field label={tr("الاسم / الوصف", "Name")} error={fields.name} className="sm:col-span-2"><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label={tr("نوع الخصم", "Type")}><Select value={f.type} onChange={set("type")}><option value="PERCENT">{tr("نسبة %", "Percentage")}</option><option value="FIXED">{tr("مبلغ ثابت", "Fixed amount")}</option></Select></Field>
        <Field label={tr("القيمة", "Value")} error={fields.value}><Input type="number" min={0} step="any" dir="ltr" value={f.value} onChange={set("value")} /></Field>
        <Field label={tr("أقصى خصم (اختياري)", "Max discount")}><Input type="number" min={0} step="any" dir="ltr" value={f.maxDiscount} onChange={set("maxDiscount")} /></Field>
        <Field label={tr("من تاريخ", "Starts")}><Input type="date" dir="ltr" value={f.startsAt} onChange={set("startsAt")} /></Field>
        <Field label={tr("إلى تاريخ", "Ends")} error={fields.endsAt}><Input type="date" dir="ltr" value={f.endsAt} onChange={set("endsAt")} /></Field>
        <Field label={tr("حد أدنى للفاتورة", "Min invoice")}><Input type="number" min={0} step="any" dir="ltr" value={f.minAmount} onChange={set("minAmount")} /></Field>
        <Field label={tr("عدد مرات الاستخدام الكلي", "Total uses")}><Input type="number" min={1} dir="ltr" value={f.usageLimit} onChange={set("usageLimit")} /></Field>
        <Field label={tr("مرات لكل عميل", "Uses per client")}><Input type="number" min={1} dir="ltr" value={f.perClientLimit} onChange={set("perClientLimit")} /></Field>
        <div className="flex items-end pb-2"><Checkbox label={tr("فعّال", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></div>
        <div className="sm:col-span-3 border-t border-line pt-4">
          <Checkbox label={tr("يشمل كل الخدمات والمنتجات", "Applies to everything")} checked={f.allServices} onChange={(e) => setF({ ...f, allServices: e.target.checked })} />
          {!f.allServices && <div className="mt-3 grid gap-2 sm:grid-cols-3">{cat.data?.services.map((s) => <Checkbox key={s.id} label={s.name} checked={f.serviceIds.includes(s.id)} onChange={() => setF((x) => ({ ...x, serviceIds: x.serviceIds.includes(s.id) ? x.serviceIds.filter((y) => y !== s.id) : [...x.serviceIds, s.id] }))} />)}</div>}
        </div>
        <div className="sm:col-span-3 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
          <Field label={tr("صاحب الكود (مؤثر/موظف)", "Code owner")}><Select value={f.ownerUserId} onChange={set("ownerUserId")}><option value="">—</option>{staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select></Field>
          <Field label={tr("عمولة الكوبون", "Commission")}><Select value={f.commissionType} onChange={set("commissionType")}><option value="NONE">{tr("بدون", "None")}</option><option value="PERCENT">%</option><option value="FIXED">{tr("مبلغ لكل استخدام", "Fixed per use")}</option></Select></Field>
          <Field label={tr("قيمة العمولة", "Commission value")}><Input type="number" min={0} step="any" dir="ltr" disabled={f.commissionType === "NONE"} value={f.commissionValue} onChange={set("commissionValue")} /></Field>
        </div>
        {f.clientIds.length > 0 && <p className="sm:col-span-3 text-xs text-muted">{tr(`مخصص لـ ${f.clientIds.length} عميل.`, `Targeted to ${f.clientIds.length} clients.`)}</p>}
      </form>
    </Modal>
  );
}

"use client";
import { useState } from "react";
import { useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Checkbox, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/client";

export type Inf = { id: string; name: string; handle: string | null; platform: string | null; phone: string | null; email: string | null; commissionType: string; commissionValue: string; attributionDays: number; notes: string | null; isActive: boolean;
  coupons: { id: string; code: string }[]; stats: { referred: number; converted: number; invoices: number; revenue: string; pending: string; approved: string; paid: string } };
export const PLATFORMS: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", snapchat: "Snapchat", youtube: "YouTube", facebook: "Facebook", other: "Other" };

export default function InfluencerModal({ x, onClose, onSaved }: { x: Omit<Inf, "stats" | "coupons"> | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const blank = { name: "", handle: "", platform: "instagram", phone: "", email: "", commissionType: "PERCENT", commissionValue: "10", attributionDays: "90", notes: "", isActive: true };
  const [f, setF] = useState(blank);
  const [for_, setFor] = useState<string | null>(null);
  const key = x === "new" ? "new" : x?.id ?? null;
  if (key !== for_) { setFor(key); setF(x && x !== "new" ? { name: x.name, handle: x.handle ?? "", platform: x.platform ?? "other", phone: x.phone ?? "", email: x.email ?? "", commissionType: x.commissionType, commissionValue: String(Number(x.commissionValue)), attributionDays: String(x.attributionDays), notes: x.notes ?? "", isActive: x.isActive } : blank); }
  const { pending, fields, run } = useSubmit();
  const isNew = x === "new";
  return (
    <Modal open={!!x} onClose={onClose} title={isNew ? tr("مؤثر جديد", "New influencer") : tr("تعديل المؤثر", "Edit influencer")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="inf" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="inf" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(isNew ? "/api/marketing/influencers" : `/api/marketing/influencers/${(x as Inf).id}`, { method: isNew ? "POST" : "PATCH", body: { ...f, commissionValue: Number(f.commissionValue), attributionDays: Number(f.attributionDays) } }), tr("تم الحفظ", "Saved"))) onSaved(); }}>
        <Field label={tr("الاسم", "Name")} error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("الحساب", "Handle")}><Input dir="ltr" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} placeholder="@name" /></Field>
        <Field label={tr("المنصة", "Platform")}><Select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label={tr("الهاتف", "Phone")}><Input dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label={tr("نوع العمولة", "Commission")}><Select value={f.commissionType} onChange={(e) => setF({ ...f, commissionType: e.target.value })}><option value="PERCENT">{tr("نسبة من صافي الفاتورة", "% of invoice net")}</option><option value="FIXED">{tr("مبلغ ثابت لكل فاتورة", "Fixed per invoice")}</option><option value="NONE">{tr("بدون عمولة", "None")}</option></Select></Field>
        <Field label={tr("القيمة", "Value")} error={fields.commissionValue}><Input type="number" min={0} step="any" dir="ltr" value={f.commissionValue} onChange={(e) => setF({ ...f, commissionValue: e.target.value })} /></Field>
        <Field label={tr("مدة احتساب العميل (يوم)", "Attribution (days)")} hint={tr("فواتير العميل المحال خلال هذه المدة من انضمامه", "Referred client's invoices within this many days of joining")}><Input type="number" min={1} max={3650} dir="ltr" value={f.attributionDays} onChange={(e) => setF({ ...f, attributionDays: e.target.value })} /></Field>
        <Field label={tr("البريد", "Email")} error={fields.email}><Input type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={tr("ملاحظات", "Notes")} className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Checkbox label={tr("فعّال", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
      </form>
    </Modal>
  );
}

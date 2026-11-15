"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { AudienceBuilder, type Filter } from "@/components/marketing/shared";
import { CATEGORY, OBJECTIVE } from "@/components/messaging/labels";
import { api } from "@/lib/client";

export type Stats = { recipients: number; sent: number; delivered: number; read: number; failed: number; queued: number; converted: number; bookings: number; revenue: string; newClients: number; redemptions: number; roi: number | null };
export type Campaign = { id: string; code: string; name: string; objective: string; status: string; segmentId: string | null; filter: Filter; templateId: string | null; body: string | null; couponId: string | null; offerId: string | null; budget: string; scheduledAt: string | null; sentAt: string | null; attributionDays: number; notes: string | null; segment: { name: string } | null; coupon: { code: string } | null; stats: Stats };

export default function CampaignModal({ c, onClose, onSaved }: { c: Campaign | "new" | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const { tr } = useSession();
  const isNew = c === "new";
  const segs = useResource<{ id: string; name: string; filter: Filter; size: number }[]>(c ? "/api/marketing/segments" : null);
  const tpls = useResource<{ id: string; category: string; name: string; body: string; isActive: boolean }[]>(c ? "/api/messaging/templates" : null);
  const coupons = useResource<{ id: string; code: string; name: string; isActive: boolean }[]>(c ? "/api/coupons" : null);
  const offers = useResource<{ id: string; title: string; isActive: boolean }[]>(c ? "/api/marketing/offers" : null);
  const blank = { name: "", objective: "PROMOTION", segmentId: "", filter: { statuses: ["ACTIVE"] } as Filter, templateId: "", body: "", couponId: "", offerId: "", budget: "0", attributionDays: "30", notes: "" };
  const [f, setF] = useState(blank);
  const [for_, setFor] = useState<string | null>(null);
  const key = c === "new" ? "new" : c?.id ?? null;
  if (key !== for_) {
    setFor(key);
    setF(c && c !== "new" ? { name: c.name, objective: c.objective, segmentId: c.segmentId ?? "", filter: c.filter ?? {}, templateId: c.templateId ?? "", body: c.body ?? "", couponId: c.couponId ?? "", offerId: c.offerId ?? "", budget: String(Number(c.budget)), attributionDays: String(c.attributionDays), notes: c.notes ?? "" } : blank);
  }
  const { pending, fields, run } = useSubmit();
  const locked = c !== "new" && c?.status !== "DRAFT";
  const couponList = Array.isArray(coupons.data) ? coupons.data : ((coupons.data as unknown as { items?: { id: string; code: string; name: string; isActive: boolean }[] })?.items ?? []);
  return (
    <Modal open={!!c} onClose={onClose} wide title={isNew ? tr("حملة جديدة", "New campaign") : tr("تعديل الحملة", "Edit campaign")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="camp" type="submit" loading={pending}>{tr("حفظ كمسودة", "Save draft")}</Button></>}>
      <form id="camp" className="grid gap-4 lg:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f, segmentId: f.segmentId || null, templateId: f.templateId || null, body: f.templateId ? null : f.body || null, couponId: f.couponId || null, offerId: f.offerId || null, budget: Number(f.budget), attributionDays: Number(f.attributionDays), filter: f.segmentId ? undefined : f.filter };
        const r = await run(() => api<{ id: string }>(isNew ? "/api/marketing/campaigns" : `/api/marketing/campaigns/${(c as Campaign).id}`, { method: isNew ? "POST" : "PATCH", body }), tr("تم الحفظ", "Saved"));
        if (r) onSaved(r.id);
      }}>
        <div className="space-y-3">
          <Field label={tr("اسم الحملة", "Campaign name")} error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr("الهدف", "Objective")}><Select disabled={locked} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })}>{Object.entries(OBJECTIVE).map(([k, v]) => <option key={k} value={k}>{tr(v[0], v[1])}</option>)}</Select></Field>
            <Field label={tr("الميزانية (إعلانات، تصميم…)", "Budget (ads, design…)")}><Input type="number" min={0} step="any" dir="ltr" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></Field>
            <Field label={tr("كوبون الحملة", "Campaign coupon")}><Select disabled={locked} value={f.couponId} onChange={(e) => setF({ ...f, couponId: e.target.value })}><option value="">—</option>{couponList.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</Select></Field>
            <Field label={tr("العرض المرتبط", "Linked offer")}><Select disabled={locked} value={f.offerId} onChange={(e) => setF({ ...f, offerId: e.target.value })}><option value="">—</option>{(offers.data ?? []).filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</Select></Field>
            <Field label={tr("نافذة احتساب التحويل (يوم)", "Attribution window (days)")}><Input type="number" min={1} max={365} dir="ltr" value={f.attributionDays} onChange={(e) => setF({ ...f, attributionDays: e.target.value })} /></Field>
          </div>
          <Field label={tr("القالب", "Template")}>
            <Select disabled={locked} value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
              <option value="">{tr("— رسالة مكتوبة —", "— write a message —")}</option>
              {(tpls.data ?? []).filter((t) => t.isActive && ["PROMOTION", "REACTIVATION", "BIRTHDAY", "CUSTOM"].includes(t.category)).map((t) => <option key={t.id} value={t.id}>{tr(CATEGORY[t.category][0], CATEGORY[t.category][1])} — {t.name}</option>)}
            </Select>
          </Field>
          {f.templateId ? <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{tpls.data?.find((t) => t.id === f.templateId)?.body}</p> : (
            <Field label={tr("نص الرسالة", "Message")} hint={tr("المتغيرات: {{client_name}} {{clinic_name}} {{coupon_code}} {{offer}}", "Variables: {{client_name}} {{clinic_name}} {{coupon_code}} {{offer}}")} error={fields.body}>
              <textarea disabled={locked} rows={5} maxLength={1024} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
            </Field>
          )}
          <Field label={tr("ملاحظات", "Notes")}><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <div className="space-y-3">
          <Field label={tr("الجمهور", "Audience")}>
            <Select disabled={locked} value={f.segmentId} onChange={(e) => setF({ ...f, segmentId: e.target.value })}>
              <option value="">{tr("— تحديد مخصص —", "— custom filter —")}</option>
              {(segs.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.size})</option>)}
            </Select>
          </Field>
          {!locked && <AudienceBuilder value={f.segmentId ? segs.data?.find((s) => s.id === f.segmentId)?.filter ?? f.filter : f.filter} onChange={(v) => setF({ ...f, segmentId: "", filter: v })} />}
          {locked && <p className="text-sm text-muted">{tr("بعد الإطلاق يمكن تعديل الاسم والميزانية ونافذة التحويل فقط.", "After launch only the name, budget and attribution window can change.")}</p>}
        </div>
      </form>
    </Modal>
  );
}

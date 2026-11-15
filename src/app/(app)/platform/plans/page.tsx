"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, Field, Input, LoadingRows, Modal, PageHeader, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";
import { fmtMoney } from "@/lib/i18n";
import { MODULES } from "@/lib/permissions";
import type { PlanRow } from "@/lib/types";

const OPTIONAL = MODULES.filter((m) => !m.core);

export default function PlansPage() {
  const s = useSession();
  const { tr, locale } = s;
  const { data, loading, reload } = useResource<PlanRow[]>(s.user.isPlatformAdmin ? "/api/platform/plans" : null);
  const [editing, setEditing] = useState<PlanRow | "new" | null>(null);
  if (!s.user.isPlatformAdmin) return <Forbidden />;

  return (
    <>
      <PageHeader title={tr("الباقات والاشتراكات", "Plans")} subtitle={tr("حدد الأسعار والحدود والأقسام المتاحة لكل باقة", "Pricing, limits and the modules each plan unlocks")}
        actions={<Button onClick={() => setEditing("new")}>+ {tr("باقة جديدة", "New plan")}</Button>} />
      <Card>
        <Table head={[tr("الباقة", "Plan"), tr("شهري", "Monthly"), tr("سنوي", "Yearly"), tr("التجربة", "Trial"), tr("المستخدمون", "Users"), tr("الفروع", "Branches"), tr("الأقسام", "Modules"), tr("مشتركون", "Subscribers"), tr("الحالة", "Status")]}>
          {loading ? <LoadingRows cols={9} /> : data?.map((p) => (
            <Tr key={p.id} onClick={() => setEditing(p)}>
              <Td><p className="font-medium">{locale === "ar" ? p.nameAr : p.nameEn}</p><p className="text-xs text-muted" dir="ltr">{p.code}</p></Td>
              <Td className="tabular">{fmtMoney(p.priceMonthly, p.currency, locale)}</Td>
              <Td className="tabular">{fmtMoney(p.priceYearly, p.currency, locale)}</Td>
              <Td className="tabular">{p.trialDays} {tr("يوم", "d")}</Td>
              <Td className="tabular">{p.maxUsers}</Td>
              <Td className="tabular">{p.maxBranches}</Td>
              <Td className="tabular">{p.features.length} / {OPTIONAL.length}</Td>
              <Td className="tabular">{p.activeSubscriptions}</Td>
              <Td><Badge tone={p.isActive ? "green" : "gray"}>{p.isActive ? tr("متاحة", "Active") : tr("موقوفة", "Inactive")}</Badge></Td>
            </Tr>
          ))}
        </Table>
      </Card>
      <PlanModal plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
    </>
  );
}

const empty = {
  code: "", nameAr: "", nameEn: "", description: "", priceMonthly: "0", priceYearly: "0", currency: "USD", trialDays: "14",
  maxUsers: "5", maxBranches: "1", storageMb: "1024", features: [] as string[], isActive: true, sortOrder: "0",
};

function PlanModal({ plan, onClose, onSaved }: { plan: PlanRow | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr, locale } = useSession();
  const { pending, fields, run } = useSubmit();
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (plan === "new") setF(empty);
    else if (plan) setF({
      code: plan.code, nameAr: plan.nameAr, nameEn: plan.nameEn, description: plan.description ?? "", priceMonthly: String(plan.priceMonthly),
      priceYearly: String(plan.priceYearly), currency: plan.currency, trialDays: String(plan.trialDays), maxUsers: String(plan.maxUsers),
      maxBranches: String(plan.maxBranches), storageMb: String(plan.storageMb), features: plan.features, isActive: plan.isActive, sortOrder: String(plan.sortOrder),
    });
  }, [plan]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const toggle = (k: string) => setF((x) => ({ ...x, features: x.features.includes(k) ? x.features.filter((y) => y !== k) : [...x.features, k] }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const isNew = plan === "new";
    const ok = await run(() => api(isNew ? "/api/platform/plans" : `/api/platform/plans/${(plan as PlanRow).id}`, { method: isNew ? "POST" : "PATCH", body: f }), tr("تم حفظ الباقة", "Plan saved"));
    if (ok) onSaved();
  }

  return (
    <Modal open={!!plan} onClose={onClose} wide title={plan === "new" ? tr("باقة جديدة", "New plan") : tr("تعديل الباقة", "Edit plan")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="plan" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="plan" onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <Field label={tr("الرمز", "Code")} error={fields.code}><Input required dir="ltr" value={f.code} onChange={set("code")} /></Field>
        <Field label={tr("الاسم بالعربية", "Arabic name")} error={fields.nameAr}><Input required value={f.nameAr} onChange={set("nameAr")} /></Field>
        <Field label={tr("الاسم بالإنجليزية", "English name")} error={fields.nameEn}><Input required dir="ltr" value={f.nameEn} onChange={set("nameEn")} /></Field>
        <Field label={tr("الوصف", "Description")} className="sm:col-span-3"><Input value={f.description} onChange={set("description")} /></Field>
        <Field label={tr("السعر الشهري", "Monthly price")} error={fields.priceMonthly}><Input type="number" min="0" step="0.01" dir="ltr" value={f.priceMonthly} onChange={set("priceMonthly")} /></Field>
        <Field label={tr("السعر السنوي", "Yearly price")} error={fields.priceYearly}><Input type="number" min="0" step="0.01" dir="ltr" value={f.priceYearly} onChange={set("priceYearly")} /></Field>
        <Field label={tr("العملة", "Currency")} error={fields.currency}><Input dir="ltr" maxLength={3} value={f.currency} onChange={set("currency")} /></Field>
        <Field label={tr("أيام التجربة", "Trial days")} error={fields.trialDays}><Input type="number" min="0" dir="ltr" value={f.trialDays} onChange={set("trialDays")} /></Field>
        <Field label={tr("الحد الأقصى للمستخدمين", "Max users")} error={fields.maxUsers}><Input type="number" min="1" dir="ltr" value={f.maxUsers} onChange={set("maxUsers")} /></Field>
        <Field label={tr("الحد الأقصى للفروع", "Max branches")} error={fields.maxBranches}><Input type="number" min="1" dir="ltr" value={f.maxBranches} onChange={set("maxBranches")} /></Field>
        <Field label={tr("مساحة التخزين (MB)", "Storage (MB)")} error={fields.storageMb}><Input type="number" min="100" dir="ltr" value={f.storageMb} onChange={set("storageMb")} /></Field>
        <Field label={tr("ترتيب العرض", "Sort order")}><Input type="number" dir="ltr" value={f.sortOrder} onChange={set("sortOrder")} /></Field>
        <div className="flex items-end pb-2"><Checkbox label={tr("الباقة متاحة للبيع", "Available for sale")} checked={f.isActive} onChange={set("isActive")} /></div>
        <div className="sm:col-span-3 border-t border-line pt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium">{tr("الأقسام المتاحة في الباقة", "Modules included")}</p>
            <button type="button" className="text-xs text-brand" onClick={() => setF((x) => ({ ...x, features: x.features.length === OPTIONAL.length ? [] : OPTIONAL.map((m) => m.key) }))}>
              {tr("تحديد / إلغاء الكل", "Toggle all")}
            </button>
          </div>
          <p className="mb-3 text-xs text-muted">{tr("الأقسام الأساسية (المستخدمون، الصلاحيات، الفروع، السجل، الإعدادات) متاحة دائماً.", "Core modules (users, roles, branches, audit, settings) are always included.")}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {OPTIONAL.map((m) => (
              <Checkbox key={m.key} checked={f.features.includes(m.key)} onChange={() => toggle(m.key)}
                label={<>{locale === "ar" ? m.ar : m.en} <span className="text-xs text-muted">({tr("مرحلة", "phase")} {m.phase})</span></>} />
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

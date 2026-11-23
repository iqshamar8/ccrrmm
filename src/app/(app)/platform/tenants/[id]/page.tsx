"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { BrandingEditor } from "@/components/BrandingEditor";
import { HEX } from "@/lib/branding";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { actionLabel, cycleLabel, subStatusLabel, TENANT_STATUS, tenantTypeLabel } from "@/lib/labels";
import { TENANT_TYPES } from "@/lib/permissions";
import type { PlanRow } from "@/lib/types";

type TenantDetail = {
  id: string; name: string; slug: string; type: string; status: string; baseCurrency: string; timezone: string;
  contactEmail: string | null; contactPhone: string | null; address: string | null; createdAt: string; storageUsedMb: number;
  logoUrl: string | null; primaryColor: string; accentColor: string;
  _count: { users: number; branches: number; roles: number };
  subscriptions: { id: string; status: string; billingCycle: string; startsAt: string; endsAt: string | null; trialEndsAt: string | null; plan: { nameAr: string; nameEn: string; storageMb: number; maxUsers: number; maxBranches: number } }[];
  branches: { id: string; name: string; code: string; isMain: boolean; isActive: boolean }[];
};

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const { tr, locale } = s;
  const { data: t, loading, reload } = useResource<TenantDetail>(s.user.isPlatformAdmin ? `/api/platform/tenants/${id}` : null);
  const audit = useResource<{ id: string; action: string; userEmail: string | null; createdAt: string }[]>(
    s.user.isPlatformAdmin ? `/api/platform/stats?audit=1&tenantId=${id}&take=30` : null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "SUSPENDED" | "ACTIVE" | "CANCELLED">(null);
  const { pending, run } = useSubmit();

  if (!s.user.isPlatformAdmin) return <Forbidden />;
  if (loading || !t) return <div className="grid place-items-center py-24"><Spinner /></div>;
  const sub = t.subscriptions[0];
  const st = TENANT_STATUS[t.status];

  async function setStatus(status: string) {
    const ok = await run(() => api(`/api/platform/tenants/${id}`, { method: "PATCH", body: { status } }), tr("تم تحديث الحالة", "Status updated"));
    setConfirm(null);
    if (ok) { reload(); audit.reload(); }
  }

  async function issueInvoice() {
    if (!sub) return;
    const kind = sub.status === "TRIALING" ? "NEW" : "RENEWAL";
    const ok = await run(() => api(`/api/platform/tenants/${id}/subscription/invoice`, { method: "POST", body: { subscriptionId: sub.id, kind } }), tr("تم إصدار الفاتورة", "Invoice issued"));
    if (ok) { reload(); audit.reload(); }
  }

  return (
    <>
      <Link href="/platform/tenants" className="mb-3 inline-block text-sm text-muted hover:text-ink">← {tr("المؤسسات", "Organizations")}</Link>
      <PageHeader
        title={t.name}
        subtitle={`${tenantTypeLabel(t.type, locale)} · ${t.slug}`}
        actions={<>
          <Button variant="secondary" onClick={() => setEditOpen(true)}>{tr("تعديل البيانات", "Edit details")}</Button>
          <Button variant="secondary" onClick={() => setPlanOpen(true)}>{tr("تغيير الباقة / التجديد", "Change plan / renew")}</Button>
          {sub && <Button variant="secondary" loading={pending} onClick={issueInvoice}>{tr("إصدار فاتورة", "Issue invoice")}</Button>}
          {t.status === "SUSPENDED" || t.status === "CANCELLED"
            ? <Button onClick={() => setConfirm("ACTIVE")}>{tr("تفعيل", "Activate")}</Button>
            : <Button variant="danger" onClick={() => setConfirm("SUSPENDED")}>{tr("إيقاف", "Suspend")}</Button>}
        </>}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted">{tr("الحالة", "Status")}</p><div className="mt-2"><Badge tone={st?.tone}>{tr(st?.ar ?? t.status, st?.en ?? t.status)}</Badge></div></Card>
        <Card className="p-4"><p className="text-xs text-muted">{tr("الباقة", "Plan")}</p><p className="mt-1 font-semibold">{sub ? tr(sub.plan.nameAr, sub.plan.nameEn) : "—"}</p>
          {sub && <p className="text-xs text-muted">{subStatusLabel(sub.status, locale)} · {cycleLabel(sub.billingCycle, locale)} · {tr("حتى", "until")} {fmtDate(sub.endsAt ?? sub.trialEndsAt, locale)}</p>}</Card>
        <Card className="p-4"><p className="text-xs text-muted">{tr("المستخدمون / الفروع", "Users / branches")}</p>
          <p className="mt-1 font-semibold tabular">{t._count.users} / {sub?.plan.maxUsers} · {t._count.branches} / {sub?.plan.maxBranches}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">{tr("التخزين", "Storage")}</p>
          <p className="mt-1 font-semibold tabular">{t.storageUsedMb} MB / {sub?.plan.storageMb ?? 0} MB</p></Card>
      </div>

      <TenantBrandingCard t={t} onSaved={() => { reload(); audit.reload(); }} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="border-b border-line px-4 py-3 font-medium">{tr("سجل الاشتراكات", "Subscription history")}</div>
          <Table head={[tr("الباقة", "Plan"), tr("الحالة", "Status"), tr("البداية", "Start"), tr("النهاية", "End")]}>
            {t.subscriptions.map((x) => (
              <Tr key={x.id}><Td>{tr(x.plan.nameAr, x.plan.nameEn)}</Td><Td>{subStatusLabel(x.status, locale)}</Td>
                <Td className="text-muted">{fmtDate(x.startsAt, locale)}</Td><Td className="text-muted">{fmtDate(x.endsAt ?? x.trialEndsAt, locale)}</Td></Tr>
            ))}
          </Table>
        </Card>
        <Card>
          <div className="border-b border-line px-4 py-3 font-medium">{tr("الفروع", "Branches")}</div>
          <Table head={[tr("الفرع", "Branch"), tr("الرمز", "Code"), tr("الحالة", "Status")]}>
            {t.branches.map((b) => (
              <Tr key={b.id}><Td>{b.name} {b.isMain && <Badge tone="brand">{tr("رئيسي", "Main")}</Badge>}</Td><Td dir="ltr" className="text-muted">{b.code}</Td>
                <Td><Badge tone={b.isActive ? "green" : "gray"}>{b.isActive ? tr("نشط", "Active") : tr("معطل", "Inactive")}</Badge></Td></Tr>
            ))}
          </Table>
        </Card>
        <Card className="lg:col-span-2">
          <div className="border-b border-line px-4 py-3 font-medium">{tr("سجل نشاط المؤسسة", "Organization activity")}</div>
          <Table head={[tr("العملية", "Action"), tr("المستخدم", "User"), tr("الوقت", "Time")]}>
            {audit.data?.map((r) => (
              <Tr key={r.id}><Td>{actionLabel(r.action, locale)}</Td><Td dir="ltr" className="text-muted">{r.userEmail ?? tr("النظام", "System")}</Td><Td className="text-muted">{fmtDate(r.createdAt, locale, true)}</Td></Tr>
            ))}
          </Table>
        </Card>
      </div>

      <EditTenantModal open={editOpen} t={t} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload(); audit.reload(); }} />
      <ChangePlanModal open={planOpen} tenantId={id} onClose={() => setPlanOpen(false)} onSaved={() => { setPlanOpen(false); reload(); audit.reload(); }} />
      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} loading={pending} onConfirm={() => confirm && setStatus(confirm)}
        title={confirm === "ACTIVE" ? tr("تفعيل المؤسسة", "Activate organization") : tr("إيقاف المؤسسة", "Suspend organization")}
        text={confirm === "ACTIVE"
          ? tr("سيتمكن مستخدمو المؤسسة من الدخول مجدداً.", "The organization's users will be able to sign in again.")
          : tr("سيتم تسجيل خروج جميع مستخدمي المؤسسة فوراً ومنعهم من الدخول. البيانات تبقى محفوظة.", "All users are signed out immediately and blocked. Data is kept.")}
        confirmLabel={tr("تأكيد", "Confirm")} cancelLabel={tr("إلغاء", "Cancel")} />
    </>
  );
}

function EditTenantModal({ open, t, onClose, onSaved }: { open: boolean; t: TenantDetail; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const { pending, fields, run } = useSubmit();
  const [f, setF] = useState({ name: t.name, type: t.type, baseCurrency: t.baseCurrency, timezone: t.timezone, contactEmail: t.contactEmail ?? "", contactPhone: t.contactPhone ?? "", address: t.address ?? "" });
  useEffect(() => { if (open) setF({ name: t.name, type: t.type, baseCurrency: t.baseCurrency, timezone: t.timezone, contactEmail: t.contactEmail ?? "", contactPhone: t.contactPhone ?? "", address: t.address ?? "" }); }, [open, t]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => api(`/api/platform/tenants/${t.id}`, { method: "PATCH", body: f }), tr("تم الحفظ", "Saved"))) onSaved();
  }
  return (
    <Modal open={open} onClose={onClose} title={tr("تعديل بيانات المؤسسة", "Edit organization")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="edit-tenant" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="edit-tenant" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("الاسم", "Name")} error={fields.name} className="sm:col-span-2"><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label={tr("النوع", "Type")}><Select value={f.type} onChange={set("type")}>{TENANT_TYPES.map((x) => <option key={x.key} value={x.key}>{tr(x.ar, x.en)}</option>)}</Select></Field>
        <Field label={tr("العملة", "Currency")} error={fields.baseCurrency}><Input dir="ltr" maxLength={3} value={f.baseCurrency} onChange={set("baseCurrency")} /></Field>
        <Field label={tr("المنطقة الزمنية", "Timezone")}><Input dir="ltr" value={f.timezone} onChange={set("timezone")} /></Field>
        <Field label={tr("البريد", "Email")} error={fields.contactEmail}><Input dir="ltr" type="email" value={f.contactEmail} onChange={set("contactEmail")} /></Field>
        <Field label={tr("الهاتف", "Phone")}><Input dir="ltr" value={f.contactPhone} onChange={set("contactPhone")} /></Field>
        <Field label={tr("العنوان", "Address")}><Input value={f.address} onChange={set("address")} /></Field>
      </form>
    </Modal>
  );
}

function ChangePlanModal({ open, tenantId, onClose, onSaved }: { open: boolean; tenantId: string; onClose: () => void; onSaved: () => void }) {
  const { tr, locale } = useSession();
  const plans = useResource<PlanRow[]>(open ? "/api/platform/plans" : null);
  const { pending, fields, run } = useSubmit();
  const [f, setF] = useState({ planId: "", billingCycle: "MONTHLY", status: "ACTIVE", endsAt: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const active = plans.data?.filter((p) => p.isActive) ?? [];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, planId: f.planId || active[0]?.id, endsAt: f.endsAt || null };
    if (await run(() => api(`/api/platform/tenants/${tenantId}/subscription`, { body }), tr("تم تحديث الاشتراك", "Subscription updated"))) onSaved();
  }
  return (
    <Modal open={open} onClose={onClose} title={tr("تغيير الباقة أو التجديد", "Change plan or renew")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="plan-form" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="plan-form" onSubmit={submit} className="grid gap-4">
        <p className="text-sm text-muted">{tr("يُغلق الاشتراك الحالي ويُحفظ في السجل، ويبدأ اشتراك جديد من اليوم.", "The current subscription is closed (kept in history) and a new one starts today.")}</p>
        <Field label={tr("الباقة", "Plan")}>
          <Select value={f.planId || active[0]?.id || ""} onChange={set("planId")}>
            {active.map((p) => <option key={p.id} value={p.id}>{locale === "ar" ? p.nameAr : p.nameEn}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("دورة الفوترة", "Billing cycle")}>
            <Select value={f.billingCycle} onChange={set("billingCycle")}><option value="MONTHLY">{tr("شهري", "Monthly")}</option><option value="YEARLY">{tr("سنوي", "Yearly")}</option></Select>
          </Field>
          <Field label={tr("حالة الاشتراك", "Status")}>
            <Select value={f.status} onChange={set("status")}>
              {["ACTIVE", "TRIALING", "PAST_DUE", "PAUSED"].map((k) => <option key={k} value={k}>{subStatusLabel(k, locale)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={tr("تاريخ الانتهاء (اختياري)", "End date (optional)")} error={fields.endsAt} hint={tr("افتراضياً: دورة فوترة واحدة من اليوم", "Default: one billing cycle from today")}>
          <Input type="date" dir="ltr" value={f.endsAt} onChange={set("endsAt")} />
        </Field>
      </form>
    </Modal>
  );
}

/** Platform admin sets a clinic's logo and colours (applies to all its users on next page load). */
function TenantBrandingCard({ t, onSaved }: { t: TenantDetail; onSaved: () => void }) {
  const { tr } = useSession();
  const { pending, fields, run } = useSubmit();
  const initial = { logoUrl: t.logoUrl ?? "", primaryColor: t.primaryColor, accentColor: t.accentColor };
  const [b, setB] = useState(initial);
  useEffect(() => { setB({ logoUrl: t.logoUrl ?? "", primaryColor: t.primaryColor, accentColor: t.accentColor }); }, [t.logoUrl, t.primaryColor, t.accentColor]);
  const dirty = b.logoUrl !== initial.logoUrl || b.primaryColor !== initial.primaryColor || b.accentColor !== initial.accentColor;
  const valid = HEX.test(b.primaryColor) && HEX.test(b.accentColor);
  async function save() {
    if (await run(() => api(`/api/platform/tenants/${t.id}`, { method: "PATCH", body: b }), tr("تم حفظ هوية العيادة", "Clinic branding saved"))) onSaved();
  }
  return (
    <Card className="mb-6 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{tr("الهوية البصرية للعيادة", "Clinic branding")}</h2>
          <p className="mt-1 text-sm text-muted">{tr("الشعار والألوان تظهر لكل مستخدمي هذه العيادة في القائمة ولوحة التحكم والفواتير.", "The logo and colours show for every user of this clinic in the menu, dashboard and invoices.")}</p>
        </div>
        <div className="flex gap-2">
          {dirty && <Button variant="ghost" onClick={() => setB(initial)}>{tr("تراجع", "Undo")}</Button>}
          <Button loading={pending} disabled={!dirty || !valid} onClick={save}>{tr("حفظ الهوية", "Save branding")}</Button>
        </div>
      </div>
      <BrandingEditor name={t.name} value={b} onChange={setB} />
      {(fields.logoUrl || fields.primaryColor || fields.accentColor) && <p role="alert" className="mt-3 text-sm text-danger">{fields.logoUrl || fields.primaryColor || fields.accentColor}</p>}
    </Card>
  );
}

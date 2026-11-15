"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { TENANT_STATUS, tenantTypeLabel } from "@/lib/labels";
import { TENANT_TYPES } from "@/lib/permissions";
import type { PlanRow } from "@/lib/types";

type TenantRow = {
  id: string; name: string; slug: string; type: string; status: string; createdAt: string; users: number; branches: number;
  subscription: null | { status: string; endsAt: string | null; trialEndsAt: string | null; plan: { nameAr: string; nameEn: string } };
};

export default function TenantsPage() {
  const s = useSession();
  const { tr, locale } = s;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const url = `/api/platform/tenants?q=${encodeURIComponent(q)}&status=${status}`;
  const { data, loading, reload } = useResource<TenantRow[]>(s.user.isPlatformAdmin ? url : null);
  if (!s.user.isPlatformAdmin) return <Forbidden />;

  return (
    <>
      <PageHeader
        title={tr("المؤسسات", "Organizations")}
        subtitle={tr("العيادات والمراكز والشركات المشتركة في المنصة", "Clinics, centers and companies on the platform")}
        actions={<Button onClick={() => setOpen(true)}>+ {tr("مؤسسة جديدة", "New organization")}</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder={tr("بحث بالاسم أو المعرّف أو البريد…", "Search name, slug or email…")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tr("كل الحالات", "All statuses")}</option>
            {Object.entries(TENANT_STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
          </Select>
        </div>
        <Table head={[tr("المؤسسة", "Organization"), tr("النوع", "Type"), tr("الباقة", "Plan"), tr("الحالة", "Status"), tr("المستخدمون", "Users"), tr("الفروع", "Branches"), tr("تاريخ الإنشاء", "Created")]}>
          {loading ? <LoadingRows cols={7} /> : data?.map((t) => (
            <Tr key={t.id} onClick={() => router.push(`/platform/tenants/${t.id}`)}>
              <Td><p className="font-medium">{t.name}</p><p className="text-xs text-muted" dir="ltr">{t.slug}</p></Td>
              <Td className="text-muted">{tenantTypeLabel(t.type, locale)}</Td>
              <Td>{t.subscription ? tr(t.subscription.plan.nameAr, t.subscription.plan.nameEn) : "—"}</Td>
              <Td><Badge tone={TENANT_STATUS[t.status]?.tone}>{tr(TENANT_STATUS[t.status]?.ar ?? t.status, TENANT_STATUS[t.status]?.en ?? t.status)}</Badge></Td>
              <Td className="tabular">{t.users}</Td>
              <Td className="tabular">{t.branches}</Td>
              <Td className="text-muted">{fmtDate(t.createdAt, locale)}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && data?.length === 0 && (
          <EmptyState title={tr("لا توجد مؤسسات مطابقة", "No matching organizations")} action={<Button onClick={() => setOpen(true)}>{tr("إنشاء مؤسسة", "Create organization")}</Button>} />
        )}
      </Card>
      <CreateTenantModal open={open} onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); reload(); router.push(`/platform/tenants/${id}`); }} />
    </>
  );
}

function CreateTenantModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { tr, locale } = useSession();
  const plans = useResource<PlanRow[]>(open ? "/api/platform/plans" : null);
  const { pending, fields, run } = useSubmit();
  const [f, setF] = useState({
    name: "", slug: "", type: "MEDICAL_CLINIC", planId: "", billingCycle: "MONTHLY", startTrial: true, baseCurrency: "IQD",
    timezone: "Asia/Baghdad", contactEmail: "", contactPhone: "", address: "", mainBranchName: "الفرع الرئيسي",
    adminName: "", adminEmail: "", adminPassword: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const active = plans.data?.filter((p) => p.isActive) ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = await run(() => api<{ id: string }>("/api/platform/tenants", {
      body: {
        name: f.name, slug: f.slug, type: f.type, planId: f.planId || active[0]?.id, billingCycle: f.billingCycle,
        startTrial: f.startTrial, baseCurrency: f.baseCurrency, timezone: f.timezone, contactEmail: f.contactEmail,
        contactPhone: f.contactPhone, address: f.address, mainBranchName: f.mainBranchName,
        admin: { fullName: f.adminName, email: f.adminEmail, password: f.adminPassword },
      },
    }), tr("تم إنشاء المؤسسة وتجهيزها", "Organization created and provisioned"));
    if (t) onCreated(t.id);
  }

  return (
    <Modal open={open} onClose={onClose} wide title={tr("مؤسسة جديدة", "New organization")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="new-tenant" type="submit" loading={pending}>{tr("إنشاء", "Create")}</Button></>}>
      <form id="new-tenant" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("اسم المؤسسة", "Name")} error={fields.name}><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label={tr("المعرّف (slug)", "Slug")} error={fields.slug} hint={tr("أحرف إنجليزية صغيرة وأرقام وشرطات", "lowercase letters, digits, dashes")}>
          <Input required dir="ltr" value={f.slug} onChange={set("slug")} placeholder="my-clinic" />
        </Field>
        <Field label={tr("نوع المؤسسة", "Type")}>
          <Select value={f.type} onChange={set("type")}>{TENANT_TYPES.map((t) => <option key={t.key} value={t.key}>{tr(t.ar, t.en)}</option>)}</Select>
        </Field>
        <Field label={tr("الباقة", "Plan")} error={fields.planId}>
          <Select value={f.planId || active[0]?.id || ""} onChange={set("planId")}>
            {active.map((p) => <option key={p.id} value={p.id}>{locale === "ar" ? p.nameAr : p.nameEn} — {p.priceMonthly} {p.currency}</option>)}
          </Select>
        </Field>
        <Field label={tr("دورة الفوترة", "Billing cycle")}>
          <Select value={f.billingCycle} onChange={set("billingCycle")}>
            <option value="MONTHLY">{tr("شهري", "Monthly")}</option><option value="YEARLY">{tr("سنوي", "Yearly")}</option>
          </Select>
        </Field>
        <Field label={tr("العملة الأساسية", "Base currency")} error={fields.baseCurrency}><Input dir="ltr" maxLength={3} value={f.baseCurrency} onChange={set("baseCurrency")} /></Field>
        <Field label={tr("البريد الإلكتروني للمؤسسة", "Contact email")} error={fields.contactEmail}><Input type="email" dir="ltr" value={f.contactEmail} onChange={set("contactEmail")} /></Field>
        <Field label={tr("الهاتف", "Phone")}><Input dir="ltr" value={f.contactPhone} onChange={set("contactPhone")} /></Field>
        <Field label={tr("العنوان", "Address")} className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
        <Field label={tr("اسم الفرع الرئيسي", "Main branch name")}><Input required value={f.mainBranchName} onChange={set("mainBranchName")} /></Field>
        <div className="flex items-end pb-2"><Checkbox label={tr("بدء فترة تجريبية مجانية", "Start with a free trial")} checked={f.startTrial} onChange={set("startTrial")} /></div>

        <div className="sm:col-span-2 mt-2 border-t border-line pt-4">
          <p className="mb-3 font-medium">{tr("حساب مدير المؤسسة", "Organization admin account")}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={tr("الاسم الكامل", "Full name")} error={fields["admin.fullName"]}><Input required value={f.adminName} onChange={set("adminName")} /></Field>
            <Field label={tr("البريد الإلكتروني", "Email")} error={fields["admin.email"]}><Input required type="email" dir="ltr" value={f.adminEmail} onChange={set("adminEmail")} /></Field>
            <Field label={tr("كلمة المرور", "Password")} error={fields["admin.password"]} hint={tr("8 أحرف على الأقل، حروف وأرقام", "8+ chars, letters & digits")}>
              <Input required type="password" dir="ltr" value={f.adminPassword} onChange={set("adminPassword")} />
            </Field>
          </div>
        </div>
      </form>
    </Modal>
  );
}

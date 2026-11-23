"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { BrandingEditor } from "@/components/BrandingEditor";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { cycleLabel, subStatusLabel, tenantTypeLabel } from "@/lib/labels";

type Org = {
  name: string; slug: string; type: string; logoUrl: string | null; primaryColor: string; accentColor: string; timezone: string; defaultLocale: string;
  baseCurrency: string; contactEmail: string | null; contactPhone: string | null; address: string | null;
  subscription: null | { status: string; billingCycle: string; endsAt: string | null; trialEndsAt: string | null; plan: { nameAr: string; nameEn: string; maxUsers: number; maxBranches: number; storageMb: number } };
};

export default function OrganizationPage() {
  const { tr, locale, can } = useSession();
  const { data, loading } = useResource<Org>(can("settings.view") ? "/api/organization" : null);
  const { pending, fields, run } = useSubmit();
  const [f, setF] = useState({ name: "", logoUrl: "", primaryColor: "#0f766e", accentColor: "#dcf36b", timezone: "", defaultLocale: "ar", contactEmail: "", contactPhone: "", address: "" });
  useEffect(() => {
    if (data) setF({ name: data.name, logoUrl: data.logoUrl ?? "", primaryColor: data.primaryColor, accentColor: data.accentColor ?? "#dcf36b", timezone: data.timezone, defaultLocale: data.defaultLocale,
      contactEmail: data.contactEmail ?? "", contactPhone: data.contactPhone ?? "", address: data.address ?? "" });
  }, [data]);
  if (!can("settings.view")) return <Forbidden />;
  if (loading || !data) return <div className="grid place-items-center py-24"><Spinner /></div>;
  const editable = can("settings.update");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    // reload so the new brand colour / name apply across the shell
    if (await run(() => api("/api/organization", { method: "PATCH", body: f }), tr("تم حفظ الإعدادات", "Settings saved"))) setTimeout(() => window.location.reload(), 600);
  }
  const sub = data.subscription;

  return (
    <>
      <PageHeader title={tr("إعدادات المؤسسة", "Organization settings")} subtitle={`${tenantTypeLabel(data.type, locale)} · ${data.slug}`} />
      <Card className="mb-4 p-5">
        <div className="mb-4">
          <h2 className="font-semibold">{tr("الهوية البصرية", "Branding")}</h2>
          <p className="mt-1 text-sm text-muted">{tr("شعار العيادة وألوانها تظهر لكل الفريق في القائمة ولوحة التحكم والفواتير.", "Your logo and colours show for the whole team in the menu, dashboard and invoices.")}</p>
        </div>
        <BrandingEditor name={f.name} disabled={!editable}
          value={{ logoUrl: f.logoUrl, primaryColor: f.primaryColor, accentColor: f.accentColor }}
          onChange={(b) => setF((x) => ({ ...x, ...b }))} />
        {(fields.logoUrl || fields.primaryColor || fields.accentColor) && <p role="alert" className="mt-3 text-sm text-danger">{fields.logoUrl || fields.primaryColor || fields.accentColor}</p>}
        {editable && <div className="mt-5"><Button onClick={(e) => submit(e)} loading={pending}>{tr("حفظ الهوية", "Save branding")}</Button></div>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("اسم المؤسسة", "Name")} error={fields.name} className="sm:col-span-2"><Input disabled={!editable} required value={f.name} onChange={set("name")} /></Field>
            <Field label={tr("المنطقة الزمنية", "Timezone")}><Input disabled={!editable} dir="ltr" value={f.timezone} onChange={set("timezone")} /></Field>
            <Field label={tr("اللغة الافتراضية", "Default language")}>
              <Select disabled={!editable} value={f.defaultLocale} onChange={set("defaultLocale")}><option value="ar">العربية</option><option value="en">English</option></Select>
            </Field>
            <Field label={tr("البريد الإلكتروني", "Email")} error={fields.contactEmail}><Input disabled={!editable} dir="ltr" type="email" value={f.contactEmail} onChange={set("contactEmail")} /></Field>
            <Field label={tr("الهاتف", "Phone")}><Input disabled={!editable} dir="ltr" value={f.contactPhone} onChange={set("contactPhone")} /></Field>
            <Field label={tr("العنوان", "Address")} className="sm:col-span-2"><Input disabled={!editable} value={f.address} onChange={set("address")} /></Field>
            {editable && <div className="sm:col-span-2"><Button type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></div>}
          </form>
        </Card>
        <Card className="h-fit p-5">
          <p className="mb-3 font-medium">{tr("الاشتراك", "Subscription")}</p>
          {sub ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">{tr("الباقة", "Plan")}</dt><dd>{locale === "ar" ? sub.plan.nameAr : sub.plan.nameEn}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{tr("الحالة", "Status")}</dt><dd><Badge tone={sub.status === "ACTIVE" ? "green" : "amber"}>{subStatusLabel(sub.status, locale)}</Badge></dd></div>
              <div className="flex justify-between"><dt className="text-muted">{tr("الدورة", "Cycle")}</dt><dd>{cycleLabel(sub.billingCycle, locale)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{tr("ينتهي في", "Ends")}</dt><dd>{fmtDate(sub.endsAt ?? sub.trialEndsAt, locale)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{tr("المستخدمون", "Users")}</dt><dd className="tabular">{sub.plan.maxUsers}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{tr("الفروع", "Branches")}</dt><dd className="tabular">{sub.plan.maxBranches}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{tr("التخزين", "Storage")}</dt><dd className="tabular">{sub.plan.storageMb} MB</dd></div>
              <div className="flex justify-between"><dt className="text-muted">{tr("العملة", "Currency")}</dt><dd>{data.baseCurrency}</dd></div>
            </dl>
          ) : <p className="text-sm text-muted">—</p>}
          <p className="mt-4 text-xs text-muted">{tr("لتغيير الباقة أو التجديد تواصل مع إدارة المنصة.", "Contact the platform team to change or renew your plan.")}</p>
        </Card>
      </div>
    </>
  );
}

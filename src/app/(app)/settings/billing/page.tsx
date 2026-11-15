"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Card, Checkbox, Field, Input, PageHeader, Spinner } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";

type S = { taxName: string; defaultTaxRate: string; invoiceDueDays: number; invoiceFooter: string | null; reviewCommissionAmount: string; productCommissionPercent: string; autoConsumeMaterials: boolean; blockOnStockShortage: boolean };

export default function BillingSettingsPage() {
  const { tr, can, features } = useSession();
  const { data, loading, reload } = useResource<S>(can("settings.view") ? "/api/settings/billing" : null);
  const [f, setF] = useState({ taxName: "", defaultTaxRate: "0", invoiceDueDays: "0", invoiceFooter: "", reviewCommissionAmount: "0", productCommissionPercent: "0", autoConsumeMaterials: true, blockOnStockShortage: false });
  const { pending, fields, run } = useSubmit();
  useEffect(() => {
    if (data) setF({ taxName: data.taxName, defaultTaxRate: String(Number(data.defaultTaxRate)), invoiceDueDays: String(data.invoiceDueDays), invoiceFooter: data.invoiceFooter ?? "",
      reviewCommissionAmount: String(Number(data.reviewCommissionAmount)), productCommissionPercent: String(Number(data.productCommissionPercent)), autoConsumeMaterials: data.autoConsumeMaterials, blockOnStockShortage: data.blockOnStockShortage });
  }, [data]);
  if (!can("settings.view")) return <Forbidden />;
  if (loading && !data) return <div className="grid place-items-center py-24"><Spinner /></div>;
  const edit = can("settings.update");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <>
      <PageHeader title={tr("إعدادات الفوترة والعمولات", "Billing & commission settings")} subtitle={tr("الضريبة، شروط الفاتورة، وقواعد العمولات العامة", "Tax, invoice terms and general commission rules")} />
      <form className="grid max-w-3xl gap-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("/api/settings/billing", { method: "PATCH", body: f }), tr("تم حفظ الإعدادات", "Settings saved"))) reload(); }}>
        <Card className="grid gap-4 p-5 sm:grid-cols-3">
          <p className="font-medium sm:col-span-3">{tr("الفاتورة والضريبة", "Invoices & tax")}</p>
          <Field label={tr("اسم الضريبة", "Tax name")} error={fields.taxName}><Input disabled={!edit} value={f.taxName} onChange={set("taxName")} /></Field>
          <Field label={tr("نسبة الضريبة الافتراضية %", "Default tax rate %")} error={fields.defaultTaxRate} hint={tr("0 = بدون ضريبة. يمكن تغييرها لكل بند أو منتج.", "0 = no tax. Can be overridden per line/product.")}>
            <Input disabled={!edit} type="number" min={0} max={100} step="0.01" dir="ltr" value={f.defaultTaxRate} onChange={set("defaultTaxRate")} />
          </Field>
          <Field label={tr("مهلة السداد (أيام)", "Payment terms (days)")} error={fields.invoiceDueDays}><Input disabled={!edit} type="number" min={0} max={365} dir="ltr" value={f.invoiceDueDays} onChange={set("invoiceDueDays")} /></Field>
          <Field label={tr("نص أسفل الفاتورة المطبوعة", "Printed invoice footer")} className="sm:col-span-3">
            <textarea disabled={!edit} rows={2} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={f.invoiceFooter} onChange={set("invoiceFooter")} />
          </Field>
        </Card>
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <p className="font-medium sm:col-span-2">{tr("قواعد العمولات العامة", "General commission rules")}</p>
          <Field label={tr("عمولة المبيعات % (منتجات، برامج، اشتراكات)", "Sales commission % (products, programs, subscriptions)")} error={fields.productCommissionPercent}>
            <Input disabled={!edit} type="number" min={0} max={100} step="0.01" dir="ltr" value={f.productCommissionPercent} onChange={set("productCommissionPercent")} />
          </Field>
          <Field label={tr("عمولة ثابتة لكل مراجعة طبية مكتملة", "Fixed commission per completed review")} error={fields.reviewCommissionAmount}>
            <Input disabled={!edit} type="number" min={0} step="any" dir="ltr" value={f.reviewCommissionAmount} onChange={set("reviewCommissionAmount")} />
          </Field>
          <p className="text-xs text-muted sm:col-span-2">{tr("عمولات تنفيذ الخدمات وتسويقها تُحدد لكل خدمة من صفحة الخدمات، وعمولة الكوبون من صفحة الكوبونات. إعدادات نقاط الولاء في صفحة الولاء.",
            "Service execution/marketing commissions are set per service; coupon commissions per coupon; loyalty settings on the Loyalty page.")}</p>
        </Card>
        {features.includes("inventory") && <Card className="grid gap-3 p-5">
          <p className="font-medium">{tr("المخزون", "Stock")}</p>
          <Checkbox disabled={!edit} label={tr("خصم مواد الخدمة تلقائياً عند إكمال الزيارة أو العملية", "Deduct service materials automatically when a visit or surgery is completed")} checked={f.autoConsumeMaterials} onChange={(e) => setF({ ...f, autoConsumeMaterials: e.target.checked })} />
          <Checkbox disabled={!edit} label={tr("منع البيع أو الإكمال عند نقص الرصيد (بدلاً من التسجيل والتنبيه)", "Block a sale or completion when stock is short (instead of recording and flagging it)")} checked={f.blockOnStockShortage} onChange={(e) => setF({ ...f, blockOnStockShortage: e.target.checked })} />
        </Card>}
        {edit && <div><Button type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></div>}
      </form>
    </>
  );
}

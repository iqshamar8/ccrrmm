"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession, useToast } from "@/components/providers";
import { Button, Card, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import ClientPicker, { type PickedClient } from "@/components/clients/ClientPicker";
import type { Catalog, Staff } from "@/components/appointments/shared";
import { useMoney } from "@/components/billing/useMoney";
import { api, ApiError } from "@/lib/client";
import { LINE_KIND } from "@/lib/labels4";

type Line = { kind: string; description: string; serviceId: string; productId: string; quantity: number; unitPrice: string; discount: number; taxRate: string; performedById: string;
  appointmentId?: string | null; clientProgramId?: string | null; subscriptionId?: string | null; surgeryId?: string | null };
const blankLine = (): Line => ({ kind: "SERVICE", description: "", serviceId: "", productId: "", quantity: 1, unitPrice: "", discount: 0, taxRate: "", performedById: "" });

export default function NewInvoicePage() {
  return <Suspense fallback={<div className="grid place-items-center py-24"><Spinner /></div>}><Builder /></Suspense>;
}

/** Invoice builder: new invoice, or edit a draft (?draft=id). */
function Builder() {
  const { tr, can, features } = useSession();
  const money = useMoney();
  const toast = useToast();
  const router = useRouter();
  const draftId = useSearchParams().get("draft");
  const catalog = useResource<Catalog>("/api/catalog?active=1");
  const products = useResource<{ id: string; name: string; price: string }[]>("/api/products?active=1");
  const staff = useResource<Staff[]>("/api/staff");
  const settings = useResource<{ defaultTaxRate: string; taxName: string }>("/api/settings/billing");
  const draft = useResource<{ client: PickedClient | null; lines: (Line & { quantity: string; unitPrice: string; discount: string; taxRate: string })[]; discountAmount: string; coupon: { code: string } | null; loyaltyPointsRedeemed: number; salesStaffId: string | null; notes: string | null; status: string }>(draftId ? `/api/invoices/${draftId}` : null);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [f, setF] = useState({ discountAmount: 0, couponCode: "", redeemPoints: 0, salesStaffId: "", notes: "", dueDate: "" });
  const [plan, setPlan] = useState<{ dueDate: string; amount: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | "draft" | "issue">(null);

  useEffect(() => {
    const d = draft.data;
    if (!d) return;
    setClient(d.client);
    setLines(d.lines.map((l) => ({ ...blankLine(), ...l, description: l.description, serviceId: l.serviceId ?? "", productId: l.productId ?? "", performedById: l.performedById ?? "",
      quantity: Number(l.quantity), unitPrice: String(Number(l.unitPrice)), discount: Number(l.discount), taxRate: String(Number(l.taxRate)) })));
    setF({ discountAmount: Number(d.discountAmount), couponCode: d.coupon?.code ?? "", redeemPoints: d.loyaltyPointsRedeemed, salesStaffId: d.salesStaffId ?? "", notes: d.notes ?? "", dueDate: "" });
  }, [draft.data]);

  if (!can("invoices.create")) return <Forbidden />;
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickService = (i: number, id: string) => { const s = catalog.data?.services.find((x) => x.id === id); set(i, { serviceId: id, unitPrice: s ? String(Number(s.price)) : "", description: s?.name ?? "" }); };
  const pickProduct = (i: number, id: string) => { const p = products.data?.find((x) => x.id === id); set(i, { productId: id, unitPrice: p ? String(Number(p.price)) : "", description: p?.name ?? "" }); };
  const defTax = Number(settings.data?.defaultTaxRate ?? 0);
  const lineNet = (l: Line) => Math.max(0, l.quantity * Number(l.unitPrice || 0) - l.discount);
  const subtotal = lines.reduce((s, l) => s + lineNet(l), 0);
  const estTax = lines.reduce((s, l) => s + lineNet(l) * (Number(l.taxRate === "" ? defTax : l.taxRate) / 100), 0) * (subtotal ? Math.max(0, 1 - f.discountAmount / subtotal) : 0);

  async function save(issue: boolean) {
    setError(null); setPending(issue ? "issue" : "draft");
    const body = {
      clientId: client?.id ?? null, discountAmount: f.discountAmount, couponCode: f.couponCode || null, redeemPoints: f.redeemPoints, salesStaffId: f.salesStaffId || null, notes: f.notes, dueDate: f.dueDate || null,
      lines: lines.map((l) => ({
        kind: l.kind, description: l.description || null, quantity: l.quantity, unitPrice: l.unitPrice === "" ? null : l.unitPrice, discount: l.discount, taxRate: l.taxRate === "" ? null : l.taxRate,
        serviceId: l.serviceId || null, productId: l.productId || null, performedById: l.performedById || null,
        appointmentId: l.appointmentId ?? null, clientProgramId: l.clientProgramId ?? null, subscriptionId: l.subscriptionId ?? null, surgeryId: l.surgeryId ?? null,
      })),
    };
    try {
      let id = draftId;
      if (draftId) await api(`/api/invoices/${draftId}`, { method: "PATCH", body });
      else id = (await api<{ id: string }>("/api/invoices", { body })).id;
      if (issue) await api(`/api/invoices/${id}/issue`, { body: { installments: plan.length ? plan.map((p) => ({ dueDate: p.dueDate, amount: p.amount })) : null } });
      toast("success", issue ? tr("تم إصدار الفاتورة", "Invoice issued") : tr("تم حفظ المسودة", "Draft saved"));
      router.push(`/invoices/${id}`);
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setPending(null); }
  }

  const splitPlan = (n: number) => {
    const total = subtotal - f.discountAmount + estTax; const part = Math.floor((total / n) * 100) / 100;
    setPlan(Array.from({ length: n }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() + i); return { dueDate: d.toISOString().slice(0, 10), amount: (i === n - 1 ? Math.round((total - part * (n - 1)) * 100) / 100 : part).toString() }; }));
  };

  return (
    <>
      <PageHeader title={draftId ? tr("تعديل مسودة فاتورة", "Edit draft invoice") : tr("فاتورة جديدة", "New invoice")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="p-4">
          <div className="mb-4"><span className="mb-1.5 block text-sm font-medium">{tr("العميل", "Client")}</span><ClientPicker value={client} onChange={setClient} /></div>
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-12">
                <Select className="sm:col-span-2" value={l.kind} disabled={!!(l.appointmentId || l.clientProgramId || l.subscriptionId || l.surgeryId)} onChange={(e) => set(i, { ...blankLine(), kind: e.target.value })}>
                  {["SERVICE", "PRODUCT", "OTHER"].map((k) => <option key={k} value={k}>{tr(LINE_KIND[k].ar, LINE_KIND[k].en)}</option>)}
                  {!["SERVICE", "PRODUCT", "OTHER"].includes(l.kind) && <option value={l.kind}>{tr(LINE_KIND[l.kind].ar, LINE_KIND[l.kind].en)}</option>}
                </Select>
                <div className="sm:col-span-4">
                  {l.kind === "SERVICE" && !l.appointmentId ? (
                    <Select value={l.serviceId} onChange={(e) => pickService(i, e.target.value)}><option value="">{tr("اختر الخدمة", "Choose service")}</option>{catalog.data?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                  ) : l.kind === "PRODUCT" ? (
                    <Select value={l.productId} onChange={(e) => pickProduct(i, e.target.value)}><option value="">{tr("اختر المنتج", "Choose product")}</option>{products.data?.filter((p) => (p as { isSellable?: boolean }).isSellable !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                  ) : <Input placeholder={tr("الوصف", "Description")} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />}
                </div>
                <Input className="sm:col-span-1" type="number" min={0.001} step="any" dir="ltr" aria-label={tr("الكمية", "Qty")} value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} />
                <Input className="sm:col-span-2" type="number" min={0} step="any" dir="ltr" placeholder={tr("السعر", "Price")} value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} />
                <Input className="sm:col-span-2" type="number" min={0} step="any" dir="ltr" placeholder={tr("خصم", "Disc.")} value={l.discount || ""} onChange={(e) => set(i, { discount: Number(e.target.value) })} />
                <Button className="sm:col-span-1" type="button" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="remove">×</Button>
                <div className="flex flex-wrap items-center gap-2 sm:col-span-12">
                  {["SERVICE", "SURGERY"].includes(l.kind) && (
                    <Select className="h-8 w-auto text-xs" value={l.performedById} onChange={(e) => set(i, { performedById: e.target.value })}>
                      <option value="">{tr("المنفّذ (للعمولة)", "Performed by")}</option>{staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                    </Select>
                  )}
                  <span className="text-xs text-muted">{tr("الضريبة %", "Tax %")}</span>
                  <Input className="h-8 w-20 text-xs" type="number" min={0} max={100} dir="ltr" placeholder={String(defTax)} value={l.taxRate} onChange={(e) => set(i, { taxRate: e.target.value })} />
                  {(l.appointmentId || l.clientProgramId || l.subscriptionId || l.surgeryId) && <span className="text-xs text-brand">{tr("مرتبط بسجل في النظام", "Linked to a record")}: {l.description}</span>}
                  <span className="ms-auto text-sm font-medium tabular">{money(lineNet(l))}</span>
                </div>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setLines([...lines, blankLine()])}>+ {tr("بند", "Line")}</Button>
          </div>
        </Card>
        <Card className="h-fit space-y-3 p-4 text-sm">
          <Field label={tr("خصم على الفاتورة", "Invoice discount")}><Input type="number" min={0} step="any" dir="ltr" value={f.discountAmount || ""} onChange={(e) => setF({ ...f, discountAmount: Number(e.target.value) })} /></Field>
          {features.includes("coupons") && <Field label={tr("كود الخصم", "Coupon")}><Input dir="ltr" className="uppercase" value={f.couponCode} onChange={(e) => setF({ ...f, couponCode: e.target.value })} /></Field>}
          {features.includes("loyalty") && client && <Field label={tr("استبدال نقاط", "Redeem points")}><Input type="number" min={0} dir="ltr" value={f.redeemPoints || ""} onChange={(e) => setF({ ...f, redeemPoints: Math.max(0, Math.floor(Number(e.target.value))) })} /></Field>}
          <Field label={tr("موظف البيع", "Sales staff")}><Select value={f.salesStaffId} onChange={(e) => setF({ ...f, salesStaffId: e.target.value })}><option value="">—</option>{staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select></Field>
          <Field label={tr("تاريخ الاستحقاق", "Due date")}><Input type="date" dir="ltr" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label={tr("ملاحظات", "Notes")}><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <div className="rounded-lg border border-line p-2">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium">{tr("تقسيط", "Installments")}</span>
              <Select className="h-7 w-auto text-xs" value={plan.length || ""} onChange={(e) => (Number(e.target.value) ? splitPlan(Number(e.target.value)) : setPlan([]))}>
                <option value="">{tr("بدون", "None")}</option>{[2, 3, 4, 6, 12].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select></div>
            {plan.map((p, i) => (
              <div key={i} className="mb-1 flex gap-1">
                <Input className="h-8 text-xs" type="date" dir="ltr" value={p.dueDate} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                <Input className="h-8 w-28 text-xs" type="number" dir="ltr" value={p.amount} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              </div>
            ))}
          </div>
          <dl className="space-y-1 border-t border-line pt-3">
            <div className="flex justify-between"><dt className="text-muted">{tr("المجموع", "Subtotal")}</dt><dd className="tabular">{money(subtotal)}</dd></div>
            {estTax > 0 && <div className="flex justify-between"><dt className="text-muted">{settings.data?.taxName}</dt><dd className="tabular">≈ {money(estTax)}</dd></div>}
            <div className="flex justify-between text-base font-semibold"><dt>{tr("تقديري", "Estimated")}</dt><dd className="tabular">{money(subtotal - f.discountAmount + estTax)}</dd></div>
            <p className="text-xs text-muted">{tr("الكوبون والنقاط تُحتسب نهائياً عند الحفظ.", "Coupon & points are applied on save.")}</p>
          </dl>
          {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" loading={pending === "draft"} disabled={!!pending} onClick={() => save(false)}>{tr("حفظ مسودة", "Save draft")}</Button>
            <Button className="flex-1" loading={pending === "issue"} disabled={!!pending} onClick={() => save(true)}>{tr("إصدار", "Issue")}</Button>
          </div>
        </Card>
      </div>
    </>
  );
}

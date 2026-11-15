"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Spinner, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import Progress from "@/components/Progress";
import BillButton from "@/components/billing/BillButton";
import ClientPicker, { type PickedClient } from "@/components/clients/ClientPicker";
import type { Catalog } from "@/components/appointments/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { lbl, SUB_KIND, SUB_STATUS, tone } from "@/lib/labels3";

type Sub = {
  id: string; code: string; name: string; kind: string; price: string; startDate: string; endDate: string; status: string; visitsTotal: number | null;
  used: number; booked: number; remaining: number | null; daysLeft: number; frozenAt: string | null; frozenDaysUsed: number; maxFreezeDays: number;
  cancelReason: string | null; allServices: boolean; client: { id: string; fullName: string; code: string; phone: string }; branch: { name: string };
};
type Plan = { id: string; name: string; nameEn: string | null; description: string | null; kind: string; price: string; durationDays: number; visitsLimit: number | null;
  maxFreezeDays: number; allServices: boolean; isActive: boolean; services: { serviceId: string; service: { name: string } }[]; _count: { subscriptions: number } };

export default function SubscriptionsPage() {
  return <Suspense fallback={<div className="grid place-items-center py-24"><Spinner /></div>}><Subscriptions /></Suspense>;
}

function Subscriptions() {
  const { tr, locale, can } = useSession();
  const sp = useSearchParams();
  const [tab, setTab] = useState<"subs" | "plans">("subs");
  const [status, setStatus] = useState("ACTIVE");
  const [expiring, setExpiring] = useState(false);
  const [q, setQ] = useState("");
  const [sell, setSell] = useState(false);
  const [openId, setOpenId] = useState<string | null>(sp.get("open"));
  const [editPlan, setEditPlan] = useState<Plan | "new" | null>(null);
  const ok = can("subscriptions.view");
  const subs = useResource<Sub[]>(ok && tab === "subs" ? `/api/subscriptions?status=${expiring ? "" : status}${expiring ? "&expiring=7" : ""}&q=${encodeURIComponent(q)}` : null);
  const plans = useResource<Plan[]>(ok ? "/api/subscription-plans" : null);
  if (!ok) return <Forbidden />;

  return (
    <>
      <PageHeader title={tr("اشتراكات العملاء", "Client subscriptions")} subtitle={tr("عضويات شهرية وسنوية وباقات زيارات وجلسات", "Memberships and visit/session packs")}
        actions={<>
          {can("subscriptions.create") && tab === "plans" && <Button variant="secondary" onClick={() => setEditPlan("new")}>+ {tr("باقة", "Plan")}</Button>}
          {can("subscriptions.create") && <Button onClick={() => setSell(true)}>+ {tr("بيع اشتراك", "Sell subscription")}</Button>}
        </>} />
      <div className="mb-4 flex gap-1 border-b border-line">
        {([["subs", tr("المشتركون", "Subscribers")], ["plans", tr("باقات الاشتراك", "Plans")]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-4 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>
      {tab === "subs" ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Input className="max-w-xs" placeholder={tr("بحث بالعميل أو الرمز…", "Search client or code…")} value={q} onChange={(e) => setQ(e.target.value)} />
            <Select className="w-auto" value={status} disabled={expiring} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{tr("كل الحالات", "All statuses")}</option>
              {Object.entries(SUB_STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
            </Select>
            <Checkbox label={tr("تنتهي خلال 7 أيام", "Ending within 7 days")} checked={expiring} onChange={(e) => setExpiring(e.target.checked)} />
          </div>
          <Table head={[tr("الاشتراك", "Subscription"), tr("العميل", "Client"), tr("الاستخدام", "Usage"), tr("الفترة", "Period"), tr("متبقي", "Left"), tr("الحالة", "Status")]}>
            {subs.loading && !subs.data ? <LoadingRows cols={6} /> : subs.data?.map((s) => (
              <Tr key={s.id} onClick={() => setOpenId(s.id)}>
                <Td><p className="font-medium">{s.name}</p><p className="text-xs text-muted"><span dir="ltr">{s.code}</span> · {lbl(SUB_KIND, s.kind, locale)}</p></Td>
                <Td>{s.client.fullName}</Td>
                <Td>{s.visitsTotal ? <Progress used={s.used} total={s.visitsTotal} /> : <span className="text-sm tabular">{s.used} {tr("زيارة", "visits")}</span>}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(s.startDate, locale)} – {fmtDate(s.endDate, locale)}</Td>
                <Td className="whitespace-nowrap">{s.status === "ACTIVE" ? <span className={s.daysLeft <= 7 ? "font-medium text-warning" : ""}>{s.daysLeft} {tr("يوم", "days")}</span> : "—"}</Td>
                <Td><Badge tone={tone(SUB_STATUS, s.status)}>{lbl(SUB_STATUS, s.status, locale)}</Badge></Td>
              </Tr>
            ))}
          </Table>
          {!subs.loading && subs.data?.length === 0 && <EmptyState title={tr("لا توجد اشتراكات مطابقة", "No matching subscriptions")} />}
        </Card>
      ) : (
        <Card>
          <Table head={[tr("الباقة", "Plan"), tr("النوع", "Type"), tr("المدة", "Duration"), tr("الحد", "Limit"), tr("السعر", "Price"), tr("التجميد", "Freeze"), tr("الخدمات", "Services"), tr("مباع", "Sold")]}>
            {plans.data?.map((p) => (
              <Tr key={p.id} onClick={can("subscriptions.update") ? () => setEditPlan(p) : undefined}>
                <Td className="font-medium">{p.name} {!p.isActive && <Badge>{tr("معطلة", "Inactive")}</Badge>}</Td>
                <Td className="text-muted">{lbl(SUB_KIND, p.kind, locale)}</Td>
                <Td className="tabular">{p.durationDays} {tr("يوم", "d")}</Td>
                <Td className="tabular">{p.visitsLimit ?? "∞"}</Td>
                <Td className="tabular">{Number(p.price).toLocaleString()}</Td>
                <Td className="tabular text-muted">{p.maxFreezeDays ? `${p.maxFreezeDays} ${tr("يوم", "d")}` : "—"}</Td>
                <Td className="text-xs text-muted">{p.allServices ? tr("كل الخدمات", "All services") : p.services.map((s) => s.service.name).join("، ")}</Td>
                <Td className="tabular">{p._count.subscriptions}</Td>
              </Tr>
            ))}
          </Table>
          {plans.data?.length === 0 && <EmptyState title={tr("لا توجد باقات اشتراك", "No plans yet")} />}
        </Card>
      )}
      <SellModal open={sell} plans={plans.data ?? []} onClose={() => setSell(false)} onDone={(id) => { setSell(false); subs.reload(); setOpenId(id); }} />
      <SubDetail id={openId} onClose={() => setOpenId(null)} onChanged={() => subs.reload()} onOpen={setOpenId} />
      <PlanModal plan={editPlan} onClose={() => setEditPlan(null)} onSaved={() => { setEditPlan(null); plans.reload(); }} />
    </>
  );
}

function SellModal({ open, plans, onClose, onDone }: { open: boolean; plans: Plan[]; onClose: () => void; onDone: (id: string) => void }) {
  const { tr, locale } = useSession();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [price, setPrice] = useState("");
  const { pending, run } = useSubmit();
  const active = plans.filter((p) => p.isActive);
  const plan = active.find((p) => p.id === planId);
  useEffect(() => { if (open) { setClient(null); setPlanId(active[0]?.id ?? ""); setStartDate(new Date().toISOString().slice(0, 10)); setPrice(""); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={tr("بيع اشتراك", "Sell subscription")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button disabled={!client || !planId} loading={pending} onClick={async () => {
        const r = await run(() => api<{ id: string }>("/api/subscriptions", { body: { clientId: client!.id, planId, startDate, price: price === "" ? undefined : price } }), tr("تم تسجيل الاشتراك", "Subscription sold"));
        if (r) onDone(r.id);
      }}>{tr("تأكيد", "Confirm")}</Button></>}>
      <div className="space-y-4">
        <div><span className="mb-1.5 block text-sm font-medium">{tr("العميل", "Client")}</span><ClientPicker value={client} onChange={setClient} /></div>
        <Field label={tr("الباقة", "Plan")}>
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>{active.map((p) => <option key={p.id} value={p.id}>{locale === "ar" ? p.name : p.nameEn ?? p.name} — {Number(p.price).toLocaleString()}</option>)}</Select>
        </Field>
        {plan && <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">{lbl(SUB_KIND, plan.kind, locale)} · {plan.durationDays} {tr("يوم", "days")}{plan.visitsLimit ? ` · ${plan.visitsLimit} ${tr("زيارة/جلسة", "visits")}` : ""} · {plan.allServices ? tr("كل الخدمات", "all services") : plan.services.map((s) => s.service.name).join("، ")}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("تاريخ البدء", "Start date")}><Input type="date" dir="ltr" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label={tr("السعر (اختياري)", "Price (optional)")} hint={tr("افتراضياً سعر الباقة", "defaults to plan price")}><Input type="number" min={0} step="any" dir="ltr" value={price} placeholder={plan ? String(Number(plan.price)) : ""} onChange={(e) => setPrice(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-muted">{tr("التحصيل والفاتورة تأتي مع وحدة الفواتير (المرحلة الرابعة).", "Payment & invoice come with the Invoicing module (phase 4).")}</p>
      </div>
    </Modal>
  );
}

type SubFull = Sub & { usages: { id: string; usedAt: string; note: string | null; appointment: { service: { name: string } | null; staff: { fullName: string } | null } | null }[]; services: { id: string; name: string }[] };

function SubDetail({ id, onClose, onChanged, onOpen }: { id: string | null; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const { tr, locale, can } = useSession();
  const { data: s, reload } = useResource<SubFull>(id ? `/api/subscriptions/${id}` : null);
  const act = useSubmit();
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => { setCancelling(false); setReason(""); }, [id]);
  const doAct = async (action: string, extra: Record<string, unknown> = {}) => {
    if (await act.run(() => api(`/api/subscriptions/${id}/status`, { body: { action, ...extra } }), tr("تم التحديث", "Updated"))) { setCancelling(false); reload(); onChanged(); }
  };
  const edit = can("subscriptions.update");
  return (
    <Modal open={!!id} onClose={onClose} wide title={s ? `${s.name} — ${s.client.fullName}` : tr("الاشتراك", "Subscription")}
      footer={s && edit && !cancelling ? (
        <div className="flex w-full flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {s.status === "ACTIVE" && s.maxFreezeDays > s.frozenDaysUsed && <Button variant="secondary" loading={act.pending} onClick={() => doAct("FREEZE")}>{tr("تجميد", "Freeze")}</Button>}
            {s.status === "FROZEN" && <Button loading={act.pending} onClick={() => doAct("UNFREEZE")}>{tr("إلغاء التجميد", "Unfreeze")}</Button>}
            {!["CANCELLED", "EXPIRED"].includes(s.status) && <Button variant="ghost" className="text-danger" onClick={() => setCancelling(true)}>{tr("إلغاء الاشتراك", "Cancel")}</Button>}
          </div>
          <div className="flex gap-2">
            {s.status === "ACTIVE" && <Button variant="secondary" loading={act.pending} onClick={async () => { if (await act.run(() => api(`/api/subscriptions/${id}/usage`, { body: {} }), tr("تم تسجيل زيارة", "Visit recorded"))) { reload(); onChanged(); } }}>{tr("تسجيل زيارة يدوياً", "Record a visit")}</Button>}
            {can("subscriptions.create") && <Button loading={act.pending} onClick={async () => { const r = await act.run(() => api<{ id: string }>(`/api/subscriptions/${id}/renew`, { body: {} }), tr("تم التجديد", "Renewed")); if (r) { onChanged(); onOpen(r.id); } }}>{tr("تجديد", "Renew")}</Button>}
          </div>
        </div>
      ) : undefined}>
      {!s ? <div className="grid place-items-center py-10"><Spinner /></div> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={tone(SUB_STATUS, s.status)}>{lbl(SUB_STATUS, s.status, locale)}</Badge><span className="text-muted" dir="ltr">{s.code}</span><span className="text-muted">· {lbl(SUB_KIND, s.kind, locale)}</span></div>
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3 sm:grid-cols-4">
            <div><dt className="text-xs text-muted">{tr("الفترة", "Period")}</dt><dd>{fmtDate(s.startDate, locale)} – {fmtDate(s.endDate, locale)}</dd></div>
            <div><dt className="text-xs text-muted">{tr("الاستخدام", "Usage")}</dt><dd className="tabular">{s.used}{s.visitsTotal ? ` / ${s.visitsTotal}` : ""} {s.booked ? `(+${s.booked} ${tr("محجوز", "booked")})` : ""}</dd></div>
            <div><dt className="text-xs text-muted">{tr("التجميد", "Freeze")}</dt><dd className="tabular">{s.frozenDaysUsed} / {s.maxFreezeDays} {tr("يوم", "d")}</dd></div>
            <div><dt className="text-xs text-muted">{tr("السعر", "Price")}</dt><dd className="tabular">{Number(s.price).toLocaleString()}</dd></div>
          </dl>
          {s.status !== "CANCELLED" && <div className="flex justify-end"><BillButton source="subscription" id={s.id} size="sm" /></div>}
          <p className="text-xs text-muted">{tr("الخدمات المشمولة:", "Covered services:")} {s.allServices ? tr("كل الخدمات", "all services") : s.services.map((x) => x.name).join("، ")}</p>
          {s.cancelReason && <p className="text-xs text-muted">{tr("سبب الإلغاء:", "Cancel reason:")} {s.cancelReason}</p>}
          {cancelling && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <Input autoFocus placeholder={tr("سبب الإلغاء", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
              <p className="text-xs text-muted">{tr("المواعيد القادمة تبقى محجوزة لكن لن تُحتسب على الاشتراك.", "Upcoming bookings stay, but are no longer charged to the subscription.")}</p>
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setCancelling(false)}>{tr("رجوع", "Back")}</Button><Button variant="danger" disabled={!reason.trim()} loading={act.pending} onClick={() => doAct("CANCEL", { reason })}>{tr("تأكيد", "Confirm")}</Button></div>
            </div>
          )}
          <div>
            <p className="mb-2 font-medium">{tr("سجل الاستخدام", "Usage history")}</p>
            {s.usages.length === 0 ? <p className="text-muted">—</p> : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {s.usages.map((u) => <li key={u.id} className="flex justify-between gap-2 px-3 py-2"><span>{u.appointment?.service?.name ?? u.note ?? tr("زيارة", "Visit")} {u.appointment?.staff && <span className="text-xs text-muted">· {u.appointment.staff.fullName}</span>}</span><span className="text-xs text-muted">{fmtDate(u.usedAt, locale)}</span></li>)}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: Plan | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr, can } = useSession();
  const isNew = plan === "new";
  const cat = useResource<Catalog>(plan ? "/api/catalog?active=1" : null);
  const blank = { name: "", nameEn: "", description: "", kind: "VISITS", price: "0", durationDays: "30", visitsLimit: "10", maxFreezeDays: "0", allServices: true, serviceIds: [] as string[], isActive: true };
  const [f, setF] = useState(blank);
  const { pending, fields, run } = useSubmit();
  const del = useSubmit();
  useEffect(() => {
    if (plan === "new") setF(blank);
    else if (plan) setF({ name: plan.name, nameEn: plan.nameEn ?? "", description: plan.description ?? "", kind: plan.kind, price: String(Number(plan.price)), durationDays: String(plan.durationDays),
      visitsLimit: String(plan.visitsLimit ?? ""), maxFreezeDays: String(plan.maxFreezeDays), allServices: plan.allServices, serviceIds: plan.services.map((s) => s.serviceId), isActive: plan.isActive });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  const toggle = (sid: string) => setF((x) => ({ ...x, serviceIds: x.serviceIds.includes(sid) ? x.serviceIds.filter((y) => y !== sid) : [...x.serviceIds, sid] }));
  return (
    <Modal open={!!plan} onClose={onClose} wide title={isNew ? tr("باقة اشتراك جديدة", "New subscription plan") : tr("تعديل الباقة", "Edit plan")}
      footer={<div className="flex w-full justify-between">
        <div>{!isNew && can("subscriptions.delete") && <Button variant="ghost" className="text-danger" loading={del.pending} onClick={async () => { if (await del.run(() => api(`/api/subscription-plans/${(plan as Plan).id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) onSaved(); }}>{tr("حذف", "Delete")}</Button>}</div>
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="plan3" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></div>
      </div>}>
      <form id="plan3" className="grid gap-4 sm:grid-cols-3" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api(isNew ? "/api/subscription-plans" : `/api/subscription-plans/${(plan as Plan).id}`, { method: isNew ? "POST" : "PATCH", body: f }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("الاسم", "Name")} error={fields.name} className="sm:col-span-2"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("الاسم بالإنجليزية", "English name")}><Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <Field label={tr("النوع", "Type")}><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(SUB_KIND).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select></Field>
        <Field label={tr("المدة (يوم)", "Duration (days)")} error={fields.durationDays}><Input type="number" min={1} dir="ltr" value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} /></Field>
        {f.kind !== "TIME" ? <Field label={tr("عدد الزيارات / الجلسات", "Visits / sessions")} error={fields.visitsLimit}><Input type="number" min={1} dir="ltr" value={f.visitsLimit} onChange={(e) => setF({ ...f, visitsLimit: e.target.value })} /></Field> : <div />}
        <Field label={tr("السعر", "Price")}><Input type="number" min={0} step="any" dir="ltr" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label={tr("أقصى أيام تجميد", "Max freeze days")}><Input type="number" min={0} dir="ltr" value={f.maxFreezeDays} onChange={(e) => setF({ ...f, maxFreezeDays: e.target.value })} /></Field>
        <div className="flex items-end pb-2"><Checkbox label={tr("متاحة للبيع", "Available")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></div>
        <div className="sm:col-span-3 border-t border-line pt-4">
          <Checkbox label={tr("تشمل كل الخدمات", "Covers all services")} checked={f.allServices} onChange={(e) => setF({ ...f, allServices: e.target.checked })} />
          {fields.serviceIds && <p className="mt-1 text-xs text-danger">{fields.serviceIds}</p>}
          {!f.allServices && <div className="mt-3 grid gap-2 sm:grid-cols-3">{cat.data?.services.map((s) => <Checkbox key={s.id} label={s.name} checked={f.serviceIds.includes(s.id)} onChange={() => toggle(s.id)} />)}</div>}
        </div>
      </form>
    </Modal>
  );
}

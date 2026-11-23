"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import ClientPicker, { type PickedClient } from "@/components/clients/ClientPicker";
import { useMoney } from "@/components/billing/useMoney";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Agreement = { id: string; name: string; startDate: string; endDate: string; discountPercent: string; allServices: boolean; serviceIds: string[]; memberTypes: string[]; allowCoupons: boolean; isActive: boolean; notes: string | null };
type Company = { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; taxNo: string | null; notes: string | null; isActive: boolean;
  agreements: Agreement[]; members: { id: string; memberType: string; employeeNo: string | null; validUntil: string | null; client: { id: string; code: string; fullName: string; phone: string } }[];
  invoices: { id: string; code: string; issuedAt: string; total: string; corporateDiscount: string; corporateAgreementId: string; client: { fullName: string } }[];
  byAgreement: { agreementId: string; invoices: number; discount: string; revenue: string }[] };

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Company>(can("corporate.view") ? `/api/corporate/${id}` : null);
  const [agr, setAgr] = useState<Agreement | "new" | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  const [editCo, setEditCo] = useState(false);
  const { pending, run } = useSubmit();
  if (!can("corporate.view")) return <Forbidden />;
  if (loading && !data) return <Card><LoadingBlock cols={4} /></Card>;
  if (!data) return null;
  const today = new Date().toISOString().slice(0, 10);
  const status = (a: Agreement) => (!a.isActive ? ["gray", tr("موقوفة", "Paused")] : a.endDate.slice(0, 10) < today ? ["red", tr("منتهية", "Expired")] : a.startDate.slice(0, 10) > today ? ["blue", tr("قادمة", "Upcoming")] : ["green", tr("سارية", "Active")]) as ["gray" | "red" | "blue" | "green", string];
  return (
    <>
      <PageHeader title={data.name} subtitle={[data.contactName, data.phone, data.email].filter(Boolean).join(" · ") || tr("شركة متعاقدة", "Corporate account")}
        actions={<div className="flex gap-2"><Link href="/corporate"><Button variant="secondary">{tr("رجوع", "Back")}</Button></Link>{can("corporate.update") && <Button variant="secondary" onClick={() => setEditCo(true)}>{tr("تعديل البيانات", "Edit details")}</Button>}</div>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={tr("المستفيدون", "Beneficiaries")} value={data.members.length} />
        <StatCard label={tr("الفواتير", "Invoices")} value={data.invoices.length} />
        <StatCard label={tr("المبيعات", "Sales")} value={money(data.invoices.reduce((s, i) => s + Number(i.total), 0))} />
        <StatCard label={tr("الخصم الممنوح", "Discount given")} value={money(data.invoices.reduce((s, i) => s + Number(i.corporateDiscount), 0))} />
      </div>
      <Card className="mb-4">
        <div className="flex items-center justify-between border-b border-line px-4 py-2"><span className="font-medium">{tr("الاتفاقيات", "Agreements")}</span>{can("corporate.update") && <Button size="sm" onClick={() => setAgr("new")}>+ {tr("اتفاقية", "Agreement")}</Button>}</div>
        <Table head={[tr("الاتفاقية", "Agreement"), tr("المدة", "Period"), tr("الخصم", "Discount"), tr("الخدمات", "Services"), tr("المشمولون", "Covers"), tr("الاستخدام", "Usage"), tr("الحالة", "Status")]}>
          {data.agreements.map((a) => {
            const u = data.byAgreement.find((x) => x.agreementId === a.id);
            const [tone, label] = status(a);
            return (
              <Tr key={a.id} onClick={can("corporate.update") ? () => setAgr(a) : undefined}>
                <Td className="font-medium">{a.name}{a.allowCoupons && <div className="text-xs text-muted">{tr("يسمح بالكوبونات", "Coupons allowed")}</div>}</Td>
                <Td className="text-muted">{fmtDate(a.startDate, locale)} → {fmtDate(a.endDate, locale)}</Td>
                <Td><Badge tone="brand">{Number(a.discountPercent)}%</Badge></Td>
                <Td className="text-muted">{a.allServices ? tr("كل الخدمات", "All services") : tr(`${a.serviceIds.length} خدمة`, `${a.serviceIds.length} services`)}</Td>
                <Td className="text-muted">{a.memberTypes.map((m) => (m === "FAMILY" ? tr("العائلة", "Family") : tr("الموظفون", "Employees"))).join(" + ")}</Td>
                <Td className="tabular text-sm">{u?.invoices ?? 0} · {money(u?.revenue ?? 0)}<div className="text-xs text-muted">{tr("خصم", "disc.")} {money(u?.discount ?? 0)}</div></Td>
                <Td><Badge tone={tone}>{label}</Badge></Td>
              </Tr>
            );
          })}
        </Table>
        {!data.agreements.length && <EmptyState title={tr("لا توجد اتفاقيات", "No agreements yet")} />}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-2"><span className="font-medium">{tr("المستفيدون", "Beneficiaries")}</span>{can("corporate.update") && <Button size="sm" onClick={() => setAddOpen(true)}>+ {tr("مستفيد", "Beneficiary")}</Button>}</div>
          <Table head={[tr("العميل", "Client"), tr("الصفة", "Type"), tr("الرقم الوظيفي", "Employee no."), ""]}>
            {data.members.map((m) => (
              <Tr key={m.id}>
                <Td><Link className="font-medium text-brand hover:underline" href={`/clients/${m.client.id}`}>{m.client.fullName}</Link><div className="text-xs text-muted" dir="ltr">{m.client.phone}</div></Td>
                <Td><Badge tone={m.memberType === "FAMILY" ? "blue" : "gray"}>{m.memberType === "FAMILY" ? tr("عائلة", "Family") : tr("موظف", "Employee")}</Badge></Td>
                <Td dir="ltr" className="text-muted">{m.employeeNo ?? "—"}{m.validUntil && <div className="text-xs">{tr("حتى", "until")} {fmtDate(m.validUntil, locale)}</div>}</Td>
                <Td>{can("corporate.update") && <Button size="sm" variant="ghost" onClick={() => setRemove(m.id)}>{tr("إزالة", "Remove")}</Button>}</Td>
              </Tr>
            ))}
          </Table>
          {!data.members.length && <EmptyState title={tr("لا يوجد مستفيدون", "No beneficiaries")} />}
        </Card>
        <Card>
          <div className="border-b border-line px-4 py-2 font-medium">{tr("فواتير الشركة", "Corporate invoices")}</div>
          <Table head={[tr("الفاتورة", "Invoice"), tr("العميل", "Client"), tr("التاريخ", "Date"), tr("الخصم", "Discount"), tr("الإجمالي", "Total")]}>
            {data.invoices.map((i) => (
              <Tr key={i.id}><Td><Link className="font-mono text-xs text-brand hover:underline" dir="ltr" href={`/invoices/${i.id}`}>{i.code}</Link></Td><Td>{i.client.fullName}</Td><Td className="text-muted">{fmtDate(i.issuedAt, locale)}</Td>
                <Td className="tabular text-muted">{money(i.corporateDiscount)}</Td><Td className="tabular">{money(i.total)}</Td></Tr>
            ))}
          </Table>
          {!data.invoices.length && <EmptyState title={tr("لا توجد فواتير بعد", "No invoices yet")} />}
        </Card>
      </div>
      <AgreementModal companyId={id} a={agr} onClose={() => setAgr(null)} onSaved={() => { setAgr(null); reload(); }} />
      <MemberModal companyId={id} open={addOpen} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload(); }} />
      <CompanyModal c={editCo ? data : null} onClose={() => setEditCo(false)} onSaved={() => { setEditCo(false); reload(); }} />
      <ConfirmModal open={!!remove} onClose={() => setRemove(null)} loading={pending} title={tr("إزالة المستفيد؟", "Remove beneficiary?")} text={tr("لن يحصل على خصم الشركة في الفواتير القادمة.", "They won't get the company discount on future invoices.")}
        confirmLabel={tr("إزالة", "Remove")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => { if (await run(() => api(`/api/corporate/members/${remove}`, { method: "DELETE" }), tr("تمت الإزالة", "Removed"))) { setRemove(null); reload(); } }} />
    </>
  );
}

function AgreementModal({ companyId, a, onClose, onSaved }: { companyId: string; a: Agreement | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr, locale } = useSession();
  const services = useResource<{ services: { id: string; name: string; nameEn: string | null }[] }>(a ? "/api/catalog?active=1" : null);
  const isNew = a === "new";
  const year = new Date().getUTCFullYear();
  const blank = { name: tr(`اتفاقية ${year}`, `${year} agreement`), startDate: `${year}-01-01`, endDate: `${year}-12-31`, discountPercent: "10", allServices: true, serviceIds: [] as string[], family: false, allowCoupons: false, isActive: true, notes: "" };
  const [f, setF] = useState(blank);
  const [for_, setFor] = useState<string | null>(null);
  const key = a === "new" ? "new" : a?.id ?? null;
  if (key !== for_) {
    setFor(key);
    setF(a && a !== "new" ? { name: a.name, startDate: a.startDate.slice(0, 10), endDate: a.endDate.slice(0, 10), discountPercent: String(Number(a.discountPercent)), allServices: a.allServices, serviceIds: a.serviceIds, family: a.memberTypes.includes("FAMILY"), allowCoupons: a.allowCoupons, isActive: a.isActive, notes: a.notes ?? "" } : blank);
  }
  const { pending, fields, run } = useSubmit();
  const svcList = services.data?.services ?? [];
  return (
    <Modal open={!!a} onClose={onClose} wide title={isNew ? tr("اتفاقية جديدة", "New agreement") : tr("تعديل الاتفاقية", "Edit agreement")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="agr" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="agr" className="grid gap-3 sm:grid-cols-3" onSubmit={async (e) => {
        e.preventDefault();
        const body = { name: f.name, startDate: f.startDate, endDate: f.endDate, discountPercent: Number(f.discountPercent), allServices: f.allServices, serviceIds: f.allServices ? [] : f.serviceIds,
          memberTypes: f.family ? ["EMPLOYEE", "FAMILY"] : ["EMPLOYEE"], allowCoupons: f.allowCoupons, isActive: f.isActive, notes: f.notes || null };
        if (await run(() => api(isNew ? `/api/corporate/${companyId}/agreements` : `/api/corporate/${companyId}/agreements/${(a as Agreement).id}`, { method: isNew ? "POST" : "PATCH", body }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("الاسم", "Name")} className="sm:col-span-3" error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("من", "From")}><Input type="date" dir="ltr" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label={tr("إلى", "To")} error={fields.endDate}><Input type="date" dir="ltr" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label={tr("نسبة الخصم %", "Discount %")} error={fields.discountPercent}><Input type="number" min={0.01} max={100} step="any" dir="ltr" required value={f.discountPercent} onChange={(e) => setF({ ...f, discountPercent: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-4 sm:col-span-3">
          <Checkbox label={tr("تشمل عائلات الموظفين", "Covers employees' families")} checked={f.family} onChange={(e) => setF({ ...f, family: e.target.checked })} />
          <Checkbox label={tr("يمكن الجمع مع الكوبونات", "Can combine with coupons")} checked={f.allowCoupons} onChange={(e) => setF({ ...f, allowCoupons: e.target.checked })} />
          <Checkbox label={tr("سارية", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          <Checkbox label={tr("كل الخدمات", "All services")} checked={f.allServices} onChange={(e) => setF({ ...f, allServices: e.target.checked })} />
        </div>
        {!f.allServices && <div className="max-h-56 overflow-y-auto rounded-lg border border-line p-2 sm:col-span-3">
          {fields.serviceIds && <p className="text-xs text-danger">{fields.serviceIds}</p>}
          <div className="grid gap-1 sm:grid-cols-2">{svcList.map((s) => <Checkbox key={s.id} label={locale === "en" && s.nameEn ? s.nameEn : s.name} checked={f.serviceIds.includes(s.id)} onChange={(e) => setF({ ...f, serviceIds: e.target.checked ? [...f.serviceIds, s.id] : f.serviceIds.filter((x) => x !== s.id) })} />)}</div>
        </div>}
        <Field label={tr("ملاحظات", "Notes")} className="sm:col-span-3"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

function MemberModal({ companyId, open, onClose, onSaved }: { companyId: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [f, setF] = useState({ memberType: "EMPLOYEE", employeeNo: "", validUntil: "" });
  const { pending, run } = useSubmit();
  return (
    <Modal open={open} onClose={onClose} title={tr("إضافة مستفيد", "Add beneficiary")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button disabled={!client} loading={pending} onClick={async () => {
        if (await run(() => api(`/api/corporate/${companyId}/members`, { method: "POST", body: { clientId: client!.id, ...f, employeeNo: f.employeeNo || null, validUntil: f.validUntil || null } }), tr("تمت الإضافة", "Added"))) { setClient(null); onSaved(); }
      }}>{tr("إضافة", "Add")}</Button></>}>
      <div className="space-y-3">
        <ClientPicker value={client} onChange={setClient} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={tr("الصفة", "Type")}><Select value={f.memberType} onChange={(e) => setF({ ...f, memberType: e.target.value })}><option value="EMPLOYEE">{tr("موظف", "Employee")}</option><option value="FAMILY">{tr("فرد عائلة", "Family member")}</option></Select></Field>
          <Field label={tr("الرقم الوظيفي", "Employee no.")}><Input dir="ltr" value={f.employeeNo} onChange={(e) => setF({ ...f, employeeNo: e.target.value })} /></Field>
          <Field label={tr("صالح حتى", "Valid until")}><Input type="date" dir="ltr" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-muted">{tr("سيُصنّف العميل «شركات» ويحصل على الخصم تلقائياً.", "The client is tagged “Corporate” and gets the discount automatically.")}</p>
      </div>
    </Modal>
  );
}

function CompanyModal({ c, onClose, onSaved }: { c: Company | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const [f, setF] = useState({ name: "", contactName: "", phone: "", email: "", address: "", taxNo: "", notes: "", isActive: true });
  const [for_, setFor] = useState<string | null>(null);
  if ((c?.id ?? null) !== for_) { setFor(c?.id ?? null); if (c) setF({ name: c.name, contactName: c.contactName ?? "", phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", taxNo: c.taxNo ?? "", notes: c.notes ?? "", isActive: c.isActive }); }
  const { pending, fields, run } = useSubmit();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={!!c} onClose={onClose} title={tr("بيانات الشركة", "Company details")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="coe" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="coe" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/api/corporate/${c!.id}`, { method: "PATCH", body: f }), tr("تم الحفظ", "Saved"))) onSaved(); }}>
        <Field label={tr("الاسم", "Name")} className="sm:col-span-2" error={fields.name}><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label={tr("المسؤول", "Contact")}><Input value={f.contactName} onChange={set("contactName")} /></Field>
        <Field label={tr("الهاتف", "Phone")}><Input dir="ltr" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={tr("البريد", "Email")}><Input type="email" dir="ltr" value={f.email} onChange={set("email")} /></Field>
        <Field label={tr("الرقم الضريبي", "Tax no.")}><Input dir="ltr" value={f.taxNo} onChange={set("taxNo")} /></Field>
        <Field label={tr("العنوان", "Address")} className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
        <Checkbox label={tr("فعّالة", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
      </form>
    </Modal>
  );
}

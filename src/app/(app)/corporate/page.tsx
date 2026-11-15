"use client";
import Link from "next/link";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Company = { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; isActive: boolean; _count: { members: number };
  activeAgreement: { name: string; discountPercent: string; endDate: string } | null; usage: { invoices: number; discount: string; revenue: string } };

export default function CorporatePage() {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Company[]>(can("corporate.view") ? "/api/corporate" : null);
  const [create, setCreate] = useState(false);
  const [f, setF] = useState({ name: "", contactName: "", phone: "", email: "" });
  const { pending, fields, run } = useSubmit();
  if (!can("corporate.view")) return <Forbidden />;
  const rows = data ?? [];
  return (
    <>
      <PageHeader title={tr("الشركات المتعاقدة", "Corporate contracts")} subtitle={tr("اتفاقيات خصم مع الشركات لموظفيها وعائلاتهم. يُطبّق الخصم تلقائياً عند فوترة المستفيد.", "Discount agreements with companies for their staff and families. Applied automatically when a beneficiary is invoiced.")}
        actions={can("corporate.create") && <Button onClick={() => setCreate(true)}>+ {tr("شركة", "Company")}</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={tr("الشركات", "Companies")} value={rows.length} />
        <StatCard label={tr("المستفيدون", "Beneficiaries")} value={rows.reduce((s, c) => s + c._count.members, 0)} />
        <StatCard label={tr("مبيعات الشركات", "Corporate sales")} value={money(rows.reduce((s, c) => s + Number(c.usage.revenue), 0))} />
        <StatCard label={tr("الخصومات الممنوحة", "Discounts given")} value={money(rows.reduce((s, c) => s + Number(c.usage.discount), 0))} />
      </div>
      <Card>
        <Table head={[tr("الشركة", "Company"), tr("الاتفاقية الحالية", "Current agreement"), tr("المستفيدون", "Beneficiaries"), tr("الفواتير", "Invoices"), tr("المبيعات", "Sales"), tr("الخصم", "Discount")]}>
          {loading && !data ? <LoadingRows cols={6} /> : rows.map((c) => (
            <Tr key={c.id}>
              <Td className="font-medium"><Link className="text-brand hover:underline" href={`/corporate/${c.id}`}>{c.name}</Link>{c.contactName && <div className="text-xs text-muted">{c.contactName}</div>}</Td>
              <Td>{c.activeAgreement ? <><Badge tone="green">{Number(c.activeAgreement.discountPercent)}%</Badge> <span className="text-xs text-muted">{tr("حتى", "until")} {fmtDate(c.activeAgreement.endDate, locale)}</span></> : <Badge tone="gray">{tr("لا توجد اتفاقية سارية", "No active agreement")}</Badge>}</Td>
              <Td className="tabular">{c._count.members}</Td><Td className="tabular">{c.usage.invoices}</Td><Td className="tabular">{money(c.usage.revenue)}</Td><Td className="tabular text-muted">{money(c.usage.discount)}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && !rows.length && <EmptyState title={tr("لا توجد شركات متعاقدة", "No corporate accounts")} />}
      </Card>
      <Modal open={create} onClose={() => setCreate(false)} title={tr("شركة جديدة", "New company")}
        footer={<><Button variant="secondary" onClick={() => setCreate(false)}>{tr("إلغاء", "Cancel")}</Button><Button form="co" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
        <form id="co" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("/api/corporate", { method: "POST", body: f }), tr("تمت الإضافة", "Added"))) { setCreate(false); setF({ name: "", contactName: "", phone: "", email: "" }); reload(); } }}>
          <Field label={tr("اسم الشركة", "Company name")} className="sm:col-span-2" error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={tr("المسؤول", "Contact")}><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
          <Field label={tr("الهاتف", "Phone")}><Input dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label={tr("البريد", "Email")} className="sm:col-span-2" error={fields.email}><Input type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </form>
      </Modal>
    </>
  );
}

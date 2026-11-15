"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { InventoryTabs, type Supplier, type Warehouse, useWarehouses } from "@/components/inventory/shared";
import { api } from "@/lib/client";

type Group = { id: string; name: string; parentId: string | null; sortOrder: number; _count: { items: number } };

export default function InventorySetupPage() {
  const { tr, can } = useSession();
  if (!can("inventory.view")) return <Forbidden />;
  return (
    <>
      <PageHeader title={tr("المخازن", "Inventory")} subtitle={tr("المخازن لكل فرع، مجموعات الأصناف، والموردون وأرصدتهم.", "Warehouses per branch, item groups, and suppliers with their balances.")} />
      <InventoryTabs active="setup" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Warehouses />
        <Groups />
      </div>
      <div className="mt-4"><Suppliers /></div>
    </>
  );
}

function Warehouses() {
  const { tr, can } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useWarehouses();
  const branches = useResource<{ id: string; name: string }[]>(can("branches.view") ? "/api/branches" : null);
  const [edit, setEdit] = useState<Warehouse | "new" | null>(null);
  const [f, setF] = useState({ branchId: "", code: "", name: "", isDefault: false, isActive: true });
  const { pending, fields, run } = useSubmit();
  const openEdit = (w: Warehouse | "new") => { setEdit(w); setF(w === "new" ? { branchId: branches.data?.[0]?.id ?? "", code: "", name: "", isDefault: false, isActive: true } : { branchId: w.branchId, code: w.code, name: w.name, isDefault: w.isDefault, isActive: w.isActive }); };
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-2"><span className="font-medium">{tr("المخازن", "Warehouses")}</span>{can("inventory.create") && <Button size="sm" onClick={() => openEdit("new")}>+ {tr("مخزن", "Warehouse")}</Button>}</div>
      <Table head={[tr("المخزن", "Warehouse"), tr("الفرع", "Branch"), tr("الأصناف", "Items"), tr("القيمة", "Value")]}>
        {loading && !data ? <LoadingRows cols={4} /> : (data ?? []).map((w) => (
          <Tr key={w.id} onClick={can("inventory.update") ? () => openEdit(w) : undefined}>
            <Td className="font-medium">{w.name} <span dir="ltr" className="text-xs text-muted">{w.code}</span> {w.isDefault && <Badge tone="brand">{tr("افتراضي", "Default")}</Badge>} {!w.isActive && <Badge>{tr("معطل", "Inactive")}</Badge>}</Td>
            <Td className="text-muted">{w.branch.name}</Td><Td className="tabular">{w.items}</Td><Td className="tabular">{money(w.value)}</Td>
          </Tr>
        ))}
      </Table>
      <p className="px-4 py-2 text-xs text-muted">{tr("المخزن الافتراضي للفرع تُصرف منه المبيعات ومواد الخدمات تلقائياً.", "A branch's default warehouse feeds its sales and automatic service consumption.")}</p>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? tr("مخزن جديد", "New warehouse") : tr("تعديل المخزن", "Edit warehouse")}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{tr("إلغاء", "Cancel")}</Button><Button form="wh" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
        <form id="wh" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api(edit === "new" ? "/api/inventory/warehouses" : `/api/inventory/warehouses/${(edit as Warehouse).id}`, { method: edit === "new" ? "POST" : "PATCH", body: f }), tr("تم الحفظ", "Saved"))) { setEdit(null); reload(); }
        }}>
          <Field label={tr("الفرع", "Branch")}><Select required value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label={tr("الرمز", "Code")} error={fields.code}><Input dir="ltr" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label={tr("الاسم", "Name")} className="sm:col-span-2" error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Checkbox label={tr("المخزن الافتراضي للفرع", "Branch default")} checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
          <Checkbox label={tr("فعّال", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}

function Groups() {
  const { tr, can } = useSession();
  const { data, loading, reload } = useResource<Group[]>("/api/inventory/groups");
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<Group | null>(null);
  const { pending, run } = useSubmit();
  return (
    <Card>
      <div className="border-b border-line px-4 py-2 font-medium">{tr("مجموعات الأصناف", "Item groups")}</div>
      {can("inventory.create") && <form className="flex gap-2 border-b border-line p-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("/api/inventory/groups", { method: "POST", body: { name } }), tr("تمت الإضافة", "Added"))) { setName(""); reload(); } }}>
        <Input placeholder={tr("اسم المجموعة", "Group name")} value={name} onChange={(e) => setName(e.target.value)} required /><Button type="submit" loading={pending}>{tr("إضافة", "Add")}</Button>
      </form>}
      <Table head={[tr("المجموعة", "Group"), tr("الأصناف", "Items")]}>
        {loading && !data ? <LoadingRows cols={2} /> : (data ?? []).map((g) => (
          <Tr key={g.id} onClick={can("inventory.update") ? () => setEdit(g) : undefined}><Td className="font-medium">{edit?.id === g.id
            ? <form className="flex gap-2" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/api/inventory/groups/${g.id}`, { method: "PATCH", body: { name: edit.name, sortOrder: g.sortOrder, parentId: g.parentId } }), tr("تم الحفظ", "Saved"))) { setEdit(null); reload(); } }}>
                <Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /><Button size="sm" type="submit">{tr("حفظ", "Save")}</Button></form>
            : g.name}</Td><Td className="tabular">{g._count.items}</Td></Tr>
        ))}
      </Table>
      {!loading && !data?.length && <EmptyState title={tr("لا توجد مجموعات", "No groups")} />}
    </Card>
  );
}

function Suppliers() {
  const { tr, can } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Supplier[]>("/api/inventory/suppliers");
  const bal = useResource<{ supplier: { id: string }; balance: string }[]>("/api/accounting/reports/payables");
  const blank = { name: "", contactName: "", phone: "", email: "", address: "", taxNo: "", notes: "", isActive: true };
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);
  const [f, setF] = useState(blank);
  const { pending, fields, run } = useSubmit();
  const open = (s: Supplier | "new") => { setEdit(s); setF(s === "new" ? blank : { name: s.name, contactName: s.contactName ?? "", phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", taxNo: s.taxNo ?? "", notes: s.notes ?? "", isActive: s.isActive }); };
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-2"><span className="font-medium">{tr("الموردون", "Suppliers")}</span>{can("inventory.create") && <Button size="sm" onClick={() => open("new")}>+ {tr("مورد", "Supplier")}</Button>}</div>
      <Table head={[tr("المورد", "Supplier"), tr("المسؤول", "Contact"), tr("الهاتف", "Phone"), tr("المستحق له", "We owe"), tr("الحالة", "Status")]}>
        {loading && !data ? <LoadingRows cols={5} /> : (data ?? []).map((s) => {
          const b = bal.data?.find((x) => x.supplier.id === s.id)?.balance;
          return (
            <Tr key={s.id} onClick={can("inventory.update") ? () => open(s) : undefined}>
              <Td className="font-medium">{s.name}</Td><Td className="text-muted">{s.contactName ?? "—"}</Td><Td dir="ltr" className="text-muted">{s.phone ?? "—"}</Td>
              <Td className="tabular">{b ? <span className={Number(b) > 0 ? "text-danger" : ""}>{money(b)}</span> : "—"}</Td>
              <Td><Badge tone={s.isActive ? "green" : "gray"}>{s.isActive ? tr("فعّال", "Active") : tr("موقوف", "Inactive")}</Badge></Td>
            </Tr>
          );
        })}
      </Table>
      {!loading && !data?.length && <EmptyState title={tr("لا يوجد موردون", "No suppliers")} />}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? tr("مورد جديد", "New supplier") : tr("تعديل المورد", "Edit supplier")}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{tr("إلغاء", "Cancel")}</Button><Button form="sup" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
        <form id="sup" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api(edit === "new" ? "/api/inventory/suppliers" : `/api/inventory/suppliers/${(edit as Supplier).id}`, { method: edit === "new" ? "POST" : "PATCH", body: f }), tr("تم الحفظ", "Saved"))) { setEdit(null); reload(); }
        }}>
          <Field label={tr("الاسم", "Name")} error={fields.name} className="sm:col-span-2"><Input required value={f.name} onChange={set("name")} /></Field>
          <Field label={tr("المسؤول", "Contact person")}><Input value={f.contactName} onChange={set("contactName")} /></Field>
          <Field label={tr("الهاتف", "Phone")}><Input dir="ltr" value={f.phone} onChange={set("phone")} /></Field>
          <Field label={tr("البريد", "Email")} error={fields.email}><Input type="email" dir="ltr" value={f.email} onChange={set("email")} /></Field>
          <Field label={tr("الرقم الضريبي", "Tax no.")}><Input dir="ltr" value={f.taxNo} onChange={set("taxNo")} /></Field>
          <Field label={tr("العنوان", "Address")} className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
          <Checkbox label={tr("فعّال", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, ConfirmModal, Field, Input, LoadingRows, Modal, PageHeader, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";

type Branch = { id: string; name: string; code: string; phone: string | null; address: string | null; isMain: boolean; isActive: boolean; users: number };

export default function BranchesPage() {
  const s = useSession();
  const { tr, can } = s;
  const { data, loading, reload } = useResource<Branch[]>(can("branches.view") ? "/api/branches" : null);
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const del = useSubmit();
  if (!can("branches.view")) return <Forbidden />;

  return (
    <>
      <PageHeader title={tr("الفروع", "Branches")}
        subtitle={s.tenant?.plan ? `${data?.length ?? "…"} / ${s.tenant.plan.maxBranches} ${tr("فرع حسب الباقة", "branches on your plan")}` : undefined}
        actions={can("branches.create") && <Button onClick={() => setEditing("new")}>+ {tr("فرع جديد", "New branch")}</Button>} />
      <Card>
        <Table head={[tr("الفرع", "Branch"), tr("الرمز", "Code"), tr("الهاتف", "Phone"), tr("العنوان", "Address"), tr("المستخدمون", "Users"), tr("الحالة", "Status"), ""]}>
          {loading ? <LoadingRows cols={7} /> : data?.map((b) => (
            <Tr key={b.id}>
              <Td><span className="font-medium">{b.name}</span> {b.isMain && <Badge tone="brand">{tr("رئيسي", "Main")}</Badge>}</Td>
              <Td className="text-muted"><span dir="ltr">{b.code}</span></Td>
              <Td className="text-muted"><span dir="ltr">{b.phone ?? "—"}</span></Td>
              <Td className="text-muted">{b.address ?? "—"}</Td>
              <Td className="tabular">{b.users}</Td>
              <Td><Badge tone={b.isActive ? "green" : "gray"}>{b.isActive ? tr("نشط", "Active") : tr("معطل", "Inactive")}</Badge></Td>
              <Td className="text-end whitespace-nowrap">
                {can("branches.update") && <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>{tr("تعديل", "Edit")}</Button>}
                {can("branches.delete") && !b.isMain && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(b)}>{tr("حذف", "Delete")}</Button>}
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>
      <BranchModal branch={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} loading={del.pending}
        title={tr("حذف الفرع", "Delete branch")}
        text={tr("سيتم حذف الفرع وإزالة صلاحيات المستخدمين عليه. يُفضّل التعطيل إذا كان للفرع بيانات.", "The branch and user access to it are removed. Prefer deactivating if it has data.")}
        confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => {
          const ok = await del.run(() => api(`/api/branches/${deleting!.id}`, { method: "DELETE" }), tr("تم حذف الفرع", "Branch deleted"));
          setDeleting(null);
          if (ok) reload();
        }} />
    </>
  );
}

function BranchModal({ branch, onClose, onSaved }: { branch: Branch | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const isNew = branch === "new";
  const { pending, fields, run } = useSubmit();
  const [f, setF] = useState({ name: "", code: "", phone: "", address: "", isActive: true });
  useEffect(() => {
    if (branch === "new") setF({ name: "", code: "", phone: "", address: "", isActive: true });
    else if (branch) setF({ name: branch.name, code: branch.code, phone: branch.phone ?? "", address: branch.address ?? "", isActive: branch.isActive });
  }, [branch]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() => api(isNew ? "/api/branches" : `/api/branches/${(branch as Branch).id}`, { method: isNew ? "POST" : "PATCH", body: f }), tr("تم حفظ الفرع", "Branch saved"));
    if (ok) onSaved();
  }
  return (
    <Modal open={!!branch} onClose={onClose} title={isNew ? tr("فرع جديد", "New branch") : tr("تعديل الفرع", "Edit branch")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="branch-form" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="branch-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("اسم الفرع", "Name")} error={fields.name}><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label={tr("الرمز", "Code")} error={fields.code} hint="A-Z, 0-9"><Input required dir="ltr" value={f.code} onChange={set("code")} /></Field>
        <Field label={tr("الهاتف", "Phone")}><Input dir="ltr" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={tr("العنوان", "Address")}><Input value={f.address} onChange={set("address")} /></Field>
        {!(branch !== "new" && branch?.isMain) && <Checkbox label={tr("الفرع نشط", "Branch is active")} checked={f.isActive} onChange={set("isActive")} />}
      </form>
    </Modal>
  );
}

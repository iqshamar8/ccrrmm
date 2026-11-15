"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import type { Room } from "@/components/appointments/shared";
import { api } from "@/lib/client";
import { ROOM_KIND, roomKindLabel } from "@/lib/labels2";

export default function RoomsPage() {
  const { tr, locale, can } = useSession();
  const { data, loading, reload } = useResource<Room[]>(can("branches.view") ? "/api/rooms" : null);
  const branches = useResource<{ id: string; name: string }[]>(can("branches.view") ? "/api/branches" : null);
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const [deleting, setDeleting] = useState<Room | null>(null);
  const del = useSubmit();
  if (!can("branches.view")) return <Forbidden />;
  return (
    <>
      <PageHeader title={tr("غرف العلاج والعمليات", "Rooms")} subtitle={tr("تُستخدم في الحجز لمنع تعارض الغرف وعرض جدول كل غرفة", "Used when booking to prevent room clashes and show each room's schedule")}
        actions={can("branches.update") && <Button onClick={() => setEditing("new")}>+ {tr("غرفة", "Room")}</Button>} />
      <Card>
        <Table head={[tr("الغرفة", "Room"), tr("النوع", "Type"), tr("الفرع", "Branch"), tr("الحالة", "Status"), ""]}>
          {loading ? <LoadingRows cols={5} /> : data?.map((r) => (
            <Tr key={r.id}>
              <Td className="font-medium">{r.name}</Td><Td className="text-muted">{roomKindLabel(r.kind, locale)}</Td><Td className="text-muted">{r.branch.name}</Td>
              <Td><Badge tone={r.isActive ? "green" : "gray"}>{r.isActive ? tr("متاحة", "Active") : tr("معطلة", "Inactive")}</Badge></Td>
              <Td className="text-end whitespace-nowrap">{can("branches.update") && <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>{tr("تعديل", "Edit")}</Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(r)}>{tr("حذف", "Delete")}</Button></>}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && data?.length === 0 && <EmptyState title={tr("لا توجد غرف", "No rooms yet")} />}
      </Card>
      <RoomModal room={editing} branches={branches.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} loading={del.pending} title={tr("حذف الغرفة", "Delete room")}
        text={tr("ستبقى المواعيد السابقة بدون غرفة. يُفضّل التعطيل.", "Past appointments will lose the room reference. Prefer deactivating.")}
        confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => { if (await del.run(() => api(`/api/rooms/${deleting!.id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) { setDeleting(null); reload(); } }} />
    </>
  );
}

function RoomModal({ room, branches, onClose, onSaved }: { room: Room | "new" | null; branches: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const { pending, fields, run } = useSubmit();
  const [f, setF] = useState({ name: "", kind: "TREATMENT", branchId: "", isActive: true });
  useEffect(() => {
    if (room === "new") setF({ name: "", kind: "TREATMENT", branchId: branches[0]?.id ?? "", isActive: true });
    else if (room) setF({ name: room.name, kind: room.kind, branchId: room.branchId, isActive: room.isActive });
  }, [room, branches]);
  const isNew = room === "new";
  return (
    <Modal open={!!room} onClose={onClose} title={isNew ? tr("غرفة جديدة", "New room") : tr("تعديل الغرفة", "Edit room")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="room-form" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="room-form" className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api(isNew ? "/api/rooms" : `/api/rooms/${(room as Room).id}`, { method: isNew ? "POST" : "PATCH", body: f }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("اسم الغرفة", "Name")} error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("النوع", "Type")}><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(ROOM_KIND).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select></Field>
        <Field label={tr("الفرع", "Branch")}><Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <div className="flex items-end pb-2"><Checkbox label={tr("متاحة للحجز", "Bookable")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></div>
      </form>
    </Modal>
  );
}

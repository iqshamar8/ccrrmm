"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import ClientPicker, { type PickedClient } from "@/components/clients/ClientPicker";
import { type Catalog, type Room, type Staff, toDateInput } from "@/components/appointments/shared";
import { api, ApiError } from "@/lib/client";
import { TEAM_ROLE } from "@/lib/labels3";
export default function SurgeryForm({ open, surgery, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: (id: string) => void;
  surgery?: { id: string; surgeryType: string; surgeonId: string | null; roomId: string | null; scheduledAt: string; durationMin: number; price: string; anesthesiaType: string | null; branchId: string; team: { userId: string; role: string }[]; client: { id: string; fullName: string } } | null;
}) {
  const { tr } = useSession();
  const edit = !!surgery;
  const staff = useResource<Staff[]>(open ? "/api/staff" : null);
  const rooms = useResource<Room[]>(open ? "/api/rooms" : null);
  const cat = useResource<Catalog>(open ? "/api/catalog?active=1" : null);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [f, setF] = useState({ serviceId: "", surgeryType: "", surgeonId: "", roomId: "", date: "", time: "07:00", durationMin: "120", price: "", anesthesiaType: "", preOpNotes: "", status: "PLANNED" });
  const [team, setTeam] = useState<{ userId: string; role: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useSubmit();
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (surgery) {
      const d = new Date(surgery.scheduledAt);
      setClient({ id: surgery.client.id, fullName: surgery.client.fullName });
      setF({ serviceId: "", surgeryType: surgery.surgeryType, surgeonId: surgery.surgeonId ?? "", roomId: surgery.roomId ?? "", date: toDateInput(d), time: d.toTimeString().slice(0, 5),
        durationMin: String(surgery.durationMin), price: String(Number(surgery.price)), anesthesiaType: surgery.anesthesiaType ?? "", preOpNotes: "", status: "PLANNED" });
      setTeam(surgery.team.map((t) => ({ userId: t.userId, role: t.role })));
    } else {
      setClient(null); setTeam([]);
      const d = new Date(); d.setDate(d.getDate() + 7);
      setF({ serviceId: "", surgeryType: "", surgeonId: "", roomId: "", date: toDateInput(d), time: "07:00", durationMin: "120", price: "", anesthesiaType: "", preOpNotes: "", status: "PLANNED" });
    }
  }, [open, surgery]);
  const surgical = (cat.data?.services ?? []).filter((s) => s.kind === "SURGERY");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pickService = (id: string) => { const s = surgical.find((x) => x.id === id); setF((x) => ({ ...x, serviceId: id, surgeryType: s?.name ?? x.surgeryType, durationMin: s ? String(s.durationMin) : x.durationMin, price: s ? String(Number(s.price)) : x.price })); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const scheduledAt = new Date(`${f.date}T${f.time}:00`);
    const body = edit
      ? { surgeryType: f.surgeryType, surgeonId: f.surgeonId, roomId: f.roomId || null, scheduledAt, durationMin: f.durationMin, price: f.price || 0, anesthesiaType: f.anesthesiaType, team }
      : { clientId: client?.id, serviceId: f.serviceId || null, surgeryType: f.surgeryType || undefined, surgeonId: f.surgeonId, roomId: f.roomId || null, scheduledAt, durationMin: f.durationMin,
          price: f.price === "" ? undefined : f.price, anesthesiaType: f.anesthesiaType, preOpNotes: f.preOpNotes, status: f.status, team };
    try {
      const r = await api<{ id: string }>(edit ? `/api/surgeries/${surgery!.id}` : "/api/surgeries", { method: edit ? "PATCH" : "POST", body });
      await run(async () => r, edit ? tr("تم تحديث العملية", "Surgery updated") : tr("تمت جدولة العملية", "Surgery scheduled"));
      onSaved(r.id);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "SLOT_CONFLICT" ? `${tr("تعارض في الموعد", "Time conflict")}: ${err.message}` : err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide title={edit ? tr("تعديل / إعادة جدولة العملية", "Edit / reschedule surgery") : tr("جدولة عملية جراحية", "Schedule surgery")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="surg" type="submit" loading={pending} disabled={!client || !f.surgeonId}>{tr("حفظ", "Save")}</Button></>}>
      <form id="surg" onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        {error && <p role="alert" className="sm:col-span-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="sm:col-span-3"><span className="mb-1.5 block text-sm font-medium">{tr("المريض", "Patient")}</span><ClientPicker value={client} onChange={setClient} locked={edit} /></div>
        {!edit && (
          <Field label={tr("من خدمات العمليات", "From surgical services")}>
            <Select value={f.serviceId} onChange={(e) => pickService(e.target.value)}><option value="">—</option>{surgical.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </Field>
        )}
        <Field label={tr("نوع العملية", "Surgery type")} className={edit ? "sm:col-span-3" : "sm:col-span-2"}><Input required value={f.surgeryType} onChange={set("surgeryType")} /></Field>
        <Field label={tr("الجراح", "Surgeon")}><Select required value={f.surgeonId} onChange={set("surgeonId")}><option value="">—</option>{staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select></Field>
        <Field label={tr("غرفة العمليات", "Operating room")}>
          <Select value={f.roomId} onChange={set("roomId")}><option value="">—</option>{rooms.data?.filter((r) => r.isActive).sort((a, b) => (a.kind === "OPERATING" ? -1 : 1) - (b.kind === "OPERATING" ? -1 : 1)).map((r) => <option key={r.id} value={r.id}>{r.name} · {r.branch.name}</option>)}</Select>
        </Field>
        <Field label={tr("نوع التخدير", "Anesthesia")}><Input value={f.anesthesiaType} onChange={set("anesthesiaType")} placeholder={tr("عام / موضعي…", "General / local…")} /></Field>
        <Field label={tr("التاريخ", "Date")}><Input type="date" dir="ltr" required value={f.date} onChange={set("date")} /></Field>
        <Field label={tr("الوقت", "Time")}><Input type="time" dir="ltr" required value={f.time} onChange={set("time")} /></Field>
        <Field label={tr("المدة (دقيقة)", "Duration (min)")}><Input type="number" min={15} step={15} dir="ltr" value={f.durationMin} onChange={set("durationMin")} /></Field>
        <Field label={tr("التكلفة", "Cost")}><Input type="number" min={0} step="any" dir="ltr" value={f.price} onChange={set("price")} /></Field>
        {!edit && <Field label={tr("الحالة", "Status")}><Select value={f.status} onChange={set("status")}><option value="PLANNED">{tr("مخطط لها", "Planned")}</option><option value="CONFIRMED">{tr("مؤكدة", "Confirmed")}</option></Select></Field>}
        <div className="sm:col-span-3 border-t border-line pt-4">
          <p className="mb-2 text-sm font-medium">{tr("الفريق الطبي", "Medical team")}</p>
          {team.map((m, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Select className="min-w-0 flex-1" value={m.userId} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))}>
                <option value="">—</option>{staff.data?.filter((s) => s.id !== f.surgeonId).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </Select>
              <Select className="w-40" value={m.role} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                {Object.entries(TEAM_ROLE).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
              </Select>
              <Button type="button" variant="ghost" onClick={() => setTeam(team.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => setTeam([...team.filter((t) => t.userId), { userId: "", role: "ASSISTANT" }])}>+ {tr("عضو", "Member")}</Button>
          <p className="mt-2 text-xs text-muted">{tr("يُحجز وقت الجراح وغرفة العمليات في التقويم، ويُتحقق من تفرغ أعضاء الفريق.", "Surgeon and operating room are booked on the calendar; team availability is checked.")}</p>
        </div>
        {!edit && (
          <Field label={tr("ملاحظات ما قبل العملية", "Pre-op notes")} className="sm:col-span-3">
            <textarea rows={2} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={f.preOpNotes} onChange={set("preOpNotes")} />
          </Field>
        )}
      </form>
    </Modal>
  );
}

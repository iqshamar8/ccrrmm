"use client";
import { useEffect, useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession, useToast } from "@/components/providers";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import ClientPicker, { type PickedClient } from "@/components/clients/ClientPicker";
import { type Staff, toDateInput } from "@/components/appointments/shared";
import { api } from "@/lib/client";
import { ConflictNotice, asSlotConflict, type SlotConflict } from "@/components/ConflictNotice";
import { REVIEW_REASON } from "@/lib/labels3";

export type ReviewPreset = { client?: PickedClient; doctorId?: string; surgeryId?: string; clientProgramId?: string; reasonType?: string; reason?: string };

/** Schedule a medical review (books the doctor's calendar). */
export default function ReviewForm({ open, preset, onClose, onSaved }: { open: boolean; preset?: ReviewPreset | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const toast = useToast();
  const staff = useResource<Staff[]>(open ? "/api/staff" : null);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [f, setF] = useState({ doctorId: "", reasonType: "ROUTINE", reason: "", date: "", time: "17:00", durationMin: "20" });
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SlotConflict | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!open) return;
    const d = new Date(); d.setDate(d.getDate() + 7);
    setClient(preset?.client ?? null); setError(null); setConflict(null);
    setF({ doctorId: preset?.doctorId ?? "", reasonType: preset?.reasonType ?? "ROUTINE", reason: preset?.reason ?? "", date: toDateInput(d), time: "17:00", durationMin: "20" });
  }, [open, preset]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const doctors = (staff.data ?? []).filter((s) => ["doctor", "nurse", "tenant_admin", "branch_manager"].includes(s.role?.key ?? "") || s.id === f.doctorId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true); setError(null); setConflict(null);
    try {
      await api("/api/reviews", { body: {
        clientId: client!.id, doctorId: f.doctorId, reasonType: f.reasonType, reason: f.reason, scheduledAt: new Date(`${f.date}T${f.time}:00`), durationMin: f.durationMin,
        surgeryId: preset?.surgeryId ?? null, clientProgramId: preset?.clientProgramId ?? null,
      } });
      toast("success", tr("تمت جدولة المراجعة", "Review scheduled"));
      onSaved();
    } catch (err) {
      const c = asSlotConflict(err);
      if (c) setConflict(c); else setError(err instanceof Error ? err.message : String(err));
    } finally { setPending(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={tr("جدولة مراجعة طبية", "Schedule a medical review")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="rev" type="submit" loading={pending} disabled={!client || !f.doctorId}>{tr("حفظ", "Save")}</Button></>}>
      <form id="rev" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="sm:col-span-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {conflict && <div className="sm:col-span-2"><ConflictNotice c={conflict} onPick={(iso) => {
          const d = new Date(iso);
          const pad = (n: number) => String(n).padStart(2, "0");
          setF((x) => ({ ...x, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }));
          setConflict(null);
        }} /></div>}
        <div className="sm:col-span-2"><span className="mb-1.5 block text-sm font-medium">{tr("المريض", "Patient")}</span><ClientPicker value={client} onChange={setClient} locked={!!preset?.client} /></div>
        <Field label={tr("الطبيب", "Doctor")}><Select required value={f.doctorId} onChange={set("doctorId")}><option value="">—</option>{doctors.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select></Field>
        <Field label={tr("نوع المراجعة", "Type")}><Select value={f.reasonType} onChange={set("reasonType")}>{Object.entries(REVIEW_REASON).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select></Field>
        <Field label={tr("سبب المراجعة", "Reason")} className="sm:col-span-2"><Input required value={f.reason} onChange={set("reason")} /></Field>
        <Field label={tr("التاريخ", "Date")}><Input type="date" dir="ltr" required value={f.date} onChange={set("date")} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={tr("الوقت", "Time")}><Input type="time" dir="ltr" required value={f.time} onChange={set("time")} /></Field>
          <Field label={tr("المدة", "Minutes")}><Input type="number" min={5} step={5} dir="ltr" value={f.durationMin} onChange={set("durationMin")} /></Field>
        </div>
      </form>
    </Modal>
  );
}

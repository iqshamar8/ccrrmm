"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, StatCard, Table, Td, Tr } from "@/components/ui";
import Progress from "@/components/Progress";
import BillButton from "@/components/billing/BillButton";
import AppointmentForm, { type BookingPreset } from "@/components/appointments/AppointmentForm";
import { fmtTime, toDateInput } from "@/components/appointments/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { APPT_STATUS } from "@/lib/labels2";
import { lbl, PROGRAM_STATUS, REVIEW_STATUS, tone } from "@/lib/labels3";
import type { ProgramRow } from "../page";

type Item = { id: string; serviceId: string; sessionsTotal: number; used: number; booked: number; remaining: number; service: { name: string }; nextAppointment: { startsAt: string; status: string } | null };
type Session = { id: string; itemId: string; sessionNo: number; performedAt: string; notes: string | null; result: string | null; performedBy: string | null; appointmentId: string | null; item: { service: { name: string } } };
type Program = Omit<ProgramRow, "client"> & {
  client: { id: string; fullName: string; code: string; phone: string }; branch: { id: string; name: string }; doctorId: string | null;
  intervalDays: number | null; notes: string | null; results: string | null; cancelReason: string | null; renewedFromId: string | null;
  items: Item[]; sessions: Session[]; reviews: { id: string; scheduledAt: string; status: string; reason: string }[];
};

export default function ProgramDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tr, locale, can } = useSession();
  const router = useRouter();
  const { data: p, loading, reload } = useResource<Program>(`/api/programs/${id}`);
  const [book, setBook] = useState<BookingPreset | null>(null);
  const [record, setRecord] = useState<Item | null>(null);
  const [editSession, setEditSession] = useState<Session | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [results, setResults] = useState("");
  const act = useSubmit();
  useEffect(() => { if (p) setResults(p.results ?? ""); }, [p]);
  if (loading && !p) return <div className="grid place-items-center py-24"><Spinner /></div>;
  if (!p) return <Card><EmptyState title={tr("البرنامج غير موجود", "Program not found")} /></Card>;
  const clinical = can("medical.view_data");
  const editable = can("programs.update");
  const action = async (a: string, extra: Record<string, unknown> = {}) => {
    if (await act.run(() => api(`/api/programs/${id}/status`, { body: { action: a, ...extra } }), tr("تم التحديث", "Updated"))) { setCancelOpen(false); reload(); }
  };

  return (
    <>
      <Link href="/programs" className="mb-3 inline-block text-sm text-muted hover:text-ink">← {tr("البرامج العلاجية", "Programs")}</Link>
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{p.name}</h1>
              <Badge tone={tone(PROGRAM_STATUS, p.status)}>{lbl(PROGRAM_STATUS, p.status, locale)}</Badge>
              {p.stalled && <Badge tone="amber">{tr("متوقف عن المتابعة", "Stalled")}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted">
              <span dir="ltr">{p.code}</span> · <Link className="text-brand" href={`/clients/${p.client.id}`}>{p.client.fullName}</Link> · {p.branch.name}
              {p.doctor && <> · {tr("الطبيب:", "Doctor:")} {p.doctor.fullName}</>}
            </p>
            {p.cancelReason && <p className="mt-1 text-sm text-muted">{tr("سبب الإلغاء:", "Cancel reason:")} {p.cancelReason}</p>}
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              {p.status === "ACTIVE" && <Button variant="secondary" loading={act.pending} onClick={() => action("PAUSE")}>{tr("إيقاف مؤقت", "Pause")}</Button>}
              {p.status === "PAUSED" && <Button loading={act.pending} onClick={() => action("RESUME")}>{tr("استئناف", "Resume")}</Button>}
              {["ACTIVE", "PAUSED", "EXPIRED"].includes(p.status) && <Button variant="secondary" loading={act.pending} onClick={() => action("COMPLETE")}>{tr("إنهاء البرنامج", "Mark complete")}</Button>}
              {can("programs.create") && <Button variant="secondary" loading={act.pending} onClick={async () => { const r = await act.run(() => api<{ id: string }>(`/api/programs/${id}/renew`, { body: {} }), tr("تم تجديد البرنامج", "Program renewed")); if (r) router.push(`/programs/${r.id}`); }}>{tr("تجديد", "Renew")}</Button>}
              {!["COMPLETED", "CANCELLED"].includes(p.status) && <Button variant="ghost" className="text-danger" onClick={() => setCancelOpen(true)}>{tr("إلغاء", "Cancel")}</Button>}
            </div>
          )}
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="mb-2 text-xs text-muted">{tr("نسبة الإنجاز", "Progress")}</p><Progress used={p.progress.used} total={p.progress.total} /></Card>
        <StatCard label={tr("الجلسات المتبقية", "Remaining sessions")} value={p.progress.remaining} />
        <StatCard label={tr("الفترة", "Period")} value={<span className="text-base">{fmtDate(p.startDate, locale)} – {fmtDate(p.endDate, locale)}</span>} hint={p.intervalDays ? `${tr("جلسة كل", "every")} ${p.intervalDays} ${tr("يوم", "days")}` : undefined} />
        <StatCard label={tr("سعر البرنامج", "Program price")} value={<span className="text-xl tabular">{Number(p.price).toLocaleString()}</span>}
          hint={p.status !== "CANCELLED" ? <span className="mt-1 inline-block"><BillButton source="program" id={p.id} size="sm" /></span> : undefined} />
      </div>

      <Card className="mb-4">
        <div className="border-b border-line px-4 py-3 font-medium">{tr("خدمات البرنامج", "Program services")}</div>
        <Table head={[tr("الخدمة", "Service"), tr("المنفذ", "Done"), tr("محجوز", "Booked"), tr("المتبقي", "Left"), tr("الموعد القادم", "Next appointment"), ""]}>
          {p.items.map((i) => (
            <Tr key={i.id}>
              <Td className="font-medium">{i.service.name}</Td>
              <Td><Progress used={i.used} total={i.sessionsTotal} /></Td>
              <Td className="tabular">{i.booked}</Td>
              <Td className="tabular">{i.remaining}</Td>
              <Td className="text-muted whitespace-nowrap">{i.nextAppointment ? <>{fmtDate(i.nextAppointment.startsAt, locale)} {fmtTime(i.nextAppointment.startsAt, locale)} <Badge tone={APPT_STATUS[i.nextAppointment.status].tone}>{tr(APPT_STATUS[i.nextAppointment.status].ar, APPT_STATUS[i.nextAppointment.status].en)}</Badge></> : "—"}</Td>
              <Td className="text-end whitespace-nowrap">
                {p.status === "ACTIVE" && i.remaining - i.booked > 0 && can("appointments.create") && (
                  <Button size="sm" onClick={() => setBook({ client: { id: p.client.id, fullName: p.client.fullName }, branchId: p.branch.id, staffId: p.doctorId ?? undefined, programItemId: i.id, repeatCount: i.remaining - i.booked, intervalDays: p.intervalDays ?? undefined })}>
                    {tr("حجز جلسة", "Book session")}
                  </Button>
                )}
                {p.status === "ACTIVE" && i.remaining > 0 && editable && <Button size="sm" variant="ghost" onClick={() => setRecord(i)}>{tr("تسجيل جلسة", "Record")}</Button>}
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-line px-4 py-3 font-medium">{tr("سجل الجلسات المنفذة", "Session log")}</div>
          <Table head={["#", tr("الخدمة", "Service"), tr("التاريخ", "Date"), tr("نفّذها", "By"), ...(clinical ? [tr("الملاحظات / النتيجة", "Notes / result")] : []), ""]}>
            {p.sessions.map((s) => (
              <Tr key={s.id}>
                <Td className="tabular">{s.sessionNo}</Td><Td>{s.item.service.name}</Td>
                <Td className="whitespace-nowrap text-muted">{fmtDate(s.performedAt, locale)}</Td><Td className="text-muted">{s.performedBy ?? "—"}</Td>
                {clinical && <Td className="max-w-xs text-xs">{s.notes}{s.result && <p className="text-success">{s.result}</p>}</Td>}
                <Td className="text-end">{clinical && editable && <Button size="sm" variant="ghost" onClick={() => setEditSession(s)}>{tr("ملاحظات", "Notes")}</Button>}</Td>
              </Tr>
            ))}
          </Table>
          {p.sessions.length === 0 && <EmptyState title={tr("لم تُنفذ أي جلسة بعد", "No sessions yet")} />}
        </Card>
        <div className="space-y-4">
          {clinical && (
            <Card className="p-4">
              <p className="mb-2 font-medium">{tr("نتائج العلاج", "Treatment results")}</p>
              <textarea rows={4} disabled={!editable} value={results} onChange={(e) => setResults(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40" />
              {editable && <Button size="sm" className="mt-2" loading={act.pending} onClick={async () => { if (await act.run(() => api(`/api/programs/${id}`, { method: "PATCH", body: { results } }), tr("تم الحفظ", "Saved"))) reload(); }}>{tr("حفظ", "Save")}</Button>}
            </Card>
          )}
          <Card className="p-4">
            <p className="mb-2 font-medium">{tr("المراجعات المرتبطة", "Linked reviews")}</p>
            {p.reviews.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <ul className="space-y-2 text-sm">{p.reviews.map((r) => <li key={r.id} className="flex justify-between gap-2"><span>{fmtDate(r.scheduledAt, locale)} · {r.reason}</span><Badge tone={tone(REVIEW_STATUS, r.status)}>{lbl(REVIEW_STATUS, r.status, locale)}</Badge></li>)}</ul>
            )}
            {p.notes && <p className="mt-3 rounded-lg bg-surface-2 p-2 text-xs">{p.notes}</p>}
          </Card>
        </div>
      </div>

      <AppointmentForm open={!!book} preset={book} onClose={() => setBook(null)} onSaved={() => { setBook(null); reload(); }} />
      <RecordModal item={record} programId={id} onClose={() => setRecord(null)} onSaved={() => { setRecord(null); reload(); }} />
      <SessionNotes s={editSession} onClose={() => setEditSession(null)} onSaved={() => { setEditSession(null); reload(); }} />
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={tr("إلغاء البرنامج", "Cancel program")}
        footer={<><Button variant="secondary" onClick={() => setCancelOpen(false)}>{tr("رجوع", "Back")}</Button><Button variant="danger" disabled={!reason.trim()} loading={act.pending} onClick={() => action("CANCEL", { reason })}>{tr("تأكيد الإلغاء", "Confirm")}</Button></>}>
        <p className="mb-3 text-sm text-muted">{tr("ستُلغى المواعيد القادمة المرتبطة بالبرنامج.", "Upcoming appointments linked to this program will be cancelled.")}</p>
        <Input autoFocus placeholder={tr("سبب الإلغاء", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}

function RecordModal({ item, programId, onClose, onSaved }: { item: Item | null; programId: string; onClose: () => void; onSaved: () => void }) {
  const { tr, can } = useSession();
  const [f, setF] = useState({ date: "", notes: "", result: "" });
  const { pending, run } = useSubmit();
  useEffect(() => { if (item) setF({ date: toDateInput(new Date()), notes: "", result: "" }); }, [item]);
  return (
    <Modal open={!!item} onClose={onClose} title={`${tr("تسجيل جلسة", "Record session")} — ${item?.service.name ?? ""}`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="rec" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="rec" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api(`/api/programs/${programId}/sessions`, { body: { itemId: item!.id, performedAt: new Date(`${f.date}T12:00:00`), notes: f.notes, result: f.result } }), tr("تم تسجيل الجلسة", "Session recorded"))) onSaved();
      }}>
        <p className="text-xs text-muted">{tr("للجلسات المنفذة بدون موعد في التقويم. الجلسات المحجوزة تُحتسب تلقائياً عند إنهاء الزيارة.", "For sessions done without a calendar booking. Booked sessions count automatically when the visit is completed.")}</p>
        <Field label={tr("تاريخ الجلسة", "Date")}><Input type="date" dir="ltr" required value={f.date} max={toDateInput(new Date())} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {can("medical.view_data") && <>
          <Field label={tr("ملاحظات الجلسة", "Session notes")}><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Field label={tr("النتيجة", "Result")}><Input value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })} /></Field>
        </>}
      </form>
    </Modal>
  );
}

function SessionNotes({ s, onClose, onSaved }: { s: Session | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const [f, setF] = useState({ notes: "", result: "" });
  const { pending, run } = useSubmit();
  useEffect(() => { if (s) setF({ notes: s.notes ?? "", result: s.result ?? "" }); }, [s]);
  return (
    <Modal open={!!s} onClose={onClose} title={`${tr("الجلسة", "Session")} #${s?.sessionNo ?? ""}`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button loading={pending} onClick={async () => { if (await run(() => api(`/api/program-sessions/${s!.id}`, { method: "PATCH", body: f }), tr("تم الحفظ", "Saved"))) onSaved(); }}>{tr("حفظ", "Save")}</Button></>}>
      <div className="space-y-3">
        <Field label={tr("ملاحظات الجلسة", "Session notes")}><textarea rows={3} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Field label={tr("نتيجة الجلسة", "Result")}><Select value={["تحسن ملحوظ", "استجابة جيدة", "لا تغيير", ""].includes(f.result) ? f.result : "__custom"} onChange={(e) => setF({ ...f, result: e.target.value === "__custom" ? f.result : e.target.value })}>
          <option value="">—</option><option>تحسن ملحوظ</option><option>استجابة جيدة</option><option>لا تغيير</option>{f.result && !["تحسن ملحوظ", "استجابة جيدة", "لا تغيير"].includes(f.result) && <option value="__custom">{f.result}</option>}
        </Select></Field>
      </div>
    </Modal>
  );
}

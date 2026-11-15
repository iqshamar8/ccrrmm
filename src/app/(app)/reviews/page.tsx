"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Spinner, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import ReviewForm from "@/components/reviews/ReviewForm";
import { fmtTime, toDateInput } from "@/components/appointments/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { lbl, OUTCOME, REVIEW_REASON, REVIEW_STATUS, tone } from "@/lib/labels3";

type Review = {
  id: string; reasonType: string; reason: string; scheduledAt: string; durationMin: number; status: string; overdue: boolean; clinicalHidden: boolean;
  diagnosis: string | null; notes: string | null; procedures: string | null; outcome: string | null; previousReviewId: string | null;
  client: { id: string; fullName: string; code: string; phone: string }; doctor: { id: string; fullName: string } | null; branch: { name: string };
  surgery: { id: string; code: string; surgeryType: string } | null; program: { id: string; code: string; name: string } | null;
};

export default function ReviewsPage() {
  return <Suspense fallback={<div className="grid place-items-center py-24"><Spinner /></div>}><Reviews /></Suspense>;
}

function Reviews() {
  const { tr, locale, can } = useSession();
  const sp = useSearchParams();
  const [scope, setScope] = useState("upcoming");
  const [newOpen, setNewOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(sp.get("open"));
  const ok = can("reviews.view");
  const q = scope === "completed" ? "status=COMPLETED" : scope === "all" ? "" : `scope=${scope}`;
  const { data, loading, reload } = useResource<Review[]>(ok ? `/api/reviews?${q}` : null);
  const overdue = useResource<Review[]>(ok ? "/api/reviews?scope=overdue" : null);
  if (!ok) return <Forbidden />;

  return (
    <>
      <PageHeader title={tr("المراجعات الطبية", "Medical reviews")} subtitle={tr("مواعيد المتابعة بعد العمليات والعلاجات والسجل التاريخي لكل مريض", "Follow-ups after surgeries and treatments, with full history")}
        actions={can("reviews.create") && <Button onClick={() => setNewOpen(true)}>+ {tr("مراجعة جديدة", "New review")}</Button>} />
      <div className="mb-3 flex flex-wrap gap-1">
        {([["today", tr("اليوم", "Today")], ["upcoming", tr("القادمة", "Upcoming")], ["overdue", tr("متأخرة", "Overdue")], ["completed", tr("المكتملة", "Completed")], ["all", tr("الكل", "All")]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setScope(k)} className={`rounded-full px-3 py-1 text-sm ${scope === k ? "bg-brand text-white" : "bg-surface-2 text-muted"}`}>
            {l}{k === "overdue" && overdue.data?.length ? ` (${overdue.data.length})` : ""}
          </button>
        ))}
      </div>
      <Card>
        <Table head={[tr("الموعد", "When"), tr("المريض", "Patient"), tr("السبب", "Reason"), tr("الطبيب", "Doctor"), tr("مرتبطة بـ", "Linked to"), tr("النتيجة", "Outcome"), tr("الحالة", "Status")]}>
          {loading && !data ? <LoadingRows cols={7} /> : data?.map((r) => (
            <Tr key={r.id} onClick={() => setOpenId(r.id)}>
              <Td className="whitespace-nowrap">{fmtDate(r.scheduledAt, locale)} <span className="text-muted">{fmtTime(r.scheduledAt, locale)}</span></Td>
              <Td>{r.client.fullName}</Td>
              <Td><p>{r.reason}</p><p className="text-xs text-muted">{lbl(REVIEW_REASON, r.reasonType, locale)}</p></Td>
              <Td className="text-muted">{r.doctor?.fullName ?? "—"}</Td>
              <Td className="text-xs text-muted">{r.surgery ? `${tr("عملية", "Surgery")} ${r.surgery.code}` : r.program ? `${tr("برنامج", "Program")} ${r.program.code}` : "—"}</Td>
              <Td>{r.outcome ? <Badge tone={tone(OUTCOME, r.outcome)}>{lbl(OUTCOME, r.outcome, locale)}</Badge> : "—"}</Td>
              <Td>{r.overdue ? <Badge tone="red">{tr("متأخرة", "Overdue")}</Badge> : <Badge tone={tone(REVIEW_STATUS, r.status)}>{lbl(REVIEW_STATUS, r.status, locale)}</Badge>}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && data?.length === 0 && <EmptyState title={tr("لا توجد مراجعات", "No reviews")} />}
      </Card>
      <ReviewForm open={newOpen} onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); reload(); overdue.reload(); }} />
      <ReviewDetail id={openId} onClose={() => setOpenId(null)} onChanged={() => { reload(); overdue.reload(); }} onOpen={setOpenId} />
    </>
  );
}

function ReviewDetail({ id, onClose, onChanged, onOpen }: { id: string | null; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const { tr, locale, can } = useSession();
  const { data: r, reload } = useResource<Review & { history: Review[] }>(id ? `/api/reviews/${id}` : null);
  const [mode, setMode] = useState<null | "complete" | "cancel" | "reschedule">(null);
  const [f, setF] = useState({ diagnosis: "", notes: "", procedures: "", outcome: "", next: "", reason: "", date: "", time: "" });
  const act = useSubmit();
  useEffect(() => { setMode(null); }, [id]);
  useEffect(() => { if (r) { const d = new Date(r.scheduledAt); setF({ diagnosis: "", notes: "", procedures: "", outcome: "", next: "", reason: "", date: toDateInput(d), time: d.toTimeString().slice(0, 5) }); } }, [r]);
  const edit = can("reviews.update");
  const clinical = can("medical.view_data");
  const done = () => { setMode(null); reload(); onChanged(); };
  const area = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";

  return (
    <Modal open={!!id} onClose={onClose} wide title={r ? `${tr("مراجعة", "Review")} — ${r.client.fullName}` : tr("المراجعة", "Review")}
      footer={r && edit && r.status === "SCHEDULED" && !mode ? (
        <div className="flex w-full flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setMode("reschedule")}>{tr("إعادة جدولة", "Reschedule")}</Button>
            <Button variant="ghost" className="text-danger" onClick={() => setMode("cancel")}>{tr("إلغاء", "Cancel")}</Button>
          </div>
          <div className="flex gap-2">
            {+new Date(r.scheduledAt) < Date.now() && <Button variant="secondary" loading={act.pending} onClick={async () => { if (await act.run(() => api(`/api/reviews/${id}/status`, { body: { action: "MISSED" } }), tr("تم التسجيل", "Recorded"))) done(); }}>{tr("لم يحضر", "Missed")}</Button>}
            <Button onClick={() => setMode("complete")}>{tr("تسجيل نتيجة المراجعة", "Record outcome")}</Button>
          </div>
        </div>
      ) : undefined}>
      {!r ? <div className="grid place-items-center py-10"><Spinner /></div> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={r.overdue ? "red" : tone(REVIEW_STATUS, r.status)}>{r.overdue ? tr("متأخرة", "Overdue") : lbl(REVIEW_STATUS, r.status, locale)}</Badge>
            <span>{lbl(REVIEW_REASON, r.reasonType, locale)} · {r.reason}</span>
          </div>
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3 sm:grid-cols-4">
            <div><dt className="text-xs text-muted">{tr("الموعد", "When")}</dt><dd>{fmtDate(r.scheduledAt, locale)} {fmtTime(r.scheduledAt, locale)}</dd></div>
            <div><dt className="text-xs text-muted">{tr("الطبيب", "Doctor")}</dt><dd>{r.doctor?.fullName ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted">{tr("المريض", "Patient")}</dt><dd><Link className="text-brand" href={`/clients/${r.client.id}`}>{r.client.fullName}</Link></dd></div>
            <div><dt className="text-xs text-muted">{tr("مرتبطة بـ", "Linked to")}</dt><dd>{r.surgery ? <Link className="text-brand" href={`/surgeries/${r.surgery.id}`}>{r.surgery.surgeryType}</Link> : r.program ? <Link className="text-brand" href={`/programs/${r.program.id}`}>{r.program.name}</Link> : "—"}</dd></div>
          </dl>
          {r.status === "COMPLETED" && (r.clinicalHidden ? <p className="text-muted">🔒 {tr("النتائج الطبية تتطلب صلاحية مشاهدة البيانات الطبية.", "Findings require medical-data access.")}</p> : (
            <div className="grid gap-2 sm:grid-cols-3">
              {([["diagnosis", "التشخيص", "Diagnosis"], ["procedures", "الإجراءات", "Procedures"], ["notes", "الملاحظات", "Notes"]] as const).map(([k, ar, en]) => (
                <div key={k} className="rounded-lg border border-line p-2"><p className="text-xs text-muted">{tr(ar, en)}</p><p className="whitespace-pre-wrap">{r[k] ?? "—"}</p></div>
              ))}
            </div>
          ))}

          {mode === "complete" && (
            <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
              {clinical && <>
                <Field label={tr("التشخيص", "Diagnosis")}><textarea rows={2} className={area} value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
                <Field label={tr("الإجراءات", "Procedures")}><textarea rows={2} className={area} value={f.procedures} onChange={(e) => setF({ ...f, procedures: e.target.value })} /></Field>
                <Field label={tr("الملاحظات", "Notes")} className="sm:col-span-2"><textarea rows={2} className={area} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
              </>}
              <Field label={tr("نتيجة المتابعة", "Outcome")}><Select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}><option value="">—</option>{Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select></Field>
              <Field label={tr("موعد المراجعة القادمة (اختياري)", "Next review (optional)")}><Input type="datetime-local" dir="ltr" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button variant="secondary" onClick={() => setMode(null)}>{tr("رجوع", "Back")}</Button>
                <Button loading={act.pending} onClick={async () => {
                  const res = await act.run(() => api<{ nextReview: { id: string } | null }>(`/api/reviews/${id}/complete`, { body: { diagnosis: f.diagnosis, notes: f.notes, procedures: f.procedures, outcome: f.outcome || null, nextReviewAt: f.next ? new Date(f.next) : null } }), tr("تم حفظ نتيجة المراجعة", "Review completed"));
                  if (res) { done(); if (res.nextReview) onOpen(res.nextReview.id); }
                }}>{tr("حفظ", "Save")}</Button>
              </div>
            </div>
          )}
          {mode === "cancel" && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <Input autoFocus placeholder={tr("سبب الإلغاء", "Reason")} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setMode(null)}>{tr("رجوع", "Back")}</Button><Button variant="danger" disabled={!f.reason.trim()} loading={act.pending} onClick={async () => { if (await act.run(() => api(`/api/reviews/${id}/status`, { body: { action: "CANCEL", reason: f.reason } }), tr("تم الإلغاء", "Cancelled"))) done(); }}>{tr("تأكيد", "Confirm")}</Button></div>
            </div>
          )}
          {mode === "reschedule" && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
              <Field label={tr("التاريخ", "Date")}><Input type="date" dir="ltr" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              <Field label={tr("الوقت", "Time")}><Input type="time" dir="ltr" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
              <Button variant="secondary" onClick={() => setMode(null)}>{tr("رجوع", "Back")}</Button>
              <Button loading={act.pending} onClick={async () => { if (await act.run(() => api(`/api/reviews/${id}`, { method: "PATCH", body: { scheduledAt: new Date(`${f.date}T${f.time}:00`) } }), tr("تمت إعادة الجدولة", "Rescheduled"))) done(); }}>{tr("حفظ", "Save")}</Button>
            </div>
          )}

          <div>
            <p className="mb-2 font-medium">{tr("السجل التاريخي لمراجعات المريض", "Patient's review history")}</p>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {r.history.map((h) => (
                <li key={h.id}>
                  <button onClick={() => onOpen(h.id)} className={`flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-start hover:bg-surface-2 ${h.id === r.id ? "bg-brand/5" : ""}`}>
                    <span>{fmtDate(h.scheduledAt, locale)} · {h.reason} <span className="text-xs text-muted">{h.doctor?.fullName}</span></span>
                    <span className="flex gap-1">{h.outcome && <Badge tone={tone(OUTCOME, h.outcome)}>{lbl(OUTCOME, h.outcome, locale)}</Badge>}<Badge tone={h.overdue ? "red" : tone(REVIEW_STATUS, h.status)}>{h.overdue ? tr("متأخرة", "Overdue") : lbl(REVIEW_STATUS, h.status, locale)}</Badge></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

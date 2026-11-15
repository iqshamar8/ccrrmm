"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, Select, Spinner, StatCard, Table, Td, Tr } from "@/components/ui";
import ReviewForm from "@/components/reviews/ReviewForm";
import BillButton from "@/components/billing/BillButton";
import { fmtTime } from "@/components/appointments/shared";
import { api, upload } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { fileCatLabel } from "@/lib/labels2";
import { lbl, OUTCOME, RECOVERY, REVIEW_STATUS, SURGERY_STATUS, TEAM_ROLE, tone } from "@/lib/labels3";
import SurgeryForm from "@/components/surgeries/SurgeryForm";
import { useItems } from "@/components/inventory/shared";

type Surgery = {
  id: string; code: string; surgeryType: string; scheduledAt: string; durationMin: number; status: string; price: string; anesthesiaType: string | null;
  preOpNotes: string | null; postOpNotes: string | null; operativeReport: string | null; complications: string | null; recoveryStatus: string;
  cancelReason: string | null; clinicalHidden: boolean; suppliesCost: number; surgeonId: string | null; roomId: string | null; branchId: string;
  client: { id: string; fullName: string; code: string; phone: string }; surgeon: { id: string; fullName: string } | null; room: { name: string } | null; branch: { name: string };
  team: { userId: string; role: string; user: { fullName: string } }[];
  supplies: { id: string; name: string; quantity: string; unitCost: string; notes: string | null; itemId: string | null; consumed: boolean }[];
  reviews: { id: string; scheduledAt: string; status: string; reason: string; outcome: string | null; doctor: { fullName: string } | null }[];
  files: { id: string; category: string; originalName: string; mimeType: string; note: string | null; createdAt: string }[];
};

const area = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-70";

export default function SurgeryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tr, locale, can } = useSession();
  const { data: s, loading, reload } = useResource<Surgery>(`/api/surgeries/${id}`);
  const [edit, setEdit] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "POSTPONE" | "CANCEL" | "COMPLETE">(null);
  const [reason, setReason] = useState("");
  const [follow, setFollow] = useState<number[]>([7, 30]);
  const [clin, setClin] = useState({ preOpNotes: "", postOpNotes: "", operativeReport: "", complications: "", recoveryStatus: "NOT_STARTED" });
  const [sup, setSup] = useState({ name: "", quantity: "1", unitCost: "0", itemId: "" });
  const stockItems = useItems();
  const act = useSubmit();
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (s) setClin({ preOpNotes: s.preOpNotes ?? "", postOpNotes: s.postOpNotes ?? "", operativeReport: s.operativeReport ?? "", complications: s.complications ?? "", recoveryStatus: s.recoveryStatus }); }, [s]);
  if (loading && !s) return <div className="grid place-items-center py-24"><Spinner /></div>;
  if (!s) return <Card><EmptyState title={tr("العملية غير موجودة", "Surgery not found")} /></Card>;
  const editable = can("surgeries.update");
  const status = async (action: string, extra: Record<string, unknown> = {}) => {
    if (await act.run(() => api(`/api/surgeries/${id}/status`, { body: { action, ...extra } }), tr("تم تحديث الحالة", "Status updated"))) { setDialog(null); setReason(""); reload(); }
  };

  return (
    <>
      <Link href="/surgeries" className="mb-3 inline-block text-sm text-muted hover:text-ink">← {tr("العمليات الجراحية", "Surgeries")}</Link>
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{s.surgeryType}</h1>
              <Badge tone={tone(SURGERY_STATUS, s.status)}>{lbl(SURGERY_STATUS, s.status, locale)}</Badge>
              {s.status === "COMPLETED" && <Badge tone={tone(RECOVERY, s.recoveryStatus)}>{tr("التعافي:", "Recovery:")} {lbl(RECOVERY, s.recoveryStatus, locale)}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted"><span dir="ltr">{s.code}</span> · <Link className="text-brand" href={`/clients/${s.client.id}`}>{s.client.fullName}</Link> · {s.branch.name}</p>
            {s.cancelReason && <p className="mt-1 text-sm text-muted">{tr("السبب:", "Reason:")} {s.cancelReason}</p>}
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              {["PLANNED", "CONFIRMED", "POSTPONED"].includes(s.status) && <Button variant="secondary" onClick={() => setEdit(true)}>{tr("تعديل / إعادة جدولة", "Edit / reschedule")}</Button>}
              {s.status === "PLANNED" && <Button loading={act.pending} onClick={() => status("CONFIRM")}>{tr("تأكيد", "Confirm")}</Button>}
              {["PLANNED", "CONFIRMED"].includes(s.status) && <Button loading={act.pending} onClick={() => status("START")}>{tr("بدء العملية", "Start")}</Button>}
              {s.status === "IN_PROGRESS" && <Button onClick={() => setDialog("COMPLETE")}>{tr("إنهاء العملية", "Complete")}</Button>}
              {["PLANNED", "CONFIRMED"].includes(s.status) && <Button variant="secondary" onClick={() => setDialog("POSTPONE")}>{tr("تأجيل", "Postpone")}</Button>}
              {["PLANNED", "CONFIRMED", "POSTPONED"].includes(s.status) && <Button variant="ghost" className="text-danger" onClick={() => setDialog("CANCEL")}>{tr("إلغاء", "Cancel")}</Button>}
            </div>
          )}
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={tr("الموعد", "When")} value={<span className="text-base">{fmtDate(s.scheduledAt, locale)} · {fmtTime(s.scheduledAt, locale)}</span>} hint={`${s.durationMin} ${tr("دقيقة", "min")}`} />
        <StatCard label={tr("الجراح / الغرفة", "Surgeon / room")} value={<span className="text-base">{s.surgeon?.fullName ?? "—"}</span>} hint={s.room?.name} />
        <StatCard label={tr("التكلفة", "Cost")} value={<span className="text-xl tabular">{Number(s.price).toLocaleString()}</span>} hint={s.status !== "CANCELLED" ? <span className="mt-1 inline-block"><BillButton source="surgery" id={s.id} size="sm" /></span> : undefined} />
        <StatCard label={tr("تكلفة المستلزمات", "Supplies cost")} value={<span className="text-xl tabular">{s.suppliesCost.toLocaleString()}</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between"><p className="font-medium">{tr("التوثيق الطبي", "Clinical documentation")}</p>{s.anesthesiaType && <span className="text-xs text-muted">{tr("التخدير:", "Anesthesia:")} {s.anesthesiaType}</span>}</div>
            {s.clinicalHidden ? <p className="text-sm text-muted">🔒 {tr("تتطلب صلاحية مشاهدة البيانات الطبية.", "Requires the 'view medical data' permission.")}</p> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {([["preOpNotes", "ملاحظات ما قبل العملية", "Pre-op notes"], ["postOpNotes", "ملاحظات ما بعد العملية", "Post-op notes"], ["operativeReport", "التقرير الجراحي", "Operative report"], ["complications", "المضاعفات", "Complications"]] as const).map(([k, ar, en]) => (
                  <Field key={k} label={tr(ar, en)} className={k === "operativeReport" ? "sm:col-span-2" : ""}>
                    <textarea rows={k === "operativeReport" ? 5 : 3} disabled={!editable} className={area} value={clin[k]} onChange={(e) => setClin({ ...clin, [k]: e.target.value })} />
                  </Field>
                ))}
                <Field label={tr("حالة التعافي", "Recovery status")}>
                  <Select disabled={!editable} value={clin.recoveryStatus} onChange={(e) => setClin({ ...clin, recoveryStatus: e.target.value })}>{Object.entries(RECOVERY).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select>
                </Field>
                {editable && <div className="flex items-end"><Button loading={act.pending} onClick={async () => { if (await act.run(() => api(`/api/surgeries/${id}/clinical`, { method: "PATCH", body: clin }), tr("تم حفظ التوثيق", "Documentation saved"))) reload(); }}>{tr("حفظ التوثيق", "Save documentation")}</Button></div>}
              </div>
            )}
          </Card>

          <Card>
            <div className="border-b border-line px-4 py-3 font-medium">{tr("المستلزمات المستخدمة", "Supplies used")}</div>
            <Table head={[tr("المادة", "Item"), tr("الكمية", "Qty"), tr("سعر الوحدة", "Unit cost"), tr("الإجمالي", "Total"), ""]}>
              {s.supplies.map((x) => (
                <Tr key={x.id}><Td>{x.name}{x.itemId && <span className="ms-1"><Badge tone={x.consumed ? "green" : "blue"}>{x.consumed ? tr("خُصم من المخزن", "Deducted") : tr("مرتبط بالمخزن", "From stock")}</Badge></span>}</Td><Td className="tabular">{Number(x.quantity)}</Td><Td className="tabular">{Number(x.unitCost).toLocaleString()}</Td>
                  <Td className="tabular">{(Number(x.quantity) * Number(x.unitCost)).toLocaleString()}</Td>
                  <Td className="text-end">{editable && <button className="text-xs text-muted hover:text-danger" onClick={async () => { if (await act.run(() => api(`/api/surgery-supplies/${x.id}`, { method: "DELETE" }))) reload(); }}>{tr("حذف", "Delete")}</button>}</Td></Tr>
              ))}
            </Table>
            {editable && s.status !== "CANCELLED" && (
              <form className="flex flex-wrap gap-2 border-t border-line p-3" onSubmit={async (e) => { e.preventDefault(); if (await act.run(() => api(`/api/surgeries/${id}/supplies`, { body: { ...sup, itemId: sup.itemId || null } }), tr("تمت الإضافة", "Added"))) { setSup({ name: "", quantity: "1", unitCost: "0", itemId: "" }); reload(); } }}>
                {stockItems.length > 0 && <Select className="w-48" value={sup.itemId} onChange={(e) => { const it = stockItems.find((x) => x.id === e.target.value); setSup({ ...sup, itemId: e.target.value, ...(it ? { name: it.name, unitCost: String(Number(it.cost)) } : {}) }); }} aria-label="stock item"><option value="">{tr("— من المخزن (اختياري) —", "— from stock (optional) —")}</option>{stockItems.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}
                <Input className="min-w-0 flex-1" required placeholder={tr("اسم المادة", "Item name")} value={sup.name} onChange={(e) => setSup({ ...sup, name: e.target.value })} />
                <Input className="w-24" type="number" min={0.001} step="any" dir="ltr" value={sup.quantity} onChange={(e) => setSup({ ...sup, quantity: e.target.value })} aria-label="qty" />
                <Input className="w-28" type="number" min={0} step="any" dir="ltr" value={sup.unitCost} onChange={(e) => setSup({ ...sup, unitCost: e.target.value })} aria-label="cost" />
                <Button type="submit" variant="secondary">{tr("إضافة", "Add")}</Button>
              </form>
            )}
            <p className="px-4 pb-3 text-xs text-muted">{tr("المواد المرتبطة بالمخزن تُخصم تلقائياً من مخزن الفرع عند إكمال العملية.", "Items linked to stock are deducted from the branch store when the surgery is completed.")}</p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="mb-3 font-medium">{tr("الفريق الطبي", "Medical team")}</p>
            <ul className="space-y-2 text-sm">
              {s.surgeon && <li className="flex justify-between"><span>{s.surgeon.fullName}</span><Badge tone="brand">{tr("الجراح", "Surgeon")}</Badge></li>}
              {s.team.map((t) => <li key={t.userId} className="flex justify-between"><span>{t.user.fullName}</span><Badge>{lbl(TEAM_ROLE, t.role, locale)}</Badge></li>)}
            </ul>
          </Card>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-medium">{tr("مراجعات المتابعة", "Follow-up reviews")}</p>
              {can("reviews.create") && s.status !== "CANCELLED" && <Button size="sm" variant="secondary" onClick={() => setReviewOpen(true)}>+ {tr("جدولة", "Schedule")}</Button>}
            </div>
            {s.reviews.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <ul className="space-y-2 text-sm">
                {s.reviews.map((r) => (
                  <li key={r.id}><Link href={`/reviews?open=${r.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
                    <span>{fmtDate(r.scheduledAt, locale)} <span className="text-xs text-muted">{r.doctor?.fullName}</span></span>
                    <span className="flex gap-1">{r.outcome && <Badge tone={tone(OUTCOME, r.outcome)}>{lbl(OUTCOME, r.outcome, locale)}</Badge>}<Badge tone={tone(REVIEW_STATUS, r.status)}>{lbl(REVIEW_STATUS, r.status, locale)}</Badge></span>
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
          {!s.clinicalHidden && can("medical.view") && (
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-medium">{tr("المرفقات والصور الطبية", "Medical attachments")}</p>
                {can("medical.create") && <>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    const fd = new FormData(); fd.append("file", file); fd.append("category", file.type === "application/pdf" ? "MEDICAL_DOCUMENT" : s.status === "COMPLETED" ? "MEDICAL_AFTER" : "MEDICAL_BEFORE"); fd.append("surgeryId", id);
                    if (await act.run(() => upload(`/api/clients/${s.client.id}/files`, fd), tr("تم الرفع", "Uploaded"))) reload();
                    if (fileRef.current) fileRef.current.value = "";
                  }} />
                  <Button size="sm" variant="secondary" loading={act.pending} onClick={() => fileRef.current?.click()}>{tr("رفع", "Upload")}</Button>
                </>}
              </div>
              {s.files.length === 0 ? <p className="text-sm text-muted">—</p> : (
                <div className="grid grid-cols-3 gap-2">
                  {s.files.map((f) => (
                    <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line" title={`${fileCatLabel(f.category, locale)} · ${f.originalName}`}>
                      {f.mimeType.startsWith("image/")
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`/api/files/${f.id}`} alt={f.originalName} className="aspect-square w-full object-cover" />
                        : <span className="grid aspect-square place-items-center text-xs text-muted">PDF</span>}
                    </a>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      <SurgeryForm open={edit} surgery={edit ? s : null} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />
      <ReviewForm open={reviewOpen} preset={{ client: { id: s.client.id, fullName: s.client.fullName }, doctorId: s.surgeonId ?? undefined, surgeryId: s.id, reasonType: "POST_OP", reason: `مراجعة بعد ${s.surgeryType}` }}
        onClose={() => setReviewOpen(false)} onSaved={() => { setReviewOpen(false); reload(); }} />
      <Modal open={!!dialog} onClose={() => setDialog(null)} title={dialog === "COMPLETE" ? tr("إنهاء العملية", "Complete surgery") : dialog === "POSTPONE" ? tr("تأجيل العملية", "Postpone surgery") : tr("إلغاء العملية", "Cancel surgery")}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>{tr("رجوع", "Back")}</Button>
          <Button variant={dialog === "COMPLETE" ? "primary" : "danger"} disabled={dialog !== "COMPLETE" && !reason.trim()} loading={act.pending}
            onClick={() => (dialog === "COMPLETE" ? status("COMPLETE", { followUpDays: follow }) : status(dialog!, { reason }))}>{tr("تأكيد", "Confirm")}</Button></>}>
        {dialog === "COMPLETE" ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">{tr("جدولة مراجعات ما بعد العملية تلقائياً مع الجراح (في أقرب وقت متاح):", "Auto-schedule post-op reviews with the surgeon (next free slot):")}</p>
            <div className="flex flex-wrap gap-3">{[1, 3, 7, 14, 30, 90].map((d) => <Checkbox key={d} label={`${d} ${tr("يوم", "days")}`} checked={follow.includes(d)} onChange={() => setFollow(follow.includes(d) ? follow.filter((x) => x !== d) : [...follow, d].sort((a, b) => a - b))} />)}</div>
          </div>
        ) : (
          <div className="space-y-2">
            {dialog === "POSTPONE" && <p className="text-sm text-muted">{tr("يُحرر وقت الجراح والغرفة. عند تحديد موعد جديد تعود العملية «مخطط لها».", "Frees the surgeon and room. Setting a new date makes it planned again.")}</p>}
            <Input autoFocus placeholder={tr("السبب", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
      </Modal>
    </>
  );
}

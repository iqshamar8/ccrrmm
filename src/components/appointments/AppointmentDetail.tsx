"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Input, Modal } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { APPT_STATUS } from "@/lib/labels2";
import { type Appt, fmtTime } from "./shared";
import BillButton from "@/components/billing/BillButton";

const NEXT: Record<string, string[]> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "NO_SHOW"],
  CHECKED_IN: ["COMPLETED"],
  CANCELLED: ["SCHEDULED"],
  NO_SHOW: ["SCHEDULED"],
  COMPLETED: [],
};
const ACTION_LABEL: Record<string, [string, string]> = {
  CONFIRMED: ["تأكيد الموعد", "Confirm"], CHECKED_IN: ["تسجيل الحضور", "Check in"], COMPLETED: ["إنهاء الزيارة", "Complete visit"],
  NO_SHOW: ["لم يحضر", "No-show"], SCHEDULED: ["إعادة تفعيل", "Restore"],
};

export default function AppointmentDetail({ appt, onClose, onChanged, onEdit }: { appt: Appt | null; onClose: () => void; onChanged: () => void; onEdit: (a: Appt) => void }) {
  const { tr, locale, can } = useSession();
  const { pending, run } = useSubmit();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { setCancelling(false); setReason(""); }, [appt]);
  if (!appt) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const st = APPT_STATUS[appt.status];
  // Surgery / review slots are managed from their own pages.
  const managed = !!(appt.surgery || appt.review);
  const canUpdate = can("appointments.update") && !managed;

  const setStatus = async (status: string, why?: string) => {
    const ok = await run(() => api(`/api/appointments/${appt.id}/status`, { body: { status, reason: why } }), tr("تم تحديث حالة الموعد", "Status updated"));
    if (ok) onChanged();
  };

  return (
    <Modal open={!!appt} onClose={onClose} title={tr("تفاصيل الموعد", "Appointment")}
      footer={canUpdate && !cancelling ? (
        <div className="flex w-full flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {!["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appt.status) && <Button variant="secondary" onClick={() => onEdit(appt)}>{tr("تعديل / إعادة جدولة", "Edit / reschedule")}</Button>}
            {!["COMPLETED", "CANCELLED"].includes(appt.status) && <Button variant="ghost" className="text-danger" onClick={() => setCancelling(true)}>{tr("إلغاء الموعد", "Cancel")}</Button>}
          </div>
          <div className="flex gap-2">
            {NEXT[appt.status].map((s) => (
              <Button key={s} variant={s === "NO_SHOW" ? "secondary" : "primary"} loading={pending} onClick={() => setStatus(s)}>{tr(...ACTION_LABEL[s])}</Button>
            ))}
          </div>
        </div>
      ) : undefined}>
      <div className="space-y-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link href={`/clients/${appt.client.id}`} className="text-base font-semibold hover:text-brand">{appt.client.fullName}</Link>
            <p className="text-xs text-muted" dir="ltr">{appt.client.phone} · {appt.client.code}</p>
          </div>
          <Badge tone={st.tone}>{tr(st.ar, st.en)}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3">
          <div><dt className="text-xs text-muted">{tr("الموعد", "When")}</dt><dd>{fmtDate(appt.startsAt, locale)} · {fmtTime(appt.startsAt, locale)}–{fmtTime(appt.endsAt, locale)}</dd></div>
          <div><dt className="text-xs text-muted">{tr("الخدمة", "Service")}</dt><dd>{appt.service?.name ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">{tr("الطبيب / الموظف", "Staff")}</dt><dd>{appt.staff?.fullName ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">{tr("الغرفة", "Room")}</dt><dd>{appt.room?.name ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">{tr("الفرع", "Branch")}</dt><dd>{appt.branch.name}</dd></div>
          <div><dt className="text-xs text-muted">{tr("السعر", "Price")}</dt><dd className="tabular">{appt.price ? Number(appt.price).toLocaleString() : "—"}</dd></div>
        </dl>
        {["COMPLETED", "CHECKED_IN"].includes(appt.status) && !appt.programItem && !appt.subscription && !managed && (
          <div className="flex items-center justify-between rounded-lg border border-line p-2 text-xs">
            <span className="text-muted">{tr("زيارة مدفوعة بشكل مباشر", "Pay-per-visit")}</span><BillButton source="appointment" id={appt.id} size="sm" />
          </div>
        )}
        {appt.recurrenceGroupId && <p className="text-xs text-muted">{tr("جزء من سلسلة مواعيد متكررة", "Part of a recurring series")}</p>}
        {appt.programItem && <p className="text-xs">{tr("جلسة من البرنامج:", "Program session:")} <Link className="text-brand" href={`/programs/${appt.programItem.program.id}`}>{appt.programItem.program.name}</Link></p>}
        {appt.subscription && <p className="text-xs">{tr("محتسبة على الاشتراك:", "Charged to subscription:")} <Link className="text-brand" href={`/subscriptions?open=${appt.subscription.id}`}>{appt.subscription.name} ({appt.subscription.code})</Link></p>}
        {appt.surgery && <p className="rounded-lg bg-surface-2 p-2 text-xs">{tr("هذا الوقت محجوز لعملية جراحية — تُدار من صفحة العملية.", "This slot belongs to a surgery — manage it there.")} <Link className="text-brand" href={`/surgeries/${appt.surgery.id}`}>{appt.surgery.code}</Link></p>}
        {appt.review && <p className="rounded-lg bg-surface-2 p-2 text-xs">{tr("هذا الوقت محجوز لمراجعة طبية — تُدار من صفحة المراجعات.", "This slot belongs to a medical review.")} <Link className="text-brand" href={`/reviews?open=${appt.review.id}`}>{tr("فتح المراجعة", "Open review")}</Link></p>}
        {appt.notes && <p><span className="text-muted">{tr("ملاحظات:", "Notes:")}</span> {appt.notes}</p>}
        {appt.cancelReason && <p><span className="text-muted">{tr("سبب الإلغاء:", "Cancel reason:")}</span> {appt.cancelReason}</p>}
        {cancelling && (
          <div className="space-y-2 rounded-lg border border-line p-3">
            <p className="font-medium">{tr("سبب الإلغاء", "Cancellation reason")}</p>
            <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("مثال: طلب العميل التأجيل", "e.g. client asked to postpone")} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCancelling(false)}>{tr("رجوع", "Back")}</Button>
              <Button variant="danger" disabled={!reason.trim()} loading={pending} onClick={() => setStatus("CANCELLED", reason)}>{tr("تأكيد الإلغاء", "Confirm cancellation")}</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

"use client";
import { useResource, useSubmit } from "./hooks";
import { useSession } from "./providers";
import { fmtTime } from "./appointments/shared";
import { api } from "@/lib/client";

type Today = { record: { checkIn: string | null; checkOut: string | null; status: string; lateMinutes: number } | null; shift: { startTime: string; endTime: string } | null };

/** Self-service clock in / out for the signed-in staff member. */
export default function ClockButton() {
  const { tr, locale, tenant, features } = useSession();
  const enabled = !!tenant && tenant.access === "ok" && features.includes("hr");
  const { data, reload } = useResource<Today>(enabled ? "/api/hr/clock" : null);
  const { pending, run } = useSubmit();
  if (!enabled || !data) return null;
  const r = data.record;
  const go = async (action: "IN" | "OUT") => {
    if (await run(() => api("/api/hr/clock", { body: { action } }), action === "IN" ? tr("تم تسجيل الحضور", "Clocked in") : tr("تم تسجيل الانصراف", "Clocked out"))) reload();
  };
  if (r?.checkOut) {
    return <span className="hidden rounded-lg px-2 py-1 text-xs text-muted sm:inline" title={tr("انتهى دوام اليوم", "Done for today")}>✓ {fmtTime(r.checkIn!, locale)}–{fmtTime(r.checkOut, locale)}</span>;
  }
  const inNow = !!r?.checkIn;
  return (
    <button onClick={() => go(inNow ? "OUT" : "IN")} disabled={pending}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${inNow ? "border border-line hover:bg-surface-2" : "bg-brand text-white hover:brightness-110"}`}
      title={data.shift ? `${tr("دوام اليوم", "Today's shift")} ${data.shift.startTime}–${data.shift.endTime}` : tr("لا يوجد دوام مجدول اليوم", "No shift today")}>
      {inNow ? `${tr("انصراف", "Clock out")} · ${tr("منذ", "since")} ${fmtTime(r!.checkIn!, locale)}` : tr("تسجيل الحضور", "Clock in")}
    </button>
  );
}

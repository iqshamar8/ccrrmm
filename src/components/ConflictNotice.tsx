"use client";
import { useSession } from "./providers";
import { ApiError } from "@/lib/client";

export type SlotConflict = {
  who: string | null; whoKind: "staff" | "room"; clientName: string | null;
  startsAt: string | null; endsAt: string | null; suggestions: string[];
};

/** Pull a booking conflict out of an API error (null if it's another kind of error). */
export function asSlotConflict(err: unknown): SlotConflict | null {
  if (!(err instanceof ApiError) || err.code !== "SLOT_CONFLICT") return null;
  const d = (err.details ?? {}) as Record<string, unknown>;
  return {
    who: typeof d.who === "string" ? d.who : null,
    whoKind: d.whoKind === "room" ? "room" : "staff",
    clientName: typeof d.clientName === "string" ? d.clientName : null,
    startsAt: d.startsAt ? String(d.startsAt) : null,
    endsAt: d.endsAt ? String(d.endsAt) : null,
    suggestions: Array.isArray(d.suggestions) ? d.suggestions.map(String) : [],
  };
}

/** "This time is taken" with the nearest free times as one-tap buttons. */
export function ConflictNotice({ c, onPick }: { c: SlotConflict; onPick: (iso: string) => void }) {
  const { tr, locale } = useSession();
  const loc = locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB";
  const time = (iso: string) => new Intl.DateTimeFormat(loc, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
  const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
  const what = c.whoKind === "room" ? tr("الغرفة", "The room") : tr("الطبيب / الموظف", "The staff member");

  return (
    <div role="alert" className="conflict-notice rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm">
      <p className="font-medium text-danger">
        {tr("هذا الوقت محجوز", "This time is already booked")}
      </p>
      <p className="mt-1 text-ink/80">
        {what} {c.who ? <b>{c.who}</b> : null} {tr("مشغول", "is busy")}
        {c.clientName ? <> {tr("مع", "with")} <b>{c.clientName}</b></> : null}
        {c.startsAt && c.endsAt ? <> {tr("من", "from")} <span className="tabular" dir="ltr">{time(c.startsAt)}</span> {tr("إلى", "to")} <span className="tabular" dir="ltr">{time(c.endsAt)}</span></> : null}.
      </p>
      {c.suggestions.length > 0 ? (
        <>
          <p className="mt-3 text-xs font-medium text-muted">{tr("أقرب أوقات متاحة — اضغط للاختيار:", "Nearest free times — tap to choose:")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {c.suggestions.map((iso) => (
              <button key={iso} type="button" onClick={() => onPick(iso)}
                className="slot-chip inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium">
                <span className="tabular" dir="ltr">{time(iso)}</span>
                {c.startsAt && !sameDay(iso, c.startsAt) && <span className="text-xs opacity-75">· {day(iso)}</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">{tr("لا توجد أوقات فارغة قريبة لنفس الطبيب والغرفة، جرّب طبيباً أو غرفة أخرى.", "No free time nearby for the same staff member and room; try another one.")}</p>
      )}
    </div>
  );
}

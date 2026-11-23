"use client";
import { useEffect, useState } from "react";
import { useSession } from "./providers";

/** Live clock for the top bar: time (blinking colon) and, on wider screens, the date.
 *  Rendered only after mount so the server's clock never mismatches the visitor's. */
export default function LiveClock() {
  const { locale } = useSession();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    // tick on the second boundary, then every second
    let id: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => { setNow(new Date()); id = setInterval(() => setNow(new Date()), 1000); }, 1000 - (Date.now() % 1000));
    return () => { clearTimeout(t); if (id) clearInterval(id); };
  }, []);
  if (!now) return <span className="live-clock" aria-hidden="true" />;

  const loc = locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB";
  const parts = new Intl.DateTimeFormat(loc, { hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(now);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "";
  const ampm = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const date = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long" }).format(now);
  const full = new Intl.DateTimeFormat(loc, { dateStyle: "full", timeStyle: "short" }).format(now);

  return (
    <time className="live-clock" dateTime={now.toISOString()} title={full} aria-label={full}>
      <span className="live-clock__time tabular" dir="ltr">
        {hh}<span className="live-clock__colon">:</span>{mm}
      </span>
      {ampm && <span className="live-clock__ampm">{ampm}</span>}
      <span className="live-clock__date">{date}</span>
    </time>
  );
}

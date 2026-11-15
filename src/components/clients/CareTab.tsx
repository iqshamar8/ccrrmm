"use client";
import Link from "next/link";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Card } from "@/components/ui";
import Progress from "@/components/Progress";
import { fmtDate } from "@/lib/i18n";
import { lbl, OUTCOME, PROGRAM_STATUS, RECOVERY, REVIEW_STATUS, SUB_STATUS, SURGERY_STATUS, tone } from "@/lib/labels3";

type P = { id: string; code: string; name: string; status: string; progress: { used: number; total: number }; endDate: string | null };
type S = { id: string; code: string; name: string; status: string; used: number; visitsTotal: number | null; endDate: string; daysLeft: number };
type G = { id: string; code: string; surgeryType: string; scheduledAt: string; status: string; recoveryStatus: string };
type R = { id: string; scheduledAt: string; reason: string; status: string; outcome: string | null; overdue: boolean };

/** Client profile tab: programs, subscriptions, surgeries and reviews at a glance. */
export default function CareTab({ clientId }: { clientId: string }) {
  const { tr, locale, can } = useSession();
  const programs = useResource<P[]>(can("programs.view") ? `/api/programs?clientId=${clientId}` : null);
  const subs = useResource<S[]>(can("subscriptions.view") ? `/api/subscriptions?clientId=${clientId}` : null);
  const surgeries = useResource<G[]>(can("surgeries.view") ? `/api/surgeries?clientId=${clientId}` : null);
  const reviews = useResource<R[]>(can("reviews.view") ? `/api/reviews?clientId=${clientId}` : null);

  const Section = ({ title, href, children, empty }: { title: string; href: string; children: React.ReactNode; empty: boolean }) => (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3"><p className="font-medium">{title}</p><Link href={href} className="text-xs text-brand">{tr("الكل", "All")} ←</Link></div>
      {empty ? <p className="p-6 text-center text-sm text-muted">—</p> : <ul className="divide-y divide-line">{children}</ul>}
    </Card>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {programs.data && (
        <Section title={tr("البرامج العلاجية", "Treatment programs")} href="/programs" empty={!programs.data.length}>
          {programs.data.map((p) => (
            <li key={p.id}><Link href={`/programs/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
              <div className="min-w-0"><p className="truncate font-medium">{p.name}</p><p className="text-xs text-muted">{p.code} · {tr("حتى", "until")} {fmtDate(p.endDate, locale)}</p></div>
              <div className="flex items-center gap-3"><Progress used={p.progress.used} total={p.progress.total} /><Badge tone={tone(PROGRAM_STATUS, p.status)}>{lbl(PROGRAM_STATUS, p.status, locale)}</Badge></div>
            </Link></li>
          ))}
        </Section>
      )}
      {subs.data && (
        <Section title={tr("الاشتراكات", "Subscriptions")} href="/subscriptions" empty={!subs.data.length}>
          {subs.data.map((s) => (
            <li key={s.id}><Link href={`/subscriptions?open=${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
              <div className="min-w-0"><p className="truncate font-medium">{s.name}</p><p className="text-xs text-muted">{s.code} · {tr("ينتهي", "ends")} {fmtDate(s.endDate, locale)}{s.status === "ACTIVE" ? ` (${s.daysLeft} ${tr("يوم", "d")})` : ""}</p></div>
              <div className="flex items-center gap-3">{s.visitsTotal ? <Progress used={s.used} total={s.visitsTotal} /> : <span className="text-xs tabular">{s.used} {tr("زيارة", "visits")}</span>}<Badge tone={tone(SUB_STATUS, s.status)}>{lbl(SUB_STATUS, s.status, locale)}</Badge></div>
            </Link></li>
          ))}
        </Section>
      )}
      {surgeries.data && (
        <Section title={tr("العمليات الجراحية", "Surgeries")} href="/surgeries" empty={!surgeries.data.length}>
          {surgeries.data.map((g) => (
            <li key={g.id}><Link href={`/surgeries/${g.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
              <div><p className="font-medium">{g.surgeryType}</p><p className="text-xs text-muted">{g.code} · {fmtDate(g.scheduledAt, locale)}</p></div>
              <div className="flex gap-1">{g.status === "COMPLETED" && <Badge tone={tone(RECOVERY, g.recoveryStatus)}>{lbl(RECOVERY, g.recoveryStatus, locale)}</Badge>}<Badge tone={tone(SURGERY_STATUS, g.status)}>{lbl(SURGERY_STATUS, g.status, locale)}</Badge></div>
            </Link></li>
          ))}
        </Section>
      )}
      {reviews.data && (
        <Section title={tr("المراجعات الطبية", "Medical reviews")} href="/reviews" empty={!reviews.data.length}>
          {reviews.data.slice(0, 12).map((r) => (
            <li key={r.id}><Link href={`/reviews?open=${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
              <div className="min-w-0"><p className="truncate">{r.reason}</p><p className="text-xs text-muted">{fmtDate(r.scheduledAt, locale)}</p></div>
              <div className="flex gap-1">{r.outcome && <Badge tone={tone(OUTCOME, r.outcome)}>{lbl(OUTCOME, r.outcome, locale)}</Badge>}<Badge tone={r.overdue ? "red" : tone(REVIEW_STATUS, r.status)}>{r.overdue ? tr("متأخرة", "Overdue") : lbl(REVIEW_STATUS, r.status, locale)}</Badge></div>
            </Link></li>
          ))}
        </Section>
      )}
    </div>
  );
}

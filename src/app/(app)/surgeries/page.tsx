"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Input, LoadingRows, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import SurgeryForm from "@/components/surgeries/SurgeryForm";
import { fmtTime } from "@/components/appointments/shared";

import { fmtDate } from "@/lib/i18n";
import { lbl, RECOVERY, SURGERY_STATUS, tone } from "@/lib/labels3";

type Row = {
  id: string; code: string; surgeryType: string; scheduledAt: string; durationMin: number; status: string; recoveryStatus: string; price: string;
  client: { id: string; fullName: string }; surgeon: { fullName: string } | null; room: { name: string } | null; branch: { name: string }; _count?: { reviews: number };
};

export default function SurgeriesPage() {
  const { tr, locale, can } = useSession();
  const router = useRouter();
  const [scope, setScope] = useState<"upcoming" | "past" | "all">("upcoming");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ q, status });
    if (scope === "upcoming") p.set("from", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
    if (scope === "past") p.set("to", new Date().toISOString());
    return p.toString();
  }, [q, status, scope]);
  const ok = can("surgeries.view");
  const { data, loading } = useResource<Row[]>(ok ? `/api/surgeries?${qs}` : null);
  if (!ok) return <Forbidden />;
  const rows = scope === "upcoming" ? [...(data ?? [])].reverse() : data ?? [];

  return (
    <>
      <PageHeader title={tr("العمليات الجراحية", "Surgeries")} subtitle={tr("الجدولة والفريق الطبي وغرفة العمليات والتقارير والمتابعة", "Scheduling, team, operating room, reports and follow-up")}
        actions={can("surgeries.create") && <Button onClick={() => setOpen(true)}>+ {tr("عملية جديدة", "New surgery")}</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex rounded-lg border border-line p-0.5">
            {([["upcoming", tr("القادمة", "Upcoming")], ["past", tr("السابقة", "Past")], ["all", tr("الكل", "All")]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setScope(k)} className={`rounded-md px-3 py-1 text-xs ${scope === k ? "bg-brand text-white" : "text-muted"}`}>{l}</button>
            ))}
          </div>
          <Input className="max-w-xs" placeholder={tr("بحث بالمريض أو نوع العملية أو الرمز…", "Search patient, type, code…")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tr("كل الحالات", "All statuses")}</option>{Object.entries(SURGERY_STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
          </Select>
        </div>
        <Table head={[tr("العملية", "Surgery"), tr("المريض", "Patient"), tr("الموعد", "When"), tr("الجراح", "Surgeon"), tr("الغرفة", "Room"), tr("الحالة", "Status"), tr("التعافي", "Recovery")]}>
          {loading && !data ? <LoadingRows cols={7} /> : rows.map((s) => (
            <Tr key={s.id} onClick={() => router.push(`/surgeries/${s.id}`)}>
              <Td><p className="font-medium">{s.surgeryType}</p><p className="text-xs text-muted" dir="ltr">{s.code}</p></Td>
              <Td>{s.client.fullName}</Td>
              <Td className="whitespace-nowrap">{fmtDate(s.scheduledAt, locale)} <span className="text-muted">{fmtTime(s.scheduledAt, locale)} · {s.durationMin} {tr("د", "min")}</span></Td>
              <Td className="text-muted">{s.surgeon?.fullName ?? "—"}</Td>
              <Td className="text-muted">{s.room?.name ?? "—"}</Td>
              <Td><Badge tone={tone(SURGERY_STATUS, s.status)}>{lbl(SURGERY_STATUS, s.status, locale)}</Badge></Td>
              <Td>{s.status === "COMPLETED" ? <Badge tone={tone(RECOVERY, s.recoveryStatus)}>{lbl(RECOVERY, s.recoveryStatus, locale)}</Badge> : "—"}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && rows.length === 0 && <EmptyState title={tr("لا توجد عمليات", "No surgeries")} />}
      </Card>
      <SurgeryForm open={open} onClose={() => setOpen(false)} onSaved={(id) => { setOpen(false); router.push(`/surgeries/${id}`); }} />
    </>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Field, Input, Modal, Select } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import AppointmentForm, { type BookingPreset } from "@/components/appointments/AppointmentForm";
import AppointmentDetail from "@/components/appointments/AppointmentDetail";
import { type Appt, fmtTime, type Room, type Staff } from "@/components/appointments/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { APPT_STATUS } from "@/lib/labels2";

type View = "day" | "week" | "month";
type Resource = "staff" | "room";
const HOUR_PX = 64;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** Week starts on Saturday (regional convention). */
const startOfWeek = (d: Date) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 1) % 7)); };
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export default function AppointmentsPage() {
  const s = useSession();
  const { tr, locale, can } = s;
  const [view, setView] = useState<View>("day");
  const [resource, setResource] = useState<Resource>("staff");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [branchId, setBranchId] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [book, setBook] = useState<BookingPreset | null>(null);
  const [selected, setSelected] = useState<Appt | null>(null);
  const [editing, setEditing] = useState<Appt | null>(null);
  const [waitOpen, setWaitOpen] = useState(false);
  useEffect(() => { try { const v = localStorage.getItem("cal.view"); if (v === "day" || v === "week" || v === "month") setView(v); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem("cal.view", view); } catch {} }, [view]);

  const range = useMemo(() => {
    if (view === "day") return { from: cursor, to: addDays(cursor, 1) };
    if (view === "week") { const f = startOfWeek(cursor); return { from: f, to: addDays(f, 7) }; }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const f = startOfWeek(first);
    return { from: f, to: addDays(f, 42) };
  }, [view, cursor]);

  const allowed = can("appointments.view");
  const qs = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString(), ...(branchId ? { branchId } : {}), ...(staffFilter ? { staffId: staffFilter } : {}) });
  const appts = useResource<Appt[]>(allowed ? `/api/appointments?${qs}` : null);
  const staff = useResource<Staff[]>(allowed ? "/api/staff" : null);
  const rooms = useResource<Room[]>(allowed ? "/api/rooms" : null);
  const branches = useResource<{ id: string; name: string }[]>(allowed && can("branches.view") ? "/api/branches" : null);
  const waitlist = useResource<WaitRow[]>(allowed ? "/api/waitlist" : null);
  if (!allowed) return <Forbidden />;

  const list = (appts.data ?? []).filter((a) => showCancelled || !["CANCELLED"].includes(a.status));
  const move = (dir: number) => setCursor((c) => view === "day" ? addDays(c, dir) : view === "week" ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1));
  const title = view === "day"
    ? new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(cursor)
    : view === "week" ? `${fmtDate(range.from, locale)} – ${fmtDate(addDays(range.to, -1), locale)}`
    : new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", { month: "long", year: "numeric" }).format(cursor);
  const refresh = () => { appts.reload(); waitlist.reload(); };

  // Day-view columns
  const columns: { id: string | null; label: string; sub?: string }[] = view !== "day" ? [] : resource === "staff"
    ? (staff.data ?? [])
        .filter((p) => (!staffFilter || p.id === staffFilter) && (!branchId || p.allBranches || p.branchIds.includes(branchId)))
        .filter((p) => ["doctor", "nurse", "laser_technician"].includes(p.role?.key ?? "") || list.some((a) => a.staffId === p.id))
        .map((p) => ({ id: p.id, label: p.fullName, sub: p.jobTitle ?? undefined }))
    : (rooms.data ?? []).filter((r) => r.isActive && (!branchId || r.branchId === branchId)).map((r) => ({ id: r.id, label: r.name, sub: r.branch.name }));
  if (view === "day" && list.some((a) => (resource === "staff" ? !a.staffId : !a.roomId))) columns.push({ id: null, label: tr("غير محدد", "Unassigned") });

  const counts = list.reduce<Record<string, number>>((m, a) => ((m[a.status] = (m[a.status] ?? 0) + 1), m), {});

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="me-auto text-xl font-semibold">{tr("المواعيد", "Appointments")}</h1>
        {can("appointments.create") && <Button onClick={() => setBook({ start: view === "day" && !sameDay(cursor, new Date()) ? new Date(cursor.getTime() + 10 * 3600000) : undefined, branchId: branchId || undefined })}>+ {tr("حجز سريع", "Quick booking")}</Button>}
        <Button variant="secondary" onClick={() => setWaitOpen(true)}>{tr("قائمة الانتظار", "Waitlist")} {waitlist.data?.length ? <Badge tone="amber">{waitlist.data.length}</Badge> : null}</Button>
      </div>

      <Card className="mb-3 flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => move(-1)} aria-label={tr("السابق", "Previous")}><span className="rtl:rotate-180">‹</span></Button>
          <Button size="sm" variant="secondary" onClick={() => setCursor(startOfDay(new Date()))}>{tr("اليوم", "Today")}</Button>
          <Button size="sm" variant="secondary" onClick={() => move(1)} aria-label={tr("التالي", "Next")}><span className="rtl:rotate-180">›</span></Button>
        </div>
        <input type="date" className="h-8 rounded-lg border border-line bg-surface px-2 text-xs" dir="ltr"
          value={`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`}
          onChange={(e) => e.target.value && setCursor(startOfDay(new Date(`${e.target.value}T00:00:00`)))} />
        <p className="font-medium">{title}</p>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line p-0.5">
            {(["day", "week", "month"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-xs ${view === v ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>
                {v === "day" ? tr("يوم", "Day") : v === "week" ? tr("أسبوع", "Week") : tr("شهر", "Month")}
              </button>
            ))}
          </div>
          {view === "day" && (
            <div className="flex rounded-lg border border-line p-0.5">
              {(["staff", "room"] as Resource[]).map((r) => (
                <button key={r} onClick={() => setResource(r)} className={`rounded-md px-3 py-1 text-xs ${resource === r ? "bg-surface-2 font-medium" : "text-muted"}`}>
                  {r === "staff" ? tr("حسب الطبيب", "By staff") : tr("حسب الغرفة", "By room")}
                </button>
              ))}
            </div>
          )}
          {branches.data && branches.data.length > 1 && (
            <Select className="h-8 w-auto text-xs" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{tr("كل الفروع", "All branches")}</option>{branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Select className="h-8 w-auto text-xs" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
            <option value="">{tr("كل الأطباء والموظفين", "All staff")}</option>{staff.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </Select>
          <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />{tr("إظهار الملغاة", "Show cancelled")}</label>
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {Object.entries(APPT_STATUS).map(([k, v]) => counts[k] ? <span key={k} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: v.color }} />{tr(v.ar, v.en)} <b className="tabular">{counts[k]}</b></span> : null)}
        {appts.loading && <span className="text-muted">{tr("جارٍ التحميل…", "Loading…")}</span>}
      </div>

      {view === "month" ? (
        <MonthGrid from={range.from} month={cursor.getMonth()} appts={list} onPickDay={(d) => { setCursor(d); setView("day"); }} />
      ) : (
        <TimeGrid
          days={view === "day" ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i))}
          columns={view === "day" ? columns : null}
          resource={resource} appts={list}
          onSlot={can("appointments.create") ? (start, colId) => setBook({ start, branchId: branchId || undefined, ...(colId ? (resource === "staff" ? { staffId: colId } : { roomId: colId }) : {}) }) : undefined}
          onPick={setSelected}
        />
      )}
      {view === "day" && columns.length === 0 && !appts.loading && (
        <p className="mt-4 text-center text-sm text-muted">{resource === "room" ? tr("لا توجد غرف. أضفها من الإعدادات ← الغرف.", "No rooms. Add them in Settings → Rooms.") : tr("لا يوجد أطباء أو موظفون للحجز.", "No bookable staff.")}</p>
      )}

      <AppointmentForm open={!!book} preset={book} onClose={() => setBook(null)} onSaved={() => { setBook(null); refresh(); }} />
      <AppointmentForm open={!!editing} appt={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      <AppointmentDetail appt={selected} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); refresh(); }} onEdit={(a) => { setSelected(null); setEditing(a); }} />
      <WaitlistModal open={waitOpen} rows={waitlist.data ?? []} onClose={() => setWaitOpen(false)} reload={waitlist.reload}
        onBook={(w) => { setWaitOpen(false); setBook({ client: { id: w.client.id, fullName: w.client.fullName }, branchId: w.branchId, staffId: w.staffId ?? undefined, start: w.preferredDate ? new Date(`${w.preferredDate.slice(0, 10)}T10:00:00`) : undefined, waitlistId: w.id }); }} />
    </>
  );
}

// ------------------------------------------------------------ time grid ----

function TimeGrid({ days, columns, resource, appts, onSlot, onPick }: {
  days: Date[]; columns: { id: string | null; label: string; sub?: string }[] | null; resource: Resource; appts: Appt[];
  onSlot?: (start: Date, colId: string | null) => void; onPick: (a: Appt) => void;
}) {
  const { tr, locale } = useSession();
  const minH = Math.min(8, ...appts.map((a) => new Date(a.startsAt).getHours()));
  const maxH = Math.max(21, ...appts.map((a) => { const e = new Date(a.endsAt); return e.getHours() + (e.getMinutes() ? 1 : 0); }));
  const hours = Array.from({ length: maxH - minH }, (_, i) => minH + i);
  const cols = columns
    ? columns.map((c) => ({ key: String(c.id), day: days[0], label: c.label, sub: c.sub, items: appts.filter((a) => (resource === "staff" ? a.staffId : a.roomId) === c.id), colId: c.id }))
    : days.map((d) => ({
        key: d.toISOString(), day: d, colId: null as string | null,
        label: new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric" }).format(d),
        sub: undefined as string | undefined, items: appts.filter((a) => sameDay(new Date(a.startsAt), d)),
      }));
  const now = new Date();
  const nowTop = ((now.getHours() - minH) * 60 + now.getMinutes()) * (HOUR_PX / 60);

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth: Math.max(600, cols.length * 150 + 56) }}>
          <div className="sticky top-0 z-10 flex border-b border-line bg-surface">
            <div className="w-14 shrink-0" />
            {cols.map((c) => (
              <div key={c.key} className={`min-w-0 flex-1 border-s border-line px-2 py-2 text-center text-xs ${!columns && sameDay(c.day, now) ? "bg-brand/10 font-semibold text-brand" : ""}`}>
                <p className="truncate font-medium">{c.label}</p>{c.sub && <p className="truncate text-muted">{c.sub}</p>}
                <p className="text-muted tabular">{c.items.filter((a) => a.status !== "CANCELLED").length}</p>
              </div>
            ))}
          </div>
          <div className="relative flex" style={{ height: hours.length * HOUR_PX }}>
            <div className="w-14 shrink-0">
              {hours.map((h) => <div key={h} className="relative text-[10px] text-muted tabular" style={{ height: HOUR_PX }}><span className="absolute -top-1.5 start-1">{String(h).padStart(2, "0")}:00</span></div>)}
            </div>
            {cols.map((c) => {
              const lanes = layoutLanes(c.items);
              return (
                <div key={c.key} className="relative min-w-0 flex-1 border-s border-line">
                  {hours.map((h) => (
                    <div key={h} className="border-b border-line/60" style={{ height: HOUR_PX }}>
                      {[0, 15, 30, 45].map((m) => (
                        <button key={m} aria-label={`${h}:${String(m).padStart(2, "0")}`} disabled={!onSlot}
                          onClick={() => { const d = new Date(c.day); d.setHours(h, m, 0, 0); onSlot?.(d, c.colId); }}
                          className="block w-full hover:bg-brand/5 disabled:cursor-default" style={{ height: HOUR_PX / 4 }} />
                      ))}
                    </div>
                  ))}
                  {sameDay(c.day, now) && nowTop > 0 && nowTop < hours.length * HOUR_PX && <div className="pointer-events-none absolute inset-x-0 z-[5] h-0.5 bg-red-500" style={{ top: nowTop }} />}
                  {c.items.map((a) => {
                    const s = new Date(a.startsAt), e = new Date(a.endsAt);
                    const top = ((s.getHours() - minH) * 60 + s.getMinutes()) * (HOUR_PX / 60);
                    const height = Math.max(18, ((+e - +s) / 60000) * (HOUR_PX / 60) - 2);
                    const { lane, of } = lanes.get(a.id)!;
                    const st = APPT_STATUS[a.status];
                    const color = a.service?.color ?? st.color;
                    return (
                      <button key={a.id} onClick={() => onPick(a)} title={`${a.client.fullName} — ${a.service?.name ?? ""}`}
                        className={`absolute z-[6] overflow-hidden rounded-md border-s-4 px-1.5 py-0.5 text-start text-[11px] leading-tight shadow-sm hover:z-20 hover:shadow-md ${["CANCELLED", "NO_SHOW"].includes(a.status) ? "opacity-50 line-through" : ""}`}
                        style={{ top, height, insetInlineStart: `calc(${(lane / of) * 100}% + 2px)`, width: `calc(${100 / of}% - 4px)`, borderInlineStartColor: color, background: `color-mix(in srgb, ${color} 14%, var(--surface))` }}>
                        <p className="truncate font-semibold">{a.client.fullName}</p>
                        <p className="truncate text-muted">{fmtTime(a.startsAt, locale)} · {a.service?.name ?? tr("موعد", "Appointment")}</p>
                        {height > 44 && <p className="truncate text-muted">{resource === "staff" || !columns ? a.room?.name ?? "" : a.staff?.fullName ?? ""} {a.status !== "SCHEDULED" && `· ${tr(st.ar, st.en)}`}</p>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Side-by-side lanes for overlapping items in one column. */
function layoutLanes(items: Appt[]) {
  const sorted = [...items].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  const out = new Map<string, { lane: number; of: number }>();
  let cluster: Appt[] = [], laneEnds: number[] = [], clusterEnd = 0;
  const flush = () => { cluster.forEach((a) => (out.get(a.id)!.of = laneEnds.length)); cluster = []; laneEnds = []; };
  for (const a of sorted) {
    const s = +new Date(a.startsAt), e = +new Date(a.endsAt);
    if (cluster.length && s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    out.set(a.id, { lane, of: 1 });
    cluster.push(a); clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

// ----------------------------------------------------------- month grid ----

function MonthGrid({ from, month, appts, onPickDay }: { from: Date; month: number; appts: Appt[]; onPickDay: (d: Date) => void }) {
  const { locale } = useSession();
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  const today = new Date();
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">
        {days.slice(0, 7).map((d) => <div key={d.toISOString()} className="py-2">{new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { weekday: "short" }).format(d)}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const items = appts.filter((a) => sameDay(new Date(a.startsAt), d));
          const active = items.filter((a) => a.status !== "CANCELLED");
          return (
            <button key={d.toISOString()} onClick={() => onPickDay(d)}
              className={`min-h-24 border-b border-s border-line p-1.5 text-start align-top hover:bg-surface-2 ${d.getMonth() !== month ? "bg-surface-2/50 text-muted" : ""}`}>
              <span className={`inline-grid size-6 place-items-center rounded-full text-xs tabular ${sameDay(d, today) ? "bg-brand text-white" : ""}`}>{d.getDate()}</span>
              {active.length > 0 && <span className="ms-1 text-[10px] text-muted tabular">{active.length}</span>}
              <div className="mt-1 space-y-0.5">
                {active.slice(0, 3).map((a) => (
                  <p key={a.id} className="truncate rounded px-1 text-[10px]" style={{ background: `color-mix(in srgb, ${a.service?.color ?? APPT_STATUS[a.status].color} 15%, transparent)` }}>
                    {fmtTime(a.startsAt, locale)} {a.client.fullName}
                  </p>
                ))}
                {active.length > 3 && <p className="text-[10px] text-muted">+{active.length - 3}</p>}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------- waitlist ----

type WaitRow = {
  id: string; branchId: string; staffId: string | null; preferredDate: string | null; preferredTime: string | null; notes: string | null; createdAt: string;
  client: { id: string; fullName: string; phone: string }; service: { name: string } | null; staff: { fullName: string } | null; branch: { name: string };
};

function WaitlistModal({ open, rows, onClose, reload, onBook }: { open: boolean; rows: WaitRow[]; onClose: () => void; reload: () => void; onBook: (w: WaitRow) => void }) {
  const { tr, locale, can } = useSession();
  const { pending, run } = useSubmit();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; fullName: string; phone: string }[]>([]);
  const [f, setF] = useState({ clientId: "", clientName: "", preferredDate: "", preferredTime: "", notes: "" });
  useEffect(() => {
    if (q.trim().length < 2 || f.clientId) return setHits([]);
    const t = setTimeout(() => api<typeof hits>(`/api/clients/lookup?q=${encodeURIComponent(q)}`).then(setHits).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, f.clientId]);

  return (
    <Modal open={open} onClose={onClose} wide title={tr("قائمة الانتظار", "Waitlist")}>
      <div className="space-y-3 text-sm">
        {can("appointments.create") && !adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>+ {tr("إضافة إلى قائمة الانتظار", "Add to waitlist")}</Button>}
        {adding && (
          <form className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api("/api/waitlist", { body: { clientId: f.clientId, preferredDate: f.preferredDate, preferredTime: f.preferredTime, notes: f.notes } }), tr("تمت الإضافة", "Added"))) {
              setAdding(false); setF({ clientId: "", clientName: "", preferredDate: "", preferredTime: "", notes: "" }); setQ(""); reload();
            }
          }}>
            <div className="relative sm:col-span-2">
              {f.clientId ? <p className="rounded-lg bg-surface-2 px-3 py-2">{f.clientName} <button type="button" className="ms-2 text-xs text-brand" onClick={() => setF({ ...f, clientId: "" })}>{tr("تغيير", "Change")}</button></p>
                : <Input required placeholder={tr("ابحث عن العميل…", "Find client…")} value={q} onChange={(e) => setQ(e.target.value)} />}
              {hits.length > 0 && !f.clientId && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
                  {hits.map((h) => <button type="button" key={h.id} className="block w-full px-3 py-2 text-start hover:bg-surface-2" onClick={() => setF({ ...f, clientId: h.id, clientName: h.fullName })}>{h.fullName} <span className="text-xs text-muted" dir="ltr">{h.phone}</span></button>)}
                </div>
              )}
            </div>
            <Field label={tr("التاريخ المفضل", "Preferred date")}><Input type="date" dir="ltr" value={f.preferredDate} onChange={(e) => setF({ ...f, preferredDate: e.target.value })} /></Field>
            <Field label={tr("الوقت المفضل", "Preferred time")}><Input value={f.preferredTime} onChange={(e) => setF({ ...f, preferredTime: e.target.value })} placeholder={tr("صباحاً / مساءً", "Morning / evening")} /></Field>
            <Field label={tr("ملاحظات", "Notes")} className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={!f.clientId} loading={pending}>{tr("إضافة", "Add")}</Button><Button type="button" variant="ghost" onClick={() => setAdding(false)}>{tr("إلغاء", "Cancel")}</Button></div>
          </form>
        )}
        {rows.length === 0 ? <p className="py-8 text-center text-muted">{tr("قائمة الانتظار فارغة", "The waitlist is empty")}</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {rows.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="font-medium">{w.client.fullName} <span className="text-xs text-muted" dir="ltr">{w.client.phone}</span></p>
                  <p className="text-xs text-muted">{[w.service?.name, w.staff?.fullName, w.branch.name, w.preferredDate && fmtDate(w.preferredDate, locale), w.preferredTime, w.notes].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex gap-2">
                  {can("appointments.create") && <Button size="sm" onClick={() => onBook(w)}>{tr("حجز", "Book")}</Button>}
                  {can("appointments.update") && <Button size="sm" variant="ghost" loading={pending} onClick={async () => { if (await run(() => api(`/api/waitlist/${w.id}`, { method: "PATCH", body: { status: "REMOVED" } }))) reload(); }}>{tr("إزالة", "Remove")}</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

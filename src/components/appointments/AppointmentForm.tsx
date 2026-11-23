"use client";
import { useEffect, useMemo, useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession, useToast } from "@/components/providers";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/client";
import { ConflictNotice, asSlotConflict, type SlotConflict } from "@/components/ConflictNotice";
import { type Appt, type Catalog, fromInputs, type Room, type Service, type Staff, toDateInput, toTimeInput } from "./shared";

export type BookingPreset = {
  start?: Date; staffId?: string; roomId?: string; branchId?: string; client?: { id: string; fullName: string; branchId?: string }; waitlistId?: string;
  /** Phase 3: pre-select what the visit is charged to */
  programItemId?: string; subscriptionId?: string; repeatCount?: number; intervalDays?: number;
};

type Coverage = {
  programs: { id: string; code: string; name: string; items: { id: string; serviceId: string; service: { name: string; durationMin: number }; free: number }[] }[];
  subscriptions: { id: string; code: string; name: string; endDate: string; allServices: boolean; coveredServiceIds: string[]; remaining: number | null; booked: number }[];
};

type ClientHit = { id: string; code: string; fullName: string; phone: string; branchId: string };

/** Create (preset) or reschedule/edit (appt) a booking. */
export default function AppointmentForm({ open, preset, appt, onClose, onSaved }: {
  open: boolean; preset?: BookingPreset | null; appt?: Appt | null; onClose: () => void; onSaved: () => void;
}) {
  const { tr, locale, can } = useSession();
  const toast = useToast();
  const editing = !!appt;
  const catalog = useResource<Catalog>(open ? "/api/catalog?active=1" : null);
  const staff = useResource<Staff[]>(open ? "/api/staff" : null);
  const rooms = useResource<Room[]>(open ? "/api/rooms" : null);
  const branches = useResource<{ id: string; name: string; isActive: boolean }[]>(open && can("branches.view") ? "/api/branches" : null);

  const [client, setClient] = useState<{ id: string; fullName: string; branchId?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [quick, setQuick] = useState<{ fullName: string; phone: string } | null>(null);
  const [f, setF] = useState({ branchId: "", serviceId: "", staffId: "", roomId: "", date: "", time: "", duration: 30, status: "SCHEDULED", bookingSource: "phone", notes: "", repeat: "", count: 4 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SlotConflict | null>(null);
  /** "" | "p:<programItemId>" | "s:<subscriptionId>" */
  const [charge, setCharge] = useState("");
  const coverage = useResource<Coverage>(open && !editing && client?.id ? `/api/clients/${client.id}/coverage` : null);

  useEffect(() => {
    if (!open) return;
    setError(null); setConflict(null); setSearch(""); setHits([]); setQuick(null);
    if (appt) {
      const s = new Date(appt.startsAt);
      setClient({ id: appt.client.id, fullName: appt.client.fullName });
      setF({ branchId: appt.branchId, serviceId: appt.serviceId ?? "", staffId: appt.staffId ?? "", roomId: appt.roomId ?? "", date: toDateInput(s), time: toTimeInput(s),
        duration: Math.round((+new Date(appt.endsAt) - +s) / 60000), status: appt.status, bookingSource: appt.bookingSource ?? "", notes: appt.notes ?? "", repeat: "", count: 4 });
    } else {
      const s = preset?.start ?? (() => { const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return d; })();
      setClient(preset?.client ?? null);
      setF({ branchId: preset?.branchId ?? preset?.client?.branchId ?? "", serviceId: "", staffId: preset?.staffId ?? "", roomId: preset?.roomId ?? "",
        date: toDateInput(s), time: toTimeInput(s), duration: 30, status: "SCHEDULED", bookingSource: "phone", notes: "",
        repeat: "", count: Math.max(2, Math.min(52, preset?.repeatCount ?? 4)) });
      setCharge(preset?.programItemId ? `p:${preset.programItemId}` : preset?.subscriptionId ? `s:${preset.subscriptionId}` : "");
    }
  }, [open, appt, preset]);

  // A program session fixes the service (and its duration).
  useEffect(() => {
    if (!charge.startsWith("p:") || !coverage.data) return;
    const item = coverage.data.programs.flatMap((p) => p.items).find((i) => i.id === charge.slice(2));
    if (item) setF((x) => ({ ...x, serviceId: item.serviceId, duration: item.service.durationMin }));
  }, [charge, coverage.data]);

  // client lookup
  useEffect(() => {
    if (client || search.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api<ClientHit[]>(`/api/clients/lookup?q=${encodeURIComponent(search)}`).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [search, client]);

  const branchId = f.branchId || client?.branchId || branches.data?.[0]?.id || "";
  const service = catalog.data?.services.find((s) => s.id === f.serviceId);
  const staffOptions = useMemo(() => (staff.data ?? []).filter((s) =>
    (s.allBranches || !branchId || s.branchIds.includes(branchId)) && (!service || !service.staffIds.length || service.staffIds.includes(s.id)),
  ), [staff.data, branchId, service]);
  const roomOptions = (rooms.data ?? []).filter((r) => r.isActive && (!branchId || r.branchId === branchId));
  const price = service ? service.branchPrices.find((b) => b.branchId === branchId)?.price ?? service.price : null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  function pickService(id: string) {
    const s = catalog.data?.services.find((x) => x.id === id);
    setF((x) => ({ ...x, serviceId: id, duration: s?.durationMin ?? x.duration, staffId: s && s.staffIds.length && x.staffId && !s.staffIds.includes(x.staffId) ? "" : x.staffId }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setConflict(null); setPending(true);
    try {
      let clientId = client?.id;
      if (!clientId && quick) {
        const c = await api<{ id: string }>("/api/clients", { body: { fullName: quick.fullName, phone: quick.phone, status: "ACTIVE", source: f.bookingSource || null, branchId: branchId || null } });
        clientId = c.id;
      }
      if (!clientId) throw new Error(tr("اختر العميل أولاً", "Select a client first"));
      const startsAt = fromInputs(f.date, f.time);
      const endsAt = new Date(+startsAt + Number(f.duration) * 60000);
      if (editing) {
        await api(`/api/appointments/${appt!.id}`, { method: "PATCH", body: { serviceId: f.serviceId || null, staffId: f.staffId || null, roomId: f.roomId || null, startsAt, endsAt, notes: f.notes } });
        toast("success", tr("تم تحديث الموعد", "Appointment updated"));
      } else {
        const r = await api<{ items?: unknown[] }>("/api/appointments", { body: {
          clientId, branchId: branchId || null, serviceId: f.serviceId || null, staffId: f.staffId || null, roomId: f.roomId || null,
          startsAt, endsAt, status: f.status, bookingSource: f.bookingSource, notes: f.notes,
          repeat: f.repeat ? { frequency: f.repeat, count: Number(f.count) } : null,
          programItemId: charge.startsWith("p:") ? charge.slice(2) : null,
          subscriptionId: charge.startsWith("s:") ? charge.slice(2) : null,
        } });
        if (preset?.waitlistId) await api(`/api/waitlist/${preset.waitlistId}`, { method: "PATCH", body: { status: "BOOKED" } }).catch(() => {});
        toast("success", r.items ? tr(`تم حجز ${r.items.length} مواعيد`, `${r.items.length} appointments booked`) : tr("تم حجز الموعد", "Appointment booked"));
      }
      onSaved();
    } catch (err) {
      const c = asSlotConflict(err);
      if (c) setConflict(c);
      else setError(err instanceof Error ? err.message : String(err));
    } finally { setPending(false); }
  }

  const cats = catalog.data?.categories ?? [];
  const catName = (id: string | null) => { const c = cats.find((x) => x.id === id); return c ? (locale === "ar" ? c.name : c.nameEn ?? c.name) : tr("بدون تصنيف", "Uncategorised"); };
  const grouped = Object.entries((catalog.data?.services ?? []).reduce<Record<string, Service[]>>((acc, s) => {
    const k = s.categoryId ?? ""; (acc[k] ??= []).push(s); return acc;
  }, {}));

  return (
    <Modal open={open} onClose={onClose} wide title={editing ? tr("تعديل / إعادة جدولة الموعد", "Edit / reschedule") : tr("حجز موعد", "Book appointment")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="appt-form" type="submit" loading={pending}>{editing ? tr("حفظ", "Save") : tr("حجز", "Book")}</Button></>}>
      <form id="appt-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        {error && <p role="alert" className="sm:col-span-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {conflict && <div className="sm:col-span-3"><ConflictNotice c={conflict} onPick={(iso) => {
          const d = new Date(iso);
          setF((x) => ({ ...x, date: toDateInput(d), time: toTimeInput(d) }));
          setConflict(null);
          toast("success", tr("تم اختيار الوقت، اضغط «حجز» للتأكيد", "Time selected, press Book to confirm"));
        }} /></div>}

        <div className="sm:col-span-3">
          <span className="mb-1.5 block text-sm font-medium">{tr("العميل", "Client")}</span>
          {client ? (
            <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
              <span className="font-medium">{client.fullName}</span>
              {!editing && !preset?.client && <button type="button" className="text-xs text-brand" onClick={() => setClient(null)}>{tr("تغيير", "Change")}</button>}
            </div>
          ) : quick ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input required placeholder={tr("اسم العميل الجديد", "New client name")} value={quick.fullName} onChange={(e) => setQuick({ ...quick, fullName: e.target.value })} />
              <Input required dir="ltr" placeholder="+964…" value={quick.phone} onChange={(e) => setQuick({ ...quick, phone: e.target.value })} />
              <Button type="button" variant="ghost" onClick={() => setQuick(null)}>{tr("بحث بدلاً من ذلك", "Search instead")}</Button>
            </div>
          ) : (
            <div className="relative">
              <Input autoFocus placeholder={tr("ابحث بالاسم أو رقم الهاتف…", "Search by name or phone…")} value={search} onChange={(e) => setSearch(e.target.value)} />
              {(hits.length > 0 || search.trim().length >= 2) && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
                  {hits.map((h) => (
                    <button type="button" key={h.id} onClick={() => { setClient(h); setF((x) => ({ ...x, branchId: x.branchId || h.branchId })); }}
                      className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-surface-2">
                      <span>{h.fullName} <span className="text-xs text-muted">{h.code}</span></span><span className="text-xs text-muted" dir="ltr">{h.phone}</span>
                    </button>
                  ))}
                  {can("clients.create") && (
                    <button type="button" onClick={() => setQuick({ fullName: /\d/.test(search) ? "" : search, phone: /\d/.test(search) ? search : "" })}
                      className="block w-full border-t border-line px-3 py-2 text-start text-sm text-brand hover:bg-surface-2">
                      + {tr("عميل جديد سريع", "Quick new client")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {!editing && coverage.data && (coverage.data.programs.length > 0 || coverage.data.subscriptions.length > 0) && (
          <Field label={tr("احتساب الزيارة على", "Charge visit to")} className="sm:col-span-3"
            hint={tr("الزيارات المحتسبة على برنامج أو اشتراك لا تُسعّر منفردة، وتُخصم تلقائياً عند إنهاء الزيارة.", "Covered visits carry no separate price and are deducted when the visit is completed.")}>
            <Select value={charge} onChange={(e) => setCharge(e.target.value)}>
              <option value="">{tr("— دفع مباشر (بدون برنامج أو اشتراك) —", "— Pay per visit —")}</option>
              {coverage.data.programs.map((p) => (
                <optgroup key={p.id} label={`${tr("برنامج", "Program")}: ${p.name} (${p.code})`}>
                  {p.items.map((i) => <option key={i.id} value={`p:${i.id}`} disabled={i.free <= 0}>{i.service.name} — {tr("متاح للحجز", "bookable")}: {i.free}</option>)}
                </optgroup>
              ))}
              {coverage.data.subscriptions.length > 0 && (
                <optgroup label={tr("الاشتراكات", "Subscriptions")}>
                  {coverage.data.subscriptions.map((sub) => {
                    const free = sub.remaining === null ? null : sub.remaining - sub.booked;
                    const covers = !f.serviceId || sub.allServices || sub.coveredServiceIds.includes(f.serviceId);
                    return <option key={sub.id} value={`s:${sub.id}`} disabled={(free !== null && free <= 0) || !covers}>
                      {sub.name} ({sub.code}) — {free === null ? tr("غير محدود", "unlimited") : `${tr("متبقي", "left")}: ${free}`}{!covers ? ` · ${tr("لا يشمل هذه الخدمة", "doesn't cover this service")}` : ""}
                    </option>;
                  })}
                </optgroup>
              )}
            </Select>
          </Field>
        )}
        {branches.data && branches.data.length > 1 && !editing && (
          <Field label={tr("الفرع", "Branch")}>
            <Select value={branchId} onChange={(e) => setF((x) => ({ ...x, branchId: e.target.value, roomId: "", staffId: "" }))}>
              {branches.data.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label={tr("الخدمة", "Service")} className={branches.data && branches.data.length > 1 && !editing ? "sm:col-span-2" : "sm:col-span-3"}>
          <Select value={f.serviceId} disabled={charge.startsWith("p:")} onChange={(e) => pickService(e.target.value)}>
            <option value="">{tr("— بدون خدمة محددة —", "— No specific service —")}</option>
            {grouped.map(([cid, list]) => (
              <optgroup key={cid} label={catName(cid || null)}>
                {list.map((s) => <option key={s.id} value={s.id}>{locale === "ar" ? s.name : s.nameEn ?? s.name} · {s.durationMin} {tr("د", "min")}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label={tr("الطبيب / الموظف", "Doctor / staff")} hint={service?.staffIds.length ? tr("يظهر المؤهلون لهذه الخدمة فقط", "Only qualified staff shown") : undefined}>
          <Select value={f.staffId} onChange={set("staffId")}>
            <option value="">—</option>
            {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.fullName}{s.jobTitle ? ` — ${s.jobTitle}` : ""}</option>)}
          </Select>
        </Field>
        <Field label={tr("الغرفة", "Room")}>
          <Select value={f.roomId} onChange={set("roomId")}><option value="">—</option>{roomOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        </Field>
        <Field label={tr("المدة (دقيقة)", "Duration (min)")}><Input type="number" min={5} step={5} dir="ltr" value={f.duration} onChange={set("duration")} /></Field>
        <Field label={tr("التاريخ", "Date")}><Input required type="date" dir="ltr" value={f.date} onChange={set("date")} /></Field>
        <Field label={tr("الوقت", "Time")}><Input required type="time" step={300} dir="ltr" value={f.time} onChange={set("time")} /></Field>
        {!editing ? (
          <Field label={tr("الحالة", "Status")}>
            <Select value={f.status} onChange={set("status")}><option value="SCHEDULED">{tr("محجوز", "Scheduled")}</option><option value="CONFIRMED">{tr("مؤكد", "Confirmed")}</option></Select>
          </Field>
        ) : <div />}
        {!editing && (
          <>
            <Field label={tr("مصدر الحجز", "Booking channel")}>
              <Select value={f.bookingSource} onChange={set("bookingSource")}>
                {[["phone", "هاتف", "Phone"], ["whatsapp", "واتساب", "WhatsApp"], ["walk_in", "حضور مباشر", "Walk-in"], ["instagram", "إنستغرام", "Instagram"], ["online", "أونلاين", "Online"]].map(([k, a, e]) => <option key={k} value={k}>{tr(a, e)}</option>)}
              </Select>
            </Field>
            <Field label={tr("تكرار الحجز", "Repeat")}>
              <Select value={f.repeat} onChange={set("repeat")}>
                <option value="">{tr("بدون تكرار", "Does not repeat")}</option>
                <option value="DAILY">{tr("يومياً", "Daily")}</option><option value="WEEKLY">{tr("أسبوعياً", "Weekly")}</option><option value="MONTHLY">{tr("شهرياً", "Monthly")}</option>
              </Select>
            </Field>
            {f.repeat ? <Field label={tr("عدد المرات", "Occurrences")}><Input type="number" min={2} max={52} dir="ltr" value={f.count} onChange={set("count")} /></Field> : <div />}
          </>
        )}
        <Field label={tr("ملاحظات", "Notes")} className="sm:col-span-3">
          <textarea rows={2} value={f.notes} onChange={set("notes")} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40" />
        </Field>
        {price !== null && !charge && <p className="sm:col-span-3 text-sm text-muted">{tr("سعر الخدمة في هذا الفرع:", "Service price at this branch:")} <span className="font-medium text-ink tabular">{Number(price).toLocaleString()}</span></p>}
      </form>
    </Modal>
  );
}

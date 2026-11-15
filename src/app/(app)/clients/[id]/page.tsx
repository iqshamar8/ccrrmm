"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, EmptyState, Input, Modal, Select, Spinner, StatCard, Table, Td, Tr } from "@/components/ui";
import ClientForm, { type ClientInput } from "@/components/clients/ClientForm";
import MedicalTab from "@/components/clients/MedicalTab";
import FilesTab from "@/components/clients/FilesTab";
import CareTab from "@/components/clients/CareTab";
import AppointmentForm from "@/components/appointments/AppointmentForm";
import AppointmentDetail from "@/components/appointments/AppointmentDetail";
import { type Appt, fmtTime } from "@/components/appointments/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import SendMessage from "@/components/messaging/SendMessage";
import { APPT_STATUS, CATEGORIES, CLIENT_STATUS, INTERACTION, interactionLabel, sourceLabel, systemText } from "@/lib/labels2";

type Client = ClientInput & {
  id: string; code: string; createdAt: string; lastVisitAt: string | null; photoFileId: string | null; convertedAt: string | null;
  branch: { id: string; name: string }; owner: { id: string; fullName: string } | null;
  stats: { completed: number; cancelled: number; noShow: number; total: number };
  nextAppointment: (Appt & { service: { name: string } | null; staff: { fullName: string } | null }) | null;
};
type Interaction = { id: string; type: string; content: string; createdAt: string; user: { fullName: string } | null };

export default function ClientProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const { tr, locale, can } = s;
  const router = useRouter();
  const { data: c, loading, error, reload } = useResource<Client>(`/api/clients/${id}`);
  const [tab, setTab] = useState<"overview" | "appointments" | "care" | "medical" | "files">("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const del = useSubmit();
  const canMedical = can("medical.view") && can("medical.view_data");

  if (loading && !c) return <div className="grid place-items-center py-24"><Spinner /></div>;
  if (error || !c) return <Card><EmptyState title={tr("الملف غير موجود أو لا تملك صلاحية الوصول", "Record not found or no access")} action={<Link href="/clients"><Button variant="secondary">{tr("العودة", "Back")}</Button></Link>} /></Card>;
  const st = CLIENT_STATUS[c.status];
  const age = c.birthDate ? Math.floor((Date.now() - +new Date(c.birthDate)) / (365.25 * 86400000)) : null;

  const tabs = [
    ["overview", tr("نظرة عامة", "Overview")],
    ...(can("appointments.view") ? [["appointments", tr("المواعيد والزيارات", "Appointments")]] : []),
    ...(["programs.view", "subscriptions.view", "surgeries.view", "reviews.view"].some(can) ? [["care", tr("البرامج والاشتراكات والعمليات", "Programs, plans & surgeries")]] : []),
    ...(canMedical ? [["medical", tr("الملف الطبي", "Medical record")]] : []),
    ["files", canMedical ? tr("الصور والمرفقات", "Photos & files") : tr("الصورة", "Photo")],
  ] as [typeof tab, string][];

  return (
    <>
      <Link href={c.status === "LEAD" ? "/leads" : "/clients"} className="mb-3 inline-block text-sm text-muted hover:text-ink">← {c.status === "LEAD" ? tr("العملاء المحتملون", "Leads") : tr("العملاء", "Clients")}</Link>
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-start gap-4">
          {c.photoFileId
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/api/files/${c.photoFileId}`} alt="" className="size-16 rounded-full object-cover" />
            : <span className="grid size-16 place-items-center rounded-full bg-brand/10 text-xl font-semibold text-brand">{c.fullName.slice(0, 1)}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{c.fullName}</h1>
              <Badge tone={st.tone}>{tr(st.ar, st.en)}</Badge>
              {c.category === "VIP" && <Badge tone="amber">VIP</Badge>}
              {c.tags.map((t) => <Badge key={t}>{t}</Badge>)}
              {(c as { marketingOptOut?: boolean }).marketingOptOut && <Badge tone="amber">{tr("بدون رسائل تسويقية", "No marketing")}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted"><span dir="ltr">{c.code}</span> · <span dir="ltr">{c.phone}</span>{c.email && <> · <span dir="ltr">{c.email}</span></>}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can("appointments.create") && <Button onClick={() => setBookOpen(true)}>+ {tr("حجز موعد", "Book")}</Button>}
            {can("notifications.create") && <Button variant="secondary" onClick={() => setWaOpen(true)}>{tr("واتساب", "WhatsApp")}</Button>}
            {can("clients.update") && <Button variant="secondary" onClick={() => setEditOpen(true)}>{tr("تعديل", "Edit")}</Button>}
            {can("clients.merge") && <Button variant="secondary" onClick={() => setMergeOpen(true)}>{tr("دمج ملف مكرر", "Merge duplicate")}</Button>}
            {can("clients.delete") && <Button variant="ghost" className="text-danger" onClick={() => setDelOpen(true)}>{tr("حذف", "Delete")}</Button>}
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={tr("الزيارات المكتملة", "Completed visits")} value={c.stats.completed} />
        <StatCard label={tr("آخر زيارة", "Last visit")} value={<span className="text-base">{fmtDate(c.lastVisitAt, locale)}</span>} />
        <StatCard label={tr("الموعد القادم", "Next appointment")} value={<span className="text-base">{c.nextAppointment ? `${fmtDate(c.nextAppointment.startsAt, locale)} ${fmtTime(c.nextAppointment.startsAt, locale)}` : "—"}</span>}
          hint={c.nextAppointment?.service?.name} />
        <StatCard label={tr("الإلغاء / عدم الحضور", "Cancelled / no-show")} value={`${c.stats.cancelled} / ${c.stats.noShow}`} />
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>
        ))}
      </div>

      {tab === "overview" && <Overview c={c} age={age} />}
      {tab === "appointments" && <ClientAppointments clientId={c.id} />}
      {tab === "care" && <CareTab clientId={c.id} />}
      {tab === "medical" && canMedical && <MedicalTab clientId={c.id} />}
      {tab === "files" && <FilesTab clientId={c.id} onPhotoChanged={reload} />}

      <ClientForm open={editOpen} client={c} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload(); }} />
      {can("notifications.create") && <SendMessage open={waOpen} clientIds={[c.id]} onClose={() => setWaOpen(false)} onSent={reload} />}
      <AppointmentForm open={bookOpen} preset={{ client: { id: c.id, fullName: c.fullName, branchId: c.branch.id } }} onClose={() => setBookOpen(false)} onSaved={() => { setBookOpen(false); reload(); }} />
      <MergeModal open={mergeOpen} target={c} onClose={() => setMergeOpen(false)} onMerged={() => { setMergeOpen(false); reload(); }} />
      <ConfirmModal open={delOpen} onClose={() => setDelOpen(false)} loading={del.pending}
        title={tr("حذف ملف العميل", "Delete client")}
        text={tr("سيُخفى الملف من القوائم وتُلغى مواعيده القادمة. يبقى السجل الطبي والتاريخي محفوظاً لأغراض قانونية.", "The record is hidden and upcoming appointments cancelled. Medical and visit history is retained for legal reasons.")}
        confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => { if (await del.run(() => api(`/api/clients/${c.id}`, { method: "DELETE" }), tr("تم حذف الملف", "Record deleted"))) router.push("/clients"); }} />
    </>
  );
}

function Overview({ c, age }: { c: Client; age: number | null }) {
  const { tr, locale } = useSession();
  const rows: [string, React.ReactNode][] = [
    [tr("الجنس", "Gender"), c.gender === "FEMALE" ? tr("أنثى", "Female") : c.gender === "MALE" ? tr("ذكر", "Male") : "—"],
    [tr("تاريخ الميلاد", "Date of birth"), c.birthDate ? `${fmtDate(c.birthDate, locale)} (${age} ${tr("سنة", "y")})` : "—"],
    [tr("العنوان", "Address"), c.address ?? "—"],
    [tr("المصدر", "Source"), `${sourceLabel(c.source, locale)}${c.sourceDetail ? ` — ${c.sourceDetail}` : ""}`],
    [tr("التصنيف", "Category"), c.category ? tr(CATEGORIES[c.category]?.ar ?? c.category, CATEGORIES[c.category]?.en ?? c.category) : "—"],
    [tr("الفرع", "Branch"), c.branch.name],
    [tr("الموظف المسؤول", "Responsible"), c.owner?.fullName ?? "—"],
    [tr("تاريخ التسجيل", "Registered"), fmtDate(c.createdAt, locale)],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="h-fit p-4">
        <dl className="space-y-3 text-sm">
          {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-end">{v}</dd></div>)}
        </dl>
        {c.notes && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{c.notes}</p>}
      </Card>
      <div className="lg:col-span-2"><Timeline clientId={c.id} /></div>
    </div>
  );
}

function Timeline({ clientId }: { clientId: string }) {
  const { tr, locale, can } = useSession();
  const { data, reload } = useResource<Interaction[]>(`/api/clients/${clientId}/interactions`);
  const [type, setType] = useState("NOTE");
  const [content, setContent] = useState("");
  const { pending, run } = useSubmit();
  const icon: Record<string, string> = { NOTE: "✎", CALL: "☎", WHATSAPP: "✆", EMAIL: "✉", VISIT: "✓", SYSTEM: "•" };
  return (
    <Card>
      <div className="border-b border-line px-4 py-3 font-medium">{tr("سجل التفاعل مع العميل", "Interaction history")}</div>
      {can("clients.update") && (
        <form className="flex flex-wrap gap-2 border-b border-line p-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api(`/api/clients/${clientId}/interactions`, { body: { type, content } }), tr("تمت الإضافة", "Added"))) { setContent(""); reload(); }
        }}>
          <Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(INTERACTION).filter(([k]) => k !== "SYSTEM").map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
          </Select>
          <Input className="min-w-0 flex-1" required value={content} onChange={(e) => setContent(e.target.value)} placeholder={tr("اكتب ملاحظة أو ملخص المكالمة…", "Write a note or call summary…")} />
          <Button type="submit" loading={pending}>{tr("إضافة", "Add")}</Button>
        </form>
      )}
      <ul className="max-h-[520px] overflow-y-auto">
        {data?.map((i) => (
          <li key={i.id} className="flex gap-3 border-t border-line px-4 py-3 text-sm first:border-t-0">
            <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs ${i.type === "SYSTEM" ? "bg-surface-2 text-muted" : "bg-brand/10 text-brand"}`}>{icon[i.type]}</span>
            <div className="min-w-0 flex-1">
              <p className={i.type === "SYSTEM" ? "text-muted" : ""}>{i.type === "SYSTEM" || i.type === "VISIT" ? systemText(i.content, locale, (d) => fmtDate(d, locale, true)) : i.content}</p>
              <p className="mt-0.5 text-xs text-muted">{interactionLabel(i.type, locale)} · {i.user?.fullName ?? tr("النظام", "System")} · {fmtDate(i.createdAt, locale, true)}</p>
            </div>
          </li>
        ))}
        {data?.length === 0 && <li className="p-6 text-center text-sm text-muted">{tr("لا يوجد سجل بعد", "No history yet")}</li>}
      </ul>
    </Card>
  );
}

function ClientAppointments({ clientId }: { clientId: string }) {
  const { tr, locale } = useSession();
  const { data, reload } = useResource<Appt[]>(`/api/clients/${clientId}/appointments`);
  const [sel, setSel] = useState<Appt | null>(null);
  const [edit, setEdit] = useState<Appt | null>(null);
  return (
    <Card>
      <Table head={[tr("التاريخ", "Date"), tr("الخدمة", "Service"), tr("الطبيب / الموظف", "Staff"), tr("الفرع", "Branch"), tr("الحالة", "Status"), tr("السعر", "Price")]}>
        {data?.map((a) => {
          const st = APPT_STATUS[a.status];
          return (
            <Tr key={a.id} onClick={() => setSel(a)}>
              <Td className="whitespace-nowrap">{fmtDate(a.startsAt, locale)} <span className="text-muted">{fmtTime(a.startsAt, locale)}</span></Td>
              <Td>{a.service?.name ?? "—"}</Td><Td className="text-muted">{a.staff?.fullName ?? "—"}</Td><Td className="text-muted">{a.branch.name}</Td>
              <Td><Badge tone={st.tone}>{tr(st.ar, st.en)}</Badge></Td><Td className="tabular">{a.price ? Number(a.price).toLocaleString() : "—"}</Td>
            </Tr>
          );
        })}
      </Table>
      {data?.length === 0 && <EmptyState title={tr("لا توجد مواعيد", "No appointments")} />}
      <AppointmentDetail appt={sel} onClose={() => setSel(null)} onChanged={() => { setSel(null); reload(); }} onEdit={(a) => { setSel(null); setEdit(a); }} />
      <AppointmentForm open={!!edit} appt={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </Card>
  );
}

function MergeModal({ open, target, onClose, onMerged }: { open: boolean; target: Client; onClose: () => void; onMerged: () => void }) {
  const { tr } = useSession();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; code: string; fullName: string; phone: string }[]>([]);
  const [source, setSource] = useState<{ id: string; code: string; fullName: string } | null>(null);
  const { pending, run } = useSubmit();
  return (
    <Modal open={open} onClose={onClose} title={tr("دمج ملف مكرر", "Merge duplicate record")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button>
        <Button variant="danger" disabled={!source} loading={pending} onClick={async () => {
          if (await run(() => api(`/api/clients/${target.id}/merge`, { body: { sourceId: source!.id } }), tr("تم دمج الملفين", "Records merged"))) { setSource(null); setQ(""); onMerged(); }
        }}>{tr("دمج", "Merge")}</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">{tr(`ستُنقل جميع المواعيد والسجل الطبي والملفات والملاحظات من الملف المختار إلى ${target.fullName} (${target.code})، ثم يُحذف الملف المكرر.`,
          `All appointments, medical data, files and notes move into ${target.fullName} (${target.code}); the duplicate is then removed.`)}</p>
        <form onSubmit={async (e) => { e.preventDefault(); setHits((await api<typeof hits>(`/api/clients/lookup?q=${encodeURIComponent(q)}`)).filter((h) => h.id !== target.id)); }} className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("ابحث عن الملف المكرر…", "Find the duplicate…")} />
          <Button type="submit" variant="secondary">{tr("بحث", "Search")}</Button>
        </form>
        {hits.map((h) => (
          <button key={h.id} onClick={() => setSource(h)} className={`flex w-full justify-between rounded-lg border px-3 py-2 text-start ${source?.id === h.id ? "border-brand bg-brand/5" : "border-line hover:bg-surface-2"}`}>
            <span>{h.fullName} <span className="text-xs text-muted">{h.code}</span></span><span className="text-xs text-muted" dir="ltr">{h.phone}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

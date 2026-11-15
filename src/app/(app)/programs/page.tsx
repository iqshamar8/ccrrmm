"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import Progress from "@/components/Progress";
import ClientPicker, { type PickedClient } from "@/components/clients/ClientPicker";
import type { Catalog, Staff } from "@/components/appointments/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { lbl, PROGRAM_STATUS, tone } from "@/lib/labels3";

export type ProgramRow = {
  id: string; code: string; name: string; status: string; price: string; startDate: string; endDate: string | null; createdAt: string;
  client: { id: string; fullName: string; code: string }; doctor: { fullName: string } | null; branch: { name: string };
  progress: { total: number; used: number; remaining: number; percent: number }; lastSessionAt: string | null; stalled: boolean;
};
type Template = { id: string; name: string; nameEn: string | null; description: string | null; price: string; validityDays: number | null; intervalDays: number | null; isActive: boolean;
  items: { serviceId: string; sessions: number; service: { name: string } }[]; _count: { programs: number } };

export default function ProgramsPage() {
  const { tr, locale, can } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<"programs" | "templates">("programs");
  const [status, setStatus] = useState("ACTIVE");
  const [stalled, setStalled] = useState(false);
  const [q, setQ] = useState("");
  const [assign, setAssign] = useState(false);
  const [editTpl, setEditTpl] = useState<Template | "new" | null>(null);
  const ok = can("programs.view");
  const progs = useResource<ProgramRow[]>(ok && tab === "programs" ? `/api/programs?status=${stalled ? "" : status}&stalled=${stalled ? 1 : 0}&q=${encodeURIComponent(q)}` : null);
  const tpls = useResource<Template[]>(ok ? "/api/program-templates" : null);
  if (!ok) return <Forbidden />;

  return (
    <>
      <PageHeader title={tr("البرامج العلاجية", "Treatment programs")} subtitle={tr("برامج متعددة الجلسات: المنفذ والمتبقي ونسبة الإنجاز", "Multi-session programs: done, remaining and progress")}
        actions={<>
          {can("programs.create") && tab === "templates" && <Button variant="secondary" onClick={() => setEditTpl("new")}>+ {tr("قالب برنامج", "Template")}</Button>}
          {can("programs.create") && <Button onClick={() => setAssign(true)}>+ {tr("برنامج لعميل", "Assign program")}</Button>}
        </>} />
      <div className="mb-4 flex gap-1 border-b border-line">
        {([["programs", tr("برامج العملاء", "Client programs")], ["templates", tr("قوالب البرامج", "Templates")]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-4 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>

      {tab === "programs" ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Input className="max-w-xs" placeholder={tr("بحث بالعميل أو البرنامج أو الرمز…", "Search client, program, code…")} value={q} onChange={(e) => setQ(e.target.value)} />
            <Select className="w-auto" value={status} disabled={stalled} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{tr("كل الحالات", "All statuses")}</option>
              {Object.entries(PROGRAM_STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
            </Select>
            <Checkbox label={tr("متوقفة عن المتابعة (+30 يوم بلا جلسة)", "Stalled (30+ days without a session)")} checked={stalled} onChange={(e) => setStalled(e.target.checked)} />
          </div>
          <Table head={[tr("البرنامج", "Program"), tr("العميل", "Client"), tr("الإنجاز", "Progress"), tr("آخر جلسة", "Last session"), tr("الطبيب", "Doctor"), tr("ينتهي", "Ends"), tr("الحالة", "Status")]}>
            {progs.loading && !progs.data ? <LoadingRows cols={7} /> : progs.data?.map((p) => (
              <Tr key={p.id} onClick={() => router.push(`/programs/${p.id}`)}>
                <Td><p className="font-medium">{p.name}</p><p className="text-xs text-muted" dir="ltr">{p.code}</p></Td>
                <Td>{p.client.fullName}</Td>
                <Td><Progress used={p.progress.used} total={p.progress.total} /></Td>
                <Td className="text-muted whitespace-nowrap">{fmtDate(p.lastSessionAt, locale)} {p.stalled && <Badge tone="amber">{tr("متوقف", "Stalled")}</Badge>}</Td>
                <Td className="text-muted">{p.doctor?.fullName ?? "—"}</Td>
                <Td className="text-muted whitespace-nowrap">{fmtDate(p.endDate, locale)}</Td>
                <Td><Badge tone={tone(PROGRAM_STATUS, p.status)}>{lbl(PROGRAM_STATUS, p.status, locale)}</Badge></Td>
              </Tr>
            ))}
          </Table>
          {!progs.loading && progs.data?.length === 0 && <EmptyState title={tr("لا توجد برامج مطابقة", "No matching programs")} />}
        </Card>
      ) : (
        <Card>
          <Table head={[tr("القالب", "Template"), tr("الخدمات والجلسات", "Services & sessions"), tr("السعر", "Price"), tr("الصلاحية", "Validity"), tr("الفاصل", "Interval"), tr("مُباع", "Sold"), tr("الحالة", "Status")]}>
            {tpls.data?.map((t) => (
              <Tr key={t.id} onClick={can("programs.update") ? () => setEditTpl(t) : undefined}>
                <Td className="font-medium">{locale === "ar" ? t.name : t.nameEn ?? t.name}</Td>
                <Td className="text-xs text-muted">{t.items.map((i) => `${i.service.name} ×${i.sessions}`).join("، ")}</Td>
                <Td className="tabular">{Number(t.price).toLocaleString()}</Td>
                <Td className="text-muted">{t.validityDays ? `${t.validityDays} ${tr("يوم", "d")}` : "—"}</Td>
                <Td className="text-muted">{t.intervalDays ? `${tr("كل", "every")} ${t.intervalDays} ${tr("يوم", "d")}` : "—"}</Td>
                <Td className="tabular">{t._count.programs}</Td>
                <Td><Badge tone={t.isActive ? "green" : "gray"}>{t.isActive ? tr("متاح", "Active") : tr("معطل", "Inactive")}</Badge></Td>
              </Tr>
            ))}
          </Table>
          {tpls.data?.length === 0 && <EmptyState title={tr("لا توجد قوالب", "No templates")} text={tr("أنشئ قالباً لتسريع بيع البرامج المتكررة.", "Create templates to sell recurring programs faster.")} />}
        </Card>
      )}

      <AssignModal open={assign} templates={tpls.data ?? []} onClose={() => setAssign(false)} onDone={(id) => { setAssign(false); router.push(`/programs/${id}`); }} />
      <TemplateModal tpl={editTpl} onClose={() => setEditTpl(null)} onSaved={() => { setEditTpl(null); tpls.reload(); }} />
    </>
  );
}

type ItemRow = { serviceId: string; sessions: number };
function ItemsEditor({ items, setItems }: { items: ItemRow[]; setItems: (i: ItemRow[]) => void }) {
  const { tr } = useSession();
  const cat = useResource<Catalog>("/api/catalog?active=1");
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex gap-2">
          <Select className="min-w-0 flex-1" value={it.serviceId} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, serviceId: e.target.value } : x)))}>
            <option value="">{tr("اختر الخدمة", "Choose service")}</option>
            {cat.data?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input className="w-24" type="number" min={1} dir="ltr" value={it.sessions} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, sessions: Number(e.target.value) } : x)))} aria-label={tr("الجلسات", "Sessions")} />
          <Button type="button" variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="remove">×</Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" onClick={() => setItems([...items, { serviceId: "", sessions: 1 }])}>+ {tr("خدمة", "Service")}</Button>
    </div>
  );
}

function AssignModal({ open, templates, onClose, onDone }: { open: boolean; templates: Template[]; onClose: () => void; onDone: (id: string) => void }) {
  const { tr } = useSession();
  const staff = useResource<Staff[]>(open ? "/api/staff" : null);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [tplId, setTplId] = useState("");
  const [f, setF] = useState({ name: "", price: "", startDate: "", doctorId: "", notes: "" });
  const [items, setItems] = useState<ItemRow[]>([{ serviceId: "", sessions: 4 }]);
  const { pending, run } = useSubmit();
  useEffect(() => { if (open) { setClient(null); setTplId(""); setF({ name: "", price: "", startDate: new Date().toISOString().slice(0, 10), doctorId: "", notes: "" }); setItems([{ serviceId: "", sessions: 4 }]); } }, [open]);
  function pickTpl(id: string) {
    setTplId(id);
    const t = templates.find((x) => x.id === id);
    if (t) { setF((x) => ({ ...x, name: t.name, price: String(Number(t.price)) })); setItems(t.items.map((i) => ({ serviceId: i.serviceId, sessions: i.sessions }))); }
  }
  return (
    <Modal open={open} onClose={onClose} wide title={tr("برنامج علاجي لعميل", "Assign a program")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="assign" type="submit" loading={pending} disabled={!client}>{tr("حفظ البرنامج", "Save program")}</Button></>}>
      <form id="assign" className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api<{ id: string }>("/api/programs", { body: {
          clientId: client!.id, templateId: tplId || null, name: f.name || undefined, price: f.price === "" ? undefined : f.price,
          items: items.filter((i) => i.serviceId).map((i) => ({ serviceId: i.serviceId, sessions: i.sessions })), startDate: f.startDate || undefined, doctorId: f.doctorId || null, notes: f.notes,
        } }), tr("تم إنشاء البرنامج", "Program created"));
        if (r) onDone(r.id);
      }}>
        <div className="sm:col-span-2"><span className="mb-1.5 block text-sm font-medium">{tr("العميل", "Client")}</span><ClientPicker value={client} onChange={setClient} /></div>
        <Field label={tr("من قالب", "From template")}>
          <Select value={tplId} onChange={(e) => pickTpl(e.target.value)}>
            <option value="">{tr("— برنامج مخصص —", "— Custom program —")}</option>
            {templates.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label={tr("اسم البرنامج", "Program name")}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("سعر البرنامج", "Program price")}><Input type="number" min={0} step="any" dir="ltr" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label={tr("تاريخ البدء", "Start date")}><Input type="date" dir="ltr" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label={tr("الطبيب المسؤول", "Responsible doctor")}>
          <Select value={f.doctorId} onChange={(e) => setF({ ...f, doctorId: e.target.value })}><option value="">—</option>{staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select>
        </Field>
        <Field label={tr("ملاحظات", "Notes")}><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="sm:col-span-2"><p className="mb-2 text-sm font-medium">{tr("الخدمات وعدد الجلسات", "Services & sessions")}</p><ItemsEditor items={items} setItems={setItems} /></div>
        <p className="sm:col-span-2 text-xs text-muted">{tr("تُحفظ الخدمات والسعر كنسخة ثابتة لهذا العميل — تعديل القالب لاحقاً لا يغيّر البرامج المباعة.", "Services & price are snapshotted for this client — later template edits don't change sold programs.")}</p>
      </form>
    </Modal>
  );
}

function TemplateModal({ tpl, onClose, onSaved }: { tpl: Template | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr, can } = useSession();
  const isNew = tpl === "new";
  const [f, setF] = useState({ name: "", nameEn: "", description: "", price: "0", validityDays: "", intervalDays: "", isActive: true });
  const [items, setItems] = useState<ItemRow[]>([]);
  const { pending, fields, run } = useSubmit();
  const del = useSubmit();
  useEffect(() => {
    if (tpl === "new") { setF({ name: "", nameEn: "", description: "", price: "0", validityDays: "180", intervalDays: "21", isActive: true }); setItems([{ serviceId: "", sessions: 6 }]); }
    else if (tpl) { setF({ name: tpl.name, nameEn: tpl.nameEn ?? "", description: tpl.description ?? "", price: String(Number(tpl.price)), validityDays: String(tpl.validityDays ?? ""), intervalDays: String(tpl.intervalDays ?? ""), isActive: tpl.isActive }); setItems(tpl.items.map((i) => ({ serviceId: i.serviceId, sessions: i.sessions }))); }
  }, [tpl]);
  return (
    <Modal open={!!tpl} onClose={onClose} wide title={isNew ? tr("قالب برنامج جديد", "New program template") : tr("تعديل القالب", "Edit template")}
      footer={<div className="flex w-full justify-between">
        <div>{!isNew && can("programs.delete") && <Button variant="ghost" className="text-danger" loading={del.pending} onClick={async () => { if (await del.run(() => api(`/api/program-templates/${(tpl as Template).id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) onSaved(); }}>{tr("حذف", "Delete")}</Button>}</div>
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="tpl" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></div>
      </div>}>
      <form id="tpl" className="grid gap-4 sm:grid-cols-3" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f, items: items.filter((i) => i.serviceId) };
        if (await run(() => api(isNew ? "/api/program-templates" : `/api/program-templates/${(tpl as Template).id}`, { method: isNew ? "POST" : "PATCH", body }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("الاسم", "Name")} error={fields.name} className="sm:col-span-2"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("الاسم بالإنجليزية", "English name")}><Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <Field label={tr("السعر", "Price")}><Input type="number" min={0} step="any" dir="ltr" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label={tr("الصلاحية (يوم)", "Validity (days)")} hint={tr("فارغ = بلا حد", "empty = no limit")}><Input type="number" min={1} dir="ltr" value={f.validityDays} onChange={(e) => setF({ ...f, validityDays: e.target.value })} /></Field>
        <Field label={tr("الفاصل بين الجلسات (يوم)", "Interval (days)")}><Input type="number" min={1} dir="ltr" value={f.intervalDays} onChange={(e) => setF({ ...f, intervalDays: e.target.value })} /></Field>
        <Field label={tr("الوصف", "Description")} className="sm:col-span-3"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="sm:col-span-3"><p className="mb-2 text-sm font-medium">{tr("الخدمات وعدد الجلسات", "Services & sessions")}</p>{fields.items && <p className="mb-2 text-xs text-danger">{fields.items}</p>}<ItemsEditor items={items} setItems={setItems} /></div>
        <Checkbox label={tr("متاح للبيع", "Available")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
      </form>
    </Modal>
  );
}

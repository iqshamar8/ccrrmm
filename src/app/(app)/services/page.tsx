"use client";
import { useEffect, useMemo, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import ServiceMaterials from "@/components/inventory/ServiceMaterials";
import type { Category, Staff } from "@/components/appointments/shared";
import { api } from "@/lib/client";
import { SERVICE_KIND, serviceKindLabel } from "@/lib/labels2";

type Svc = {
  id: string; name: string; nameEn: string | null; code: string | null; description: string | null; categoryId: string | null; kind: string;
  price: string; cost: string | null; durationMin: number; execCommissionType: string; execCommissionValue: string | null;
  marketingCommissionType: string; marketingCommissionValue: string | null; color: string | null; isActive: boolean;
  staffIds: string[]; branchPrices: { branchId: string; price: string }[]; appointments: number;
};

export default function ServicesPage() {
  const s = useSession();
  const { tr, locale, can } = s;
  const { data, loading, reload } = useResource<{ categories: Category[]; services: Svc[] }>(can("services.view") ? "/api/catalog" : null);
  const [cat, setCat] = useState<string | null>(null); // null = all, "" = uncategorised
  const [q, setQ] = useState("");
  const [editSvc, setEditSvc] = useState<Svc | "new" | null>(null);
  const [editCat, setEditCat] = useState<Category | { parentId: string | null } | null>(null);
  const [delCat, setDelCat] = useState<Category | null>(null);
  const del = useSubmit();

  const children = useMemo(() => {
    const m = new Map<string | null, Category[]>();
    data?.categories.forEach((c) => m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]));
    return m;
  }, [data]);
  const descendants = useMemo(() => {
    const out = new Set<string>();
    const walk = (id: string) => { out.add(id); (children.get(id) ?? []).forEach((c) => walk(c.id)); };
    if (cat) walk(cat);
    return out;
  }, [cat, children]);

  if (!can("services.view")) return <Forbidden />;
  if (loading && !data) return <div className="grid place-items-center py-24"><Spinner /></div>;
  const name = (x: { name: string; nameEn: string | null }) => (locale === "ar" ? x.name : x.nameEn ?? x.name);
  const services = (data?.services ?? []).filter((x) =>
    (cat === null || (cat === "" ? !x.categoryId : x.categoryId && descendants.has(x.categoryId))) &&
    (!q || x.name.includes(q) || x.nameEn?.toLowerCase().includes(q.toLowerCase())));
  const count = (id: string) => {
    let n = 0; const walk = (c: string) => { n += data!.services.filter((s) => s.categoryId === c).length; (children.get(c) ?? []).forEach((x) => walk(x.id)); };
    walk(id); return n;
  };

  const Node = ({ c, depth }: { c: Category; depth: number }) => (
    <>
      <div className={`group flex items-center gap-1 rounded-lg pe-1 text-sm ${cat === c.id ? "bg-brand/10 text-brand" : "hover:bg-surface-2"}`} style={{ paddingInlineStart: 8 + depth * 14 }}>
        <button className="flex-1 truncate py-1.5 text-start" onClick={() => setCat(c.id)}>
          {(children.get(c.id)?.length ?? 0) > 0 ? "▾ " : "• "}{name(c)} <span className="text-xs text-muted">({count(c.id)})</span>{!c.isActive && <span className="ms-1 text-xs text-muted">· {tr("معطل", "off")}</span>}
        </button>
        {can("services.create") && <button title={tr("تصنيف فرعي", "Sub-category")} className="hidden px-1 text-muted hover:text-brand group-hover:block" onClick={() => setEditCat({ parentId: c.id })}>+</button>}
        {can("services.update") && <button title={tr("تعديل", "Edit")} className="hidden px-1 text-muted hover:text-brand group-hover:block" onClick={() => setEditCat(c)}>✎</button>}
        {can("services.delete") && <button title={tr("حذف", "Delete")} className="hidden px-1 text-muted hover:text-danger group-hover:block" onClick={() => setDelCat(c)}>×</button>}
      </div>
      {(children.get(c.id) ?? []).map((ch) => <Node key={ch.id} c={ch} depth={depth + 1} />)}
    </>
  );

  return (
    <>
      <PageHeader title={tr("الخدمات وشجرة الخدمات", "Services")} subtitle={tr("المجموعات والتصنيفات والخدمات وأسعارها ومدتها والعمولات", "Groups, categories, services, prices, durations and commissions")}
        actions={can("services.create") && <><Button variant="secondary" onClick={() => setEditCat({ parentId: null })}>+ {tr("مجموعة", "Group")}</Button><Button onClick={() => setEditSvc("new")}>+ {tr("خدمة", "Service")}</Button></>} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit p-2">
          <button className={`w-full rounded-lg px-2 py-1.5 text-start text-sm ${cat === null ? "bg-brand/10 text-brand" : "hover:bg-surface-2"}`} onClick={() => setCat(null)}>{tr("كل الخدمات", "All services")} ({data?.services.length})</button>
          {(children.get(null) ?? []).map((c) => <Node key={c.id} c={c} depth={0} />)}
          {data?.services.some((x) => !x.categoryId) && <button className={`w-full rounded-lg px-2 py-1.5 text-start text-sm ${cat === "" ? "bg-brand/10 text-brand" : "hover:bg-surface-2"}`} onClick={() => setCat("")}>{tr("بدون تصنيف", "Uncategorised")}</button>}
        </Card>
        <Card>
          <div className="border-b border-line p-3"><Input className="max-w-xs" placeholder={tr("بحث عن خدمة…", "Search services…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Table head={[tr("الخدمة", "Service"), tr("النوع", "Type"), tr("المدة", "Duration"), tr("السعر", "Price"), tr("التكلفة", "Cost"), tr("عمولة التنفيذ", "Exec. comm."), tr("المؤهلون", "Qualified"), tr("الحالة", "Status")]}>
            {services.map((x) => (
              <Tr key={x.id} onClick={can("services.update") ? () => setEditSvc(x) : undefined}>
                <Td><span className="me-2 inline-block size-2.5 rounded-full align-middle" style={{ background: x.color ?? "#94a3b8" }} /><span className="font-medium">{name(x)}</span>
                  {x.branchPrices.length > 0 && <span className="ms-2 text-xs text-muted">· {tr("أسعار خاصة بالفروع", "branch prices")}</span>}</Td>
                <Td className="text-muted">{serviceKindLabel(x.kind, locale)}</Td>
                <Td className="tabular">{x.durationMin} {tr("د", "min")}</Td>
                <Td className="tabular">{Number(x.price).toLocaleString()}</Td>
                <Td className="tabular text-muted">{x.cost === null ? "•••" : Number(x.cost).toLocaleString()}</Td>
                <Td className="tabular text-muted">{x.execCommissionType === "NONE" ? "—" : x.execCommissionValue === null ? "•••" : x.execCommissionType === "PERCENT" ? `${Number(x.execCommissionValue)}%` : Number(x.execCommissionValue).toLocaleString()}</Td>
                <Td className="text-muted">{x.staffIds.length || tr("الكل", "Anyone")}</Td>
                <Td><Badge tone={x.isActive ? "green" : "gray"}>{x.isActive ? tr("مفعّلة", "Active") : tr("معطلة", "Inactive")}</Badge></Td>
              </Tr>
            ))}
          </Table>
          {services.length === 0 && <EmptyState title={tr("لا توجد خدمات هنا", "No services here")} action={can("services.create") && <Button onClick={() => setEditSvc("new")}>{tr("إضافة خدمة", "Add service")}</Button>} />}
        </Card>
      </div>
      <ServiceModal svc={editSvc} categories={data?.categories ?? []} defaultCategory={cat || null} onClose={() => setEditSvc(null)} onSaved={() => { setEditSvc(null); reload(); }} />
      <CategoryModal cat={editCat} categories={data?.categories ?? []} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); reload(); }} />
      <ConfirmModal open={!!delCat} onClose={() => setDelCat(null)} loading={del.pending} title={tr("حذف التصنيف", "Delete category")}
        text={tr("يجب أن يكون التصنيف فارغاً من الخدمات والتصنيفات الفرعية.", "The category must have no services or sub-categories.")}
        confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => { if (await del.run(() => api(`/api/service-categories/${delCat!.id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) { setDelCat(null); setCat(null); reload(); } }} />
    </>
  );
}

function CategoryModal({ cat, categories, onClose, onSaved }: { cat: Category | { parentId: string | null } | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const { pending, fields, run } = useSubmit();
  const isEdit = !!cat && "id" in cat;
  const [f, setF] = useState({ name: "", nameEn: "", parentId: "", sortOrder: 0, isActive: true });
  useEffect(() => {
    if (!cat) return;
    setF("id" in cat ? { name: cat.name, nameEn: cat.nameEn ?? "", parentId: cat.parentId ?? "", sortOrder: cat.sortOrder, isActive: cat.isActive } : { name: "", nameEn: "", parentId: cat.parentId ?? "", sortOrder: 0, isActive: true });
  }, [cat]);
  return (
    <Modal open={!!cat} onClose={onClose} title={isEdit ? tr("تعديل التصنيف", "Edit category") : f.parentId ? tr("تصنيف فرعي جديد", "New sub-category") : tr("مجموعة خدمات جديدة", "New service group")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="cat-form" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="cat-form" className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f, parentId: f.parentId || null };
        if (await run(() => api(isEdit ? `/api/service-categories/${(cat as Category).id}` : "/api/service-categories", { method: isEdit ? "PATCH" : "POST", body }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("الاسم بالعربية", "Arabic name")} error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("الاسم بالإنجليزية", "English name")}><Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <Field label={tr("يتبع إلى", "Parent")} error={fields.parentId}>
          <Select value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
            <option value="">{tr("— مستوى رئيسي —", "— Top level —")}</option>
            {categories.filter((c) => !isEdit || c.id !== (cat as Category).id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={tr("الترتيب", "Order")}><Input type="number" dir="ltr" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
        <Checkbox label={tr("مفعّل", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
      </form>
    </Modal>
  );
}

function ServiceModal({ svc, categories, defaultCategory, onClose, onSaved }: { svc: Svc | "new" | null; categories: Category[]; defaultCategory: string | null; onClose: () => void; onSaved: () => void }) {
  const { tr, can } = useSession();
  const isNew = svc === "new";
  const staff = useResource<Staff[]>(svc ? "/api/staff" : null);
  const branches = useResource<{ id: string; name: string }[]>(svc && can("branches.view") ? "/api/branches" : null);
  const { pending, fields, run } = useSubmit();
  const del = useSubmit();
  const blank = { name: "", nameEn: "", code: "", description: "", categoryId: "", kind: "OTHER", price: "0", cost: "0", durationMin: "30", execType: "NONE", execValue: "0", mktType: "NONE", mktValue: "0", color: "#0f766e", isActive: true, staffIds: [] as string[], branchPrices: {} as Record<string, string> };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!svc) return;
    if (svc === "new") setF({ ...blank, categoryId: defaultCategory ?? "" });
    else setF({ name: svc.name, nameEn: svc.nameEn ?? "", code: svc.code ?? "", description: svc.description ?? "", categoryId: svc.categoryId ?? "", kind: svc.kind,
      price: String(Number(svc.price)), cost: String(Number(svc.cost ?? 0)), durationMin: String(svc.durationMin),
      execType: svc.execCommissionType, execValue: String(Number(svc.execCommissionValue ?? 0)), mktType: svc.marketingCommissionType, mktValue: String(Number(svc.marketingCommissionValue ?? 0)),
      color: svc.color ?? "#0f766e", isActive: svc.isActive, staffIds: svc.staffIds, branchPrices: Object.fromEntries(svc.branchPrices.map((b) => [b.branchId, String(Number(b.price))])) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggleStaff = (id: string) => setF((x) => ({ ...x, staffIds: x.staffIds.includes(id) ? x.staffIds.filter((s) => s !== id) : [...x.staffIds, id] }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: f.name, nameEn: f.nameEn, code: f.code, description: f.description, categoryId: f.categoryId || null, kind: f.kind, price: f.price, cost: f.cost,
      durationMin: f.durationMin, execCommission: { type: f.execType, value: f.execValue }, marketingCommission: { type: f.mktType, value: f.mktValue },
      color: f.color, isActive: f.isActive, staffIds: f.staffIds,
      branchPrices: Object.entries(f.branchPrices).filter(([, v]) => v !== "").map(([branchId, price]) => ({ branchId, price })),
    };
    if (await run(() => api(isNew ? "/api/services" : `/api/services/${(svc as Svc).id}`, { method: isNew ? "POST" : "PATCH", body }), tr("تم حفظ الخدمة", "Service saved"))) onSaved();
  }

  return (
    <Modal open={!!svc} onClose={onClose} wide title={isNew ? tr("خدمة جديدة", "New service") : tr("تعديل الخدمة", "Edit service")}
      footer={<div className="flex w-full justify-between">
        <div>{!isNew && can("services.delete") && <Button variant="ghost" className="text-danger" loading={del.pending} onClick={async () => {
          if (await del.run(() => api(`/api/services/${(svc as Svc).id}`, { method: "DELETE" }), tr("تم حذف الخدمة", "Service deleted"))) onSaved();
        }}>{tr("حذف", "Delete")}</Button>}</div>
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="svc-form" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></div>
      </div>}>
      <form id="svc-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-4">
        <Field label={tr("اسم الخدمة", "Name")} error={fields.name} className="sm:col-span-2"><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label={tr("الاسم بالإنجليزية", "English name")} className="sm:col-span-2"><Input dir="ltr" value={f.nameEn} onChange={set("nameEn")} /></Field>
        <Field label={tr("التصنيف", "Category")} className="sm:col-span-2">
          <Select value={f.categoryId} onChange={set("categoryId")}><option value="">{tr("بدون تصنيف", "Uncategorised")}</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </Field>
        <Field label={tr("نوع الخدمة", "Type")}>
          <Select value={f.kind} onChange={set("kind")}>{Object.entries(SERVICE_KIND).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select>
        </Field>
        <Field label={tr("الرمز", "Code")}><Input dir="ltr" value={f.code} onChange={set("code")} /></Field>
        <Field label={tr("السعر", "Price")} error={fields.price}><Input type="number" min={0} step="any" dir="ltr" value={f.price} onChange={set("price")} /></Field>
        <Field label={tr("التكلفة", "Cost")} error={fields.cost}><Input type="number" min={0} step="any" dir="ltr" value={f.cost} onChange={set("cost")} /></Field>
        <Field label={tr("المدة (دقيقة)", "Duration (min)")} error={fields.durationMin}><Input type="number" min={5} step={5} dir="ltr" value={f.durationMin} onChange={set("durationMin")} /></Field>
        <Field label={tr("لون التقويم", "Calendar colour")}><input type="color" value={f.color} onChange={set("color")} className="h-10 w-full rounded-lg border border-line bg-surface" /></Field>
        <Field label={tr("عمولة التنفيذ", "Execution commission")} error={fields["execCommission"]} className="sm:col-span-2">
          <div className="flex gap-2">
            <Select className="w-36" value={f.execType} onChange={set("execType")}><option value="NONE">{tr("بدون", "None")}</option><option value="PERCENT">%</option><option value="FIXED">{tr("مبلغ ثابت", "Fixed")}</option></Select>
            <Input type="number" min={0} step="any" dir="ltr" disabled={f.execType === "NONE"} value={f.execValue} onChange={set("execValue")} />
          </div>
        </Field>
        <Field label={tr("عمولة التسويق", "Marketing commission")} error={fields["marketingCommission"]} className="sm:col-span-2">
          <div className="flex gap-2">
            <Select className="w-36" value={f.mktType} onChange={set("mktType")}><option value="NONE">{tr("بدون", "None")}</option><option value="PERCENT">%</option><option value="FIXED">{tr("مبلغ ثابت", "Fixed")}</option></Select>
            <Input type="number" min={0} step="any" dir="ltr" disabled={f.mktType === "NONE"} value={f.mktValue} onChange={set("mktValue")} />
          </div>
        </Field>
        <Field label={tr("الوصف", "Description")} className="sm:col-span-4"><Input value={f.description} onChange={set("description")} /></Field>

        <div className="sm:col-span-4 border-t border-line pt-4">
          <p className="mb-1 font-medium">{tr("الموظفون المؤهلون لتنفيذ الخدمة", "Qualified staff")}</p>
          <p className="mb-3 text-xs text-muted">{tr("اترك الكل غير محدد ليتمكن أي موظف من تنفيذها.", "Leave all unchecked to allow anyone.")}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {staff.data?.map((s) => <Checkbox key={s.id} checked={f.staffIds.includes(s.id)} onChange={() => toggleStaff(s.id)} label={<>{s.fullName} <span className="text-xs text-muted">{s.jobTitle}</span></>} />)}
          </div>
        </div>
        {branches.data && branches.data.length > 1 && (
          <div className="sm:col-span-4 border-t border-line pt-4">
            <p className="mb-1 font-medium">{tr("أسعار خاصة بالفروع", "Branch-specific prices")}</p>
            <p className="mb-3 text-xs text-muted">{tr("اتركه فارغاً لاستخدام السعر الأساسي.", "Leave empty to use the base price.")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {branches.data.map((b) => (
                <Field key={b.id} label={b.name}>
                  <Input type="number" min={0} step="any" dir="ltr" placeholder={f.price} value={f.branchPrices[b.id] ?? ""} onChange={(e) => setF((x) => ({ ...x, branchPrices: { ...x.branchPrices, [b.id]: e.target.value } }))} />
                </Field>
              ))}
            </div>
          </div>
        )}
        <div className="sm:col-span-4"><Checkbox label={tr("الخدمة مفعّلة ومتاحة للحجز", "Active and bookable")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></div>
        {!isNew && can("inventory.view") && <ServiceMaterials serviceId={(svc as Svc).id} />}
      </form>
    </Modal>
  );
}

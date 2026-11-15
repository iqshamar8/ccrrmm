"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession, useToast } from "@/components/providers";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import { CATEGORIES, CLIENT_STATUS, SOURCES } from "@/lib/labels2";

export type ClientInput = {
  id?: string; fullName: string; phone: string; email: string | null; gender: string | null; birthDate: string | null; address: string | null;
  source: string | null; sourceDetail?: string | null; status: string; category: string | null; tags: string[]; notes?: string | null;
  branchId: string | null; ownerId?: string | null; influencerId?: string | null; marketingOptOut?: boolean;
};

const blank: ClientInput = { fullName: "", phone: "", email: "", gender: "", birthDate: "", address: "", source: "", sourceDetail: "", status: "ACTIVE", category: "REGULAR", tags: [], notes: "", branchId: "", ownerId: "", influencerId: "", marketingOptOut: false };

export default function ClientForm({ open, client, defaultStatus, onClose, onSaved }: {
  open: boolean; client: ClientInput | null; defaultStatus?: string; onClose: () => void; onSaved: (c: { id: string }) => void;
}) {
  const { tr, locale, can } = useSession();
  const toast = useToast();
  const branches = useResource<{ id: string; name: string }[]>(open && can("branches.view") ? "/api/branches" : null);
  const staff = useResource<{ id: string; fullName: string }[]>(open && can("appointments.view") ? "/api/staff" : null);
  const influencers = useResource<{ id: string; name: string; isActive: boolean }[]>(open && can("marketing.view") ? "/api/marketing/influencers" : null);
  const [f, setF] = useState<ClientInput>(blank);
  const [tags, setTags] = useState("");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [dup, setDup] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const c = client ?? { ...blank, status: defaultStatus ?? "ACTIVE" };
    setF({ ...blank, ...c, birthDate: c.birthDate ? c.birthDate.slice(0, 10) : "" });
    setTags((c.tags ?? []).join("، "));
    setFields({}); setDup(null);
  }, [open, client, defaultStatus]);

  const set = (k: keyof ClientInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true); setFields({}); setDup(null);
    const body = { ...f, id: undefined, tags: tags.split(/[,،;]/).map((t) => t.trim()).filter(Boolean), branchId: f.branchId || null, ownerId: f.ownerId || null, marketingOptOut: !!f.marketingOptOut,
      // only users who can see influencers may change the attribution
      influencerId: can("marketing.view") ? f.influencerId || null : undefined };
    try {
      const saved = await api<{ id: string }>(client?.id ? `/api/clients/${client.id}` : "/api/clients", { method: client?.id ? "PATCH" : "POST", body });
      toast("success", client?.id ? tr("تم حفظ التعديلات", "Changes saved") : tr("تمت إضافة العميل", "Client added"));
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE_CLIENT") setDup({ id: String(err.details?.clientId ?? ""), message: err.message });
      else {
        if (err instanceof ApiError && err.fields) setFields(err.fields);
        toast("error", err instanceof Error ? err.message : String(err));
      }
    } finally { setPending(false); }
  }

  return (
    <Modal open={open} onClose={onClose} wide title={client?.id ? tr("تعديل بيانات العميل", "Edit client") : f.status === "LEAD" ? tr("عميل محتمل جديد", "New lead") : tr("عميل جديد", "New client")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="client-form" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="client-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        {dup && (
          <div className="sm:col-span-3 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {tr("يوجد عميل مسجل بنفس رقم الهاتف.", "A client with this phone already exists.")}{" "}
            {dup.id && <Link className="font-medium underline" href={`/clients/${dup.id}`}>{tr("فتح الملف الموجود", "Open existing file")}</Link>}
          </div>
        )}
        <Field label={tr("الاسم الكامل", "Full name")} error={fields.fullName}><Input required value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label={tr("رقم الهاتف", "Phone")} error={fields.phone}><Input required dir="ltr" value={f.phone} onChange={set("phone")} placeholder="+964 770 000 0000" /></Field>
        <Field label={tr("البريد الإلكتروني", "Email")} error={fields.email}><Input type="email" dir="ltr" value={f.email ?? ""} onChange={set("email")} /></Field>
        <Field label={tr("الجنس", "Gender")}>
          <Select value={f.gender ?? ""} onChange={set("gender")}><option value="">—</option><option value="FEMALE">{tr("أنثى", "Female")}</option><option value="MALE">{tr("ذكر", "Male")}</option></Select>
        </Field>
        <Field label={tr("تاريخ الميلاد", "Date of birth")} error={fields.birthDate}><Input type="date" dir="ltr" value={f.birthDate ?? ""} onChange={set("birthDate")} /></Field>
        <Field label={tr("الحالة", "Status")}>
          <Select value={f.status} onChange={set("status")}>{Object.entries(CLIENT_STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select>
        </Field>
        <Field label={tr("مصدر العميل", "Source")}>
          <Select value={f.source ?? ""} onChange={set("source")}><option value="">—</option>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select>
        </Field>
        <Field label={tr("تفاصيل المصدر", "Source detail")} hint={tr("اسم المؤثر، الحملة، من أوصى…", "Influencer, campaign, referrer…")}><Input value={f.sourceDetail ?? ""} onChange={set("sourceDetail")} /></Field>
        {can("marketing.view") && <Field label={tr("جاء عن طريق مؤثر", "Referred by influencer")} hint={tr("تُحتسب للمؤثر عمولة على فواتيره", "The influencer earns commission on their invoices")}>
          <Select value={f.influencerId ?? ""} onChange={(e) => setF((x) => ({ ...x, influencerId: e.target.value, ...(e.target.value && !x.source ? { source: "influencer" } : {}) }))}><option value="">—</option>{(influencers.data ?? []).filter((i) => i.isActive || i.id === f.influencerId).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>
        </Field>}
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={!!f.marketingOptOut} onChange={(e) => setF((x) => ({ ...x, marketingOptOut: e.target.checked }))} />{tr("لا يرغب برسائل تسويقية", "No marketing messages")}</label>
        <Field label={tr("التصنيف", "Category")}>
          <Select value={f.category ?? ""} onChange={set("category")}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select>
        </Field>
        {branches.data && (
          <Field label={tr("الفرع", "Branch")}>
            <Select value={f.branchId ?? ""} onChange={set("branchId")}><option value="">{tr("افتراضي", "Default")}</option>{branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          </Field>
        )}
        {staff.data && (
          <Field label={tr("الموظف المسؤول", "Responsible staff")}>
            <Select value={f.ownerId ?? ""} onChange={set("ownerId")}><option value="">—</option>{staff.data.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select>
          </Field>
        )}
        <Field label={tr("الوسوم", "Tags")} hint={tr("افصل بفاصلة", "Comma separated")}><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="VIP، بشرة حساسة" /></Field>
        <Field label={tr("العنوان", "Address")} className="sm:col-span-3"><Input value={f.address ?? ""} onChange={set("address")} /></Field>
        <Field label={tr("ملاحظات", "Notes")} className="sm:col-span-3">
          <textarea value={f.notes ?? ""} onChange={set("notes")} rows={3} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40" />
        </Field>
        <p className="sm:col-span-3 text-xs text-muted">{locale === "ar" ? "يُمنع تكرار العملاء: يتم التحقق من رقم الهاتف تلقائياً." : "Duplicates are prevented: the phone number is checked automatically."}</p>
      </form>
    </Modal>
  );
}

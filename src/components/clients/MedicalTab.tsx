"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, Field, Input, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { MED_ENTRY, medEntryLabel } from "@/lib/labels2";

type Record_ = { bloodType: string | null; allergies: string | null; currentMedications: string | null; chronicConditions: string | null; pastSurgeries: string | null; medicalHistory: string | null; familyHistory: string | null; notes: string | null; updatedAt: string };
type Entry = { id: string; type: string; title: string; content: string; createdAt: string; author: { fullName: string } | null };

const FIELDS: [keyof Record_, string, string][] = [
  ["allergies", "الحساسية", "Allergies"], ["currentMedications", "الأدوية الحالية", "Current medications"],
  ["chronicConditions", "الحالات الصحية المزمنة", "Chronic conditions"], ["pastSurgeries", "العمليات السابقة", "Past surgeries"],
  ["medicalHistory", "التاريخ الطبي", "Medical history"], ["familyHistory", "التاريخ العائلي", "Family history"], ["notes", "ملاحظات طبية عامة", "General medical notes"],
];
const TONE: Record<string, "red" | "blue" | "brand" | "green"> = { DIAGNOSIS: "red", NOTE: "blue", TREATMENT_PLAN: "brand", FOLLOW_UP_RESULT: "green" };
const area = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-70";

export default function MedicalTab({ clientId }: { clientId: string }) {
  const { tr, locale, can } = useSession();
  const { data, loading, reload } = useResource<{ record: Record_ | null; entries: Entry[] }>(`/api/clients/${clientId}/medical`);
  const [r, setR] = useState<Partial<Record_>>({});
  const [editing, setEditing] = useState(false);
  const save = useSubmit();
  const add = useSubmit();
  const del = useSubmit();
  const [entry, setEntry] = useState({ type: "DIAGNOSIS", title: "", content: "" });
  const [filter, setFilter] = useState("");
  const [deleting, setDeleting] = useState<Entry | null>(null);
  useEffect(() => { if (data) setR(data.record ?? {}); }, [data]);
  if (loading && !data) return <div className="grid place-items-center py-16"><Spinner /></div>;
  const canEdit = can("medical.update");
  const alerts = [data?.record?.allergies && `${tr("حساسية", "Allergy")}: ${data.record.allergies}`, data?.record?.chronicConditions].filter(Boolean);

  return (
    <div className="space-y-4">
      {alerts.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <span className="font-semibold">⚠ {tr("تنبيه طبي:", "Medical alert:")}</span> {alerts.join(" · ")}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="h-fit p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium">{tr("الملف الطبي", "Medical profile")}</p>
            {canEdit && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{tr("تعديل", "Edit")}</Button>}
          </div>
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await save.run(() => api(`/api/clients/${clientId}/medical`, { method: "PUT", body: r }), tr("تم حفظ الملف الطبي", "Medical profile saved"))) { setEditing(false); reload(); }
          }}>
            <Field label={tr("فصيلة الدم", "Blood type")}>
              <Select disabled={!editing} value={r.bloodType ?? ""} onChange={(e) => setR({ ...r, bloodType: e.target.value })}>
                <option value="">—</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b}>{b}</option>)}
              </Select>
            </Field>
            {FIELDS.map(([k, ar, en]) => (
              <Field key={k} label={tr(ar, en)}>
                <textarea disabled={!editing} rows={2} className={area} value={(r[k] as string) ?? ""} onChange={(e) => setR({ ...r, [k]: e.target.value })} />
              </Field>
            ))}
            {editing && <div className="flex gap-2"><Button type="submit" loading={save.pending}>{tr("حفظ", "Save")}</Button><Button type="button" variant="secondary" onClick={() => { setEditing(false); setR(data?.record ?? {}); }}>{tr("إلغاء", "Cancel")}</Button></div>}
            {data?.record && <p className="text-xs text-muted">{tr("آخر تحديث:", "Last updated:")} {fmtDate(data.record.updatedAt, locale, true)}</p>}
          </form>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          {can("medical.create") && (
            <Card className="p-4">
              <p className="mb-3 font-medium">{tr("إضافة تشخيص / ملاحظة / خطة علاجية", "Add diagnosis / note / treatment plan")}</p>
              <form className="grid gap-3 sm:grid-cols-3" onSubmit={async (e) => {
                e.preventDefault();
                if (await add.run(() => api(`/api/clients/${clientId}/medical`, { body: entry }), tr("تمت الإضافة", "Added"))) { setEntry({ ...entry, title: "", content: "" }); reload(); }
              }}>
                <Select value={entry.type} onChange={(e) => setEntry({ ...entry, type: e.target.value })}>
                  {Object.entries(MED_ENTRY).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
                </Select>
                <Input className="sm:col-span-2" required placeholder={tr("العنوان", "Title")} value={entry.title} onChange={(e) => setEntry({ ...entry, title: e.target.value })} />
                <textarea required rows={3} className={`${area} sm:col-span-3`} placeholder={tr("التفاصيل…", "Details…")} value={entry.content} onChange={(e) => setEntry({ ...entry, content: e.target.value })} />
                <div className="sm:col-span-3"><Button type="submit" loading={add.pending}>{tr("إضافة للسجل", "Add to record")}</Button></div>
              </form>
            </Card>
          )}
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-medium">{tr("السجل الطبي الزمني", "Clinical timeline")}</p>
              <Select className="w-auto h-8 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">{tr("الكل", "All")}</option>{Object.entries(MED_ENTRY).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
              </Select>
            </div>
            <ul>
              {data?.entries.filter((x) => !filter || x.type === filter).map((x) => (
                <li key={x.id} className="border-t border-line px-4 py-3 text-sm first:border-t-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone={TONE[x.type]}>{medEntryLabel(x.type, locale)}</Badge><span className="font-medium">{x.title}</span></div>
                    {can("medical.delete") && <button className="text-xs text-muted hover:text-danger" onClick={() => setDeleting(x)}>{tr("حذف", "Delete")}</button>}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap">{x.content}</p>
                  <p className="mt-1 text-xs text-muted">{x.author?.fullName ?? "—"} · {fmtDate(x.createdAt, locale, true)}</p>
                </li>
              ))}
              {data?.entries.length === 0 && <li className="p-6 text-center text-sm text-muted">{tr("لا توجد تشخيصات أو ملاحظات بعد", "No clinical entries yet")}</li>}
            </ul>
          </Card>
        </div>
      </div>
      <p className="text-xs text-muted">🔒 {tr("البيانات الطبية محمية بصلاحية خاصة، وكل اطلاع عليها يُسجَّل في سجل العمليات.", "Medical data is protected by a dedicated permission; every access is recorded in the audit log.")}</p>
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} loading={del.pending} title={tr("حذف السجل", "Delete entry")}
        text={tr("لا يمكن التراجع عن حذف هذا السجل الطبي.", "This clinical entry will be permanently deleted.")} confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => { if (await del.run(() => api(`/api/medical-entries/${deleting!.id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) { setDeleting(null); reload(); } }} />
    </div>
  );
}

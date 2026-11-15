"use client";
import { useRef, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, EmptyState, Input, Select } from "@/components/ui";
import { api, upload } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { FILE_CAT, fileCatLabel } from "@/lib/labels2";

type FileRow = { id: string; category: string; originalName: string; mimeType: string; sizeBytes: number; note: string | null; createdAt: string };

export default function FilesTab({ clientId, onPhotoChanged }: { clientId: string; onPhotoChanged: () => void }) {
  const { tr, locale, can } = useSession();
  const medical = can("medical.view_data") && can("medical.view");
  const { data, reload } = useResource<FileRow[]>(`/api/clients/${clientId}/files`);
  const [category, setCategory] = useState(medical && can("medical.create") ? "MEDICAL_BEFORE" : "CLIENT_PHOTO");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [deleting, setDeleting] = useState<FileRow | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const up = useSubmit();
  const del = useSubmit();
  const allowedCats = Object.keys(FILE_CAT).filter((c) => (c === "CLIENT_PHOTO" ? can("clients.update") : medical && can("medical.create")));
  const list = data?.filter((f) => !filter || f.category === filter) ?? [];

  async function onUpload(file: File) {
    const fd = new FormData();
    fd.append("file", file); fd.append("category", category); if (note) fd.append("note", note);
    const ok = await up.run(() => upload(`/api/clients/${clientId}/files`, fd), tr("تم رفع الملف", "File uploaded"));
    if (input.current) input.current.value = "";
    if (ok) { setNote(""); reload(); if (category === "CLIENT_PHOTO") onPhotoChanged(); }
  }

  return (
    <div className="space-y-4">
      {allowedCats.length > 0 && (
        <Card className="flex flex-wrap items-center gap-2 p-4">
          <Select className="w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            {allowedCats.map((c) => <option key={c} value={c}>{fileCatLabel(c, locale)}</option>)}
          </Select>
          <Input className="min-w-0 flex-1" placeholder={tr("وصف (اختياري): الجلسة 3، الجهة اليسرى…", "Description (optional)")} value={note} onChange={(e) => setNote(e.target.value)} />
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          <Button loading={up.pending} onClick={() => input.current?.click()}>{tr("رفع ملف", "Upload")}</Button>
          <p className="w-full text-xs text-muted">{tr("JPG / PNG / WEBP / PDF حتى 10 ميغابايت. الملفات مخزنة بشكل خاص ولا تُعرض إلا لأصحاب الصلاحية.", "JPG/PNG/WEBP/PDF up to 10 MB. Files are stored privately and served only to authorised users.")}</p>
        </Card>
      )}
      {medical && (
        <div className="flex gap-1">
          {["", ...Object.keys(FILE_CAT)].map((c) => (
            <button key={c} onClick={() => setFilter(c)} className={`rounded-full px-3 py-1 text-xs ${filter === c ? "bg-brand text-white" : "bg-surface-2 text-muted"}`}>{c ? fileCatLabel(c, locale) : tr("الكل", "All")}</button>
          ))}
        </div>
      )}
      {list.length === 0 ? <Card><EmptyState title={tr("لا توجد ملفات", "No files")} /></Card> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((f) => (
            <Card key={f.id} className="overflow-hidden">
              <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="block aspect-square bg-surface-2">
                {f.mimeType.startsWith("image/")
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/files/${f.id}`} alt={f.originalName} loading="lazy" className="size-full object-cover" />
                  : <span className="grid size-full place-items-center text-3xl text-muted">PDF</span>}
              </a>
              <div className="space-y-1 p-2 text-xs">
                <div className="flex items-center justify-between gap-1"><Badge tone={f.category === "MEDICAL_AFTER" ? "green" : f.category === "MEDICAL_BEFORE" ? "amber" : "gray"}>{fileCatLabel(f.category, locale)}</Badge>
                  {(f.category === "CLIENT_PHOTO" ? can("clients.update") : can("medical.delete")) && <button className="text-muted hover:text-danger" onClick={() => setDeleting(f)}>{tr("حذف", "Delete")}</button>}
                </div>
                {f.note && <p className="truncate">{f.note}</p>}
                <p className="text-muted">{fmtDate(f.createdAt, locale)} · {(f.sizeBytes / 1024).toFixed(0)} KB</p>
              </div>
            </Card>
          ))}
        </div>
      )}
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} loading={del.pending} title={tr("حذف الملف", "Delete file")}
        text={tr("سيتم حذف الملف نهائياً من التخزين.", "The file will be permanently removed from storage.")} confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => { if (await del.run(() => api(`/api/files/${deleting!.id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) { setDeleting(null); reload(); onPhotoChanged(); } }} />
    </div>
  );
}

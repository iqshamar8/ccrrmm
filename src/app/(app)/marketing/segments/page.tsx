"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Card, ConfirmModal, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import SendMessage from "@/components/messaging/SendMessage";
import { AudienceBuilder, type Filter, filterSummary, MarketingTabs } from "@/components/marketing/shared";
import { api } from "@/lib/client";

type Seg = { id: string; name: string; description: string | null; filter: Filter; size: number; _count: { campaigns: number } };

export default function SegmentsPage() {
  const { tr, can } = useSession();
  const { data, loading, reload } = useResource<Seg[]>(can("marketing.view") ? "/api/marketing/segments" : null);
  const [edit, setEdit] = useState<Seg | "new" | null>(null);
  const [del, setDel] = useState<Seg | null>(null);
  const [send, setSend] = useState<string[] | null>(null);
  const { pending, run } = useSubmit();
  if (!can("marketing.view")) return <Forbidden />;
  const openSend = async (s: Seg) => {
    const r = await run(() => api<{ count: number; sample: { id: string }[] }>("/api/marketing/audience", { method: "POST", body: s.filter }));
    if (r) setSend(r.sample.map((x) => x.id));
  };
  return (
    <>
      <PageHeader title={tr("التسويق", "Marketing")} subtitle={tr("شرائح محفوظة من العملاء تُستخدم في الحملات وقوائم المتابعة، ويُعاد حسابها تلقائياً.", "Saved client segments for campaigns and follow-ups — always recalculated live.")}
        actions={can("marketing.create") && <Button onClick={() => setEdit("new")}>+ {tr("شريحة", "Segment")}</Button>} />
      <MarketingTabs active="segments" />
      <Card>
        <Table head={[tr("الشريحة", "Segment"), tr("المعايير", "Rules"), tr("الحجم الآن", "Size now"), tr("حملات", "Campaigns"), ""]}>
          {loading && !data ? <LoadingRows cols={5} /> : (data ?? []).map((s) => (
            <Tr key={s.id} onClick={can("marketing.update") ? () => setEdit(s) : undefined}>
              <Td className="font-medium">{s.name}{s.description && <div className="text-xs text-muted">{s.description}</div>}</Td>
              <Td className="text-xs text-muted">{filterSummary(s.filter, tr)}</Td>
              <Td className="tabular font-semibold">{s.size}</Td>
              <Td className="tabular">{s._count.campaigns}</Td>
              <Td><div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {can("notifications.create") && s.size > 0 && s.size <= 15 && <Button size="sm" variant="secondary" loading={pending} onClick={() => openSend(s)}>{tr("مراسلة", "Message")}</Button>}
                {can("marketing.delete") && <Button size="sm" variant="ghost" onClick={() => setDel(s)}>{tr("حذف", "Delete")}</Button>}
              </div></Td>
            </Tr>
          ))}
        </Table>
        {!loading && !data?.length && <EmptyState title={tr("لا توجد شرائح", "No segments")} />}
        <p className="px-4 py-2 text-xs text-muted">{tr("للشرائح الكبيرة أنشئ حملة لتتبع النتائج.", "For larger segments, create a campaign to track results.")}</p>
      </Card>
      <SegmentModal s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      <ConfirmModal open={!!del} onClose={() => setDel(null)} loading={pending} title={tr("حذف الشريحة؟", "Delete segment?")} text={tr("الحملات السابقة تحتفظ بجمهورها.", "Past campaigns keep their audience.")} confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => { if (await run(() => api(`/api/marketing/segments/${del!.id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) { setDel(null); reload(); } }} />
      {send && <SendMessage open clientIds={send} onClose={() => setSend(null)} defaultCategory="PROMOTION" />}
    </>
  );
}

function SegmentModal({ s, onClose, onSaved }: { s: Seg | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const [f, setF] = useState({ name: "", description: "", filter: { statuses: ["ACTIVE"] } as Filter });
  const [for_, setFor] = useState<string | null>(null);
  const key = s === "new" ? "new" : s?.id ?? null;
  if (key !== for_) { setFor(key); setF(s && s !== "new" ? { name: s.name, description: s.description ?? "", filter: s.filter } : { name: "", description: "", filter: { statuses: ["ACTIVE"] } }); }
  const { pending, fields, run } = useSubmit();
  const isNew = s === "new";
  return (
    <Modal open={!!s} onClose={onClose} wide title={isNew ? tr("شريحة جديدة", "New segment") : tr("تعديل الشريحة", "Edit segment")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="seg" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="seg" className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(isNew ? "/api/marketing/segments" : `/api/marketing/segments/${(s as Seg).id}`, { method: isNew ? "POST" : "PATCH", body: f }), tr("تم الحفظ", "Saved"))) onSaved(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("الاسم", "Name")} error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={tr("الوصف", "Description")}><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <AudienceBuilder value={f.filter} onChange={(v) => setF({ ...f, filter: v })} />
      </form>
    </Modal>
  );
}

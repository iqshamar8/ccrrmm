"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, EmptyState, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { InventoryTabs, useWarehouses } from "@/components/inventory/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Count = { id: string; code: string; status: "DRAFT" | "POSTED"; notes: string | null; createdAt: string; postedAt: string | null; warehouse?: string; _count: { lines: number } };
type Full = Omit<Count, "_count"> & { lines: { id: string; itemId: string; expectedQty: string; countedQty: string | null; item?: { name: string; unit: string; sku: string | null; cost: string } }[] };

export default function StockCountsPage() {
  const { tr, can, locale } = useSession();
  const { data, loading, reload } = useResource<Count[]>(can("inventory.view") ? "/api/inventory/counts" : null);
  const whs = useWarehouses();
  const [wh, setWh] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { pending, run } = useSubmit();
  if (!can("inventory.view")) return <Forbidden />;
  return (
    <>
      <PageHeader title={tr("المخازن", "Inventory")} subtitle={tr("الجرد: يُلتقط الرصيد الدفتري، تُدخل الكميات الفعلية، ثم تُرحّل الفروقات كتسوية مع قيدها.", "Stock count: snapshot the book quantity, enter what's on the shelf, then post the differences as an adjustment.")} />
      <InventoryTabs active="counts" />
      {can("inventory.create") && (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
          <Select className="max-w-xs" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">{tr("اختر المخزن", "Choose warehouse")}</option>{(whs.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
          <Button disabled={!wh} loading={pending} onClick={async () => { const c = await run(() => api<{ id: string }>("/api/inventory/counts", { method: "POST", body: { warehouseId: wh } }), tr("بدأ الجرد", "Count started")); if (c) { reload(); setOpen(c.id); } }}>{tr("بدء جرد جديد", "Start a count")}</Button>
        </Card>
      )}
      <Card>
        <Table head={[tr("الرقم", "No."), tr("المخزن", "Warehouse"), tr("بدأ", "Started"), tr("الأصناف", "Items"), tr("الحالة", "Status")]}>
          {loading && !data ? <LoadingRows cols={5} /> : (data ?? []).map((c) => (
            <Tr key={c.id} onClick={() => setOpen(c.id)}>
              <Td><span dir="ltr" className="font-mono text-xs">{c.code}</span></Td><Td>{c.warehouse}</Td><Td className="text-muted">{fmtDate(c.createdAt, locale)}</Td><Td className="tabular">{c._count.lines}</Td>
              <Td><Badge tone={c.status === "DRAFT" ? "amber" : "green"}>{c.status === "DRAFT" ? tr("مفتوح", "Open") : `${tr("مرحّل", "Posted")} ${fmtDate(c.postedAt, locale)}`}</Badge></Td>
            </Tr>
          ))}
        </Table>
        {!loading && !data?.length && <EmptyState title={tr("لا توجد عمليات جرد", "No counts yet")} />}
      </Card>
      <CountModal id={open} onClose={() => setOpen(null)} onChanged={reload} />
    </>
  );
}

function CountModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { tr, can } = useSession();
  const money = useMoney();
  const { data, reload } = useResource<Full>(id ? `/api/inventory/counts/${id}` : null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const { pending, run } = useSubmit();
  const open = data?.status === "DRAFT";
  const val = (l: Full["lines"][number]) => vals[l.id] ?? (l.countedQty === null ? "" : String(Number(l.countedQty)));
  const save = () => run(() => api(`/api/inventory/counts/${id}`, { method: "PATCH", body: Object.entries(vals).map(([lineId, v]) => ({ lineId, countedQty: v === "" ? null : Number(v) })) }), tr("تم الحفظ", "Saved"));
  const diffValue = (data?.lines ?? []).reduce((s, l) => { const v = val(l); return v === "" ? s : s + (Number(v) - Number(l.expectedQty)) * Number(l.item?.cost ?? 0); }, 0);
  return (
    <Modal open={!!id} onClose={() => { setVals({}); onClose(); }} wide title={data ? `${tr("جرد", "Count")} ${data.code}` : "…"}
      footer={open && <>
        {can("inventory.update") && <Button variant="secondary" loading={pending} onClick={async () => { if (await save()) { setVals({}); reload(); } }}>{tr("حفظ الكميات", "Save quantities")}</Button>}
        {can("inventory.approve") && <Button loading={pending} onClick={() => setConfirm(true)}>{tr("ترحيل الفروقات", "Post differences")}</Button>}
      </>}>
      {!data ? <LoadingRows cols={4} /> : <>
        <p className="mb-2 text-sm text-muted">{tr("فرق القيمة التقديري:", "Estimated value difference:")} <span className={`tabular font-medium ${diffValue < 0 ? "text-danger" : ""}`}>{money(diffValue)}</span></p>
        <Table head={[tr("الصنف", "Item"), tr("الدفتري", "Book qty"), tr("الفعلي", "Counted"), tr("الفرق", "Difference")]}>
          {data.lines.map((l) => {
            const v = val(l);
            const d = v === "" ? null : Number(v) - Number(l.expectedQty);
            return (
              <Tr key={l.id}>
                <Td className="font-medium">{l.item?.name}<span className="ms-1 text-xs text-muted">{l.item?.unit}</span></Td>
                <Td className="tabular">{Number(l.expectedQty)}</Td>
                <Td>{open ? <Input type="number" min={0} step="any" dir="ltr" className="max-w-[8rem]" value={v} onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })} /> : (v || "—")}</Td>
                <Td className={`tabular ${d && d < 0 ? "text-danger" : d ? "text-success" : "text-muted"}`} dir="ltr">{d === null ? "—" : d > 0 ? `+${d}` : d}</Td>
              </Tr>
            );
          })}
        </Table>
      </>}
      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} loading={pending} confirmLabel={tr("ترحيل", "Post")} cancelLabel={tr("إلغاء", "Cancel")} title={tr("ترحيل الجرد؟", "Post the count?")}
        text={tr("ستُعدّل أرصدة المخزن للأصناف المعدودة فقط ويُرحّل قيد الفروقات. لا يمكن التراجع.", "Only counted items are adjusted and the difference is posted to the ledger. This can't be undone.")}
        onConfirm={async () => { if (Object.keys(vals).length && !(await save())) return; if (await run(() => api(`/api/inventory/counts/${id}/post`, { method: "POST" }), tr("تم ترحيل الجرد", "Count posted"))) { setConfirm(false); setVals({}); reload(); onChanged(); } }} />
    </Modal>
  );
}

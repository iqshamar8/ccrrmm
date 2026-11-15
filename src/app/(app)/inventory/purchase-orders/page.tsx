"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { InventoryTabs, LineEditor, type Line, type Supplier, toLines, useItems, useWarehouses } from "@/components/inventory/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type PO = { id: string; code: string; status: string; supplierId: string; warehouseId: string; expectedDate: string | null; notes: string | null; total: string; createdAt: string; supplier?: string; warehouse?: string;
  lines: { id: string; itemId: string; quantity: string; receivedQty: string; unitCost: string; item?: { name: string; unit: string } }[] };
const STATUS: Record<string, [string, string, "gray" | "blue" | "amber" | "green" | "red"]> = {
  DRAFT: ["مسودة", "Draft", "gray"], ORDERED: ["مُرسل للمورد", "Ordered", "blue"], PARTIAL: ["استلام جزئي", "Partly received", "amber"], RECEIVED: ["مستلم", "Received", "green"], CANCELLED: ["ملغي", "Cancelled", "red"],
};

export default function PurchaseOrdersPage() {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<PO[]>(can("inventory.view") ? "/api/inventory/purchase-orders" : null);
  const [edit, setEdit] = useState<PO | "new" | null>(null);
  const [recv, setRecv] = useState<PO | null>(null);
  const { pending, run } = useSubmit();
  if (!can("inventory.view")) return <Forbidden />;
  const act = async (po: PO, action: "ORDER" | "CANCEL") => { if (await run(() => api(`/api/inventory/purchase-orders/${po.id}/status`, { method: "POST", body: { action } }), tr("تم", "Done"))) reload(); };
  return (
    <>
      <PageHeader title={tr("المخازن", "Inventory")} subtitle={tr("أوامر الشراء: مسودة ← إرسال ← استلام كامل أو جزئي (يُنشئ مستند استلام على حساب المورد).", "Purchase orders: draft → send → receive fully or in part (creates a receipt on the supplier's account).")}
        actions={can("inventory.create") && <Button onClick={() => setEdit("new")}>+ {tr("أمر شراء", "Purchase order")}</Button>} />
      <InventoryTabs active="po" />
      <Card>
        <Table head={[tr("الرقم", "No."), tr("المورد", "Supplier"), tr("المخزن", "Warehouse"), tr("التاريخ المتوقع", "Expected"), tr("الأصناف", "Items"), tr("الإجمالي", "Total"), tr("الحالة", "Status"), ""]}>
          {loading && !data ? <LoadingRows cols={8} /> : (data ?? []).map((p) => {
            const s = STATUS[p.status];
            const progress = p.lines.reduce((a, l) => a + Number(l.receivedQty), 0) / Math.max(1, p.lines.reduce((a, l) => a + Number(l.quantity), 0));
            return (
              <Tr key={p.id}>
                <Td><span dir="ltr" className="font-mono text-xs">{p.code}</span></Td><Td className="font-medium">{p.supplier}</Td><Td className="text-muted">{p.warehouse}</Td>
                <Td className="text-muted">{p.expectedDate ? fmtDate(p.expectedDate, locale) : "—"}</Td>
                <Td className="text-xs text-muted">{p.lines.map((l) => `${l.item?.name} ×${Number(l.quantity)}`).join("، ")}</Td>
                <Td className="tabular">{money(p.total)}</Td>
                <Td><Badge tone={s[2]}>{tr(s[0], s[1])}{p.status === "PARTIAL" ? ` ${Math.round(progress * 100)}%` : ""}</Badge></Td>
                <Td><div className="flex gap-1">
                  {p.status === "DRAFT" && can("inventory.update") && <Button size="sm" variant="secondary" onClick={() => setEdit(p)}>{tr("تعديل", "Edit")}</Button>}
                  {p.status === "DRAFT" && can("inventory.update") && <Button size="sm" loading={pending} onClick={() => act(p, "ORDER")}>{tr("إرسال", "Send")}</Button>}
                  {["ORDERED", "PARTIAL"].includes(p.status) && can("inventory.create") && <Button size="sm" onClick={() => setRecv(p)}>{tr("استلام", "Receive")}</Button>}
                  {["DRAFT", "ORDERED"].includes(p.status) && can("inventory.update") && <Button size="sm" variant="ghost" onClick={() => act(p, "CANCEL")}>{tr("إلغاء", "Cancel")}</Button>}
                </div></Td>
              </Tr>
            );
          })}
        </Table>
        {!loading && !data?.length && <EmptyState title={tr("لا توجد أوامر شراء", "No purchase orders")} />}
      </Card>
      <POModal po={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      <ReceiveModal po={recv} onClose={() => setRecv(null)} onDone={() => { setRecv(null); reload(); }} />
    </>
  );
}

function POModal({ po, onClose, onSaved }: { po: PO | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const items = useItems(); const whs = useWarehouses();
  const sups = useResource<Supplier[]>(po ? "/api/inventory/suppliers" : null);
  const isNew = po === "new";
  const [f, setF] = useState({ supplierId: "", warehouseId: "", expectedDate: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: "1", unitCost: "" }]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = po === "new" ? "new" : po?.id ?? null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (po && po !== "new") {
      setF({ supplierId: po.supplierId, warehouseId: po.warehouseId, expectedDate: po.expectedDate?.slice(0, 10) ?? "", notes: po.notes ?? "" });
      setLines(po.lines.map((l) => ({ itemId: l.itemId, quantity: String(Number(l.quantity)), unitCost: String(Number(l.unitCost)) })));
    } else if (po === "new") { setF({ supplierId: "", warehouseId: "", expectedDate: "", notes: "" }); setLines([{ itemId: "", quantity: "1", unitCost: "" }]); }
  }
  const { pending, run } = useSubmit();
  return (
    <Modal open={!!po} onClose={onClose} wide title={isNew ? tr("أمر شراء جديد", "New purchase order") : tr("تعديل أمر الشراء", "Edit purchase order")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="po" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="po" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f, expectedDate: f.expectedDate || null, lines: toLines(lines).map((l, i) => ({ ...l, unitCost: Number(lines.filter((x) => x.itemId)[i].unitCost || 0) })) };
        if (await run(() => api(isNew ? "/api/inventory/purchase-orders" : `/api/inventory/purchase-orders/${(po as PO).id}`, { method: isNew ? "POST" : "PATCH", body }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("المورد", "Supplier")}><Select required value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{(sups.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label={tr("مخزن الاستلام", "Receive into")}><Select required value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">—</option>{(whs.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          <Field label={tr("التاريخ المتوقع", "Expected date")}><Input type="date" dir="ltr" value={f.expectedDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} /></Field>
          <Field label={tr("ملاحظات", "Notes")}><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <POLines lines={lines} setLines={setLines} items={items} />
      </form>
    </Modal>
  );
}

function POLines({ lines, setLines, items }: { lines: Line[]; setLines: (l: Line[]) => void; items: ReturnType<typeof useItems> }) {
  const { tr } = useSession();
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="grid items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[3fr_1fr_1fr_auto]">
          <label className="text-xs text-muted">{tr("الصنف", "Item")}<Select required value={l.itemId} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); set(i, { itemId: e.target.value, unitCost: it ? String(Number(it.cost)) : "" }); }}><option value="">—</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
          <label className="text-xs text-muted">{tr("الكمية", "Qty")}<Input type="number" min={0} step="any" dir="ltr" required value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></label>
          <label className="text-xs text-muted">{tr("السعر", "Unit cost")}<Input type="number" min={0} step="any" dir="ltr" required value={l.unitCost ?? ""} onChange={(e) => set(i, { unitCost: e.target.value })} /></label>
          <Button type="button" size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" onClick={() => setLines([...lines, { itemId: "", quantity: "1", unitCost: "" }])}>+ {tr("سطر", "Line")}</Button>
    </div>
  );
}

function ReceiveModal({ po, onClose, onDone }: { po: PO | null; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const items = useItems();
  const [rows, setRows] = useState<Record<string, { quantity: string; lotNo: string; expiryDate: string }>>({});
  const [ref, setRef] = useState("");
  const { pending, run } = useSubmit();
  const get = (id: string, left: number) => rows[id] ?? { quantity: String(left), lotNo: "", expiryDate: "" };
  return (
    <Modal open={!!po} onClose={onClose} wide title={po ? `${tr("استلام", "Receive")} ${po.code}` : ""}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="porcv" type="submit" loading={pending}>{tr("ترحيل الاستلام", "Post receipt")}</Button></>}>
      {po && <form id="porcv" className="space-y-2" onSubmit={async (e) => {
        e.preventDefault();
        const lines = po.lines.map((l) => { const left = Number(l.quantity) - Number(l.receivedQty); const r = get(l.id, left); return { lineId: l.id, quantity: Number(r.quantity || 0), lotNo: r.lotNo || null, expiryDate: r.expiryDate || null }; });
        if (await run(() => api(`/api/inventory/purchase-orders/${po.id}/receive`, { method: "POST", body: { reference: ref || null, lines } }), tr("تم الاستلام", "Received"))) { setRows({}); onDone(); }
      }}>
        <Field label={tr("رقم فاتورة المورد", "Supplier invoice no.")}><Input dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        {po.lines.map((l) => {
          const left = Number(l.quantity) - Number(l.receivedQty);
          const r = get(l.id, left);
          const exp = items.find((i) => i.id === l.itemId)?.expiryTracking;
          return (
            <div key={l.id} className="grid items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[2fr_1fr_1fr_1.2fr]">
              <div className="text-sm"><div className="font-medium">{l.item?.name}</div><div className="text-xs text-muted">{tr("المتبقي", "Remaining")}: {left} / {Number(l.quantity)}</div></div>
              <label className="text-xs text-muted">{tr("المستلم الآن", "Receive now")}<Input type="number" min={0} max={left} step="any" dir="ltr" value={r.quantity} onChange={(e) => setRows({ ...rows, [l.id]: { ...r, quantity: e.target.value } })} /></label>
              <label className="text-xs text-muted">{tr("التشغيلة", "Lot")}<Input dir="ltr" value={r.lotNo} onChange={(e) => setRows({ ...rows, [l.id]: { ...r, lotNo: e.target.value } })} /></label>
              <label className="text-xs text-muted">{tr("الانتهاء", "Expiry")}{exp ? " *" : ""}<Input type="date" dir="ltr" required={exp && Number(r.quantity) > 0} value={r.expiryDate} onChange={(e) => setRows({ ...rows, [l.id]: { ...r, expiryDate: e.target.value } })} /></label>
            </div>
          );
        })}
      </form>}
    </Modal>
  );
}

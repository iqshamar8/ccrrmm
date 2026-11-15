"use client";
import { useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Card, EmptyState, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { DOC_TYPES, InventoryTabs, useWarehouses } from "@/components/inventory/shared";
import { fmtDate } from "@/lib/i18n";

type Doc = { id: string; code: string; type: string; date: string; totalCost: string; reference: string | null; notes: string | null; warehouse?: string; toWarehouse: string | null; supplier: string | null; _count: { movements: number } };
type Full = Doc & { journal: { code: string } | null; movements: { id: string; quantity: string; unitCost: string; totalCost: string; warehouse?: string; item?: { name: string; unit: string } }[] };

export default function StockDocumentsPage() {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const [type, setType] = useState(""); const [wh, setWh] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const { data, loading } = useResource<Doc[]>(can("inventory.view") ? `/api/inventory/documents?type=${type}&warehouseId=${wh}&from=${from}&to=${to}` : null);
  const whs = useWarehouses();
  const [open, setOpen] = useState<string | null>(null);
  if (!can("inventory.view")) return <Forbidden />;
  return (
    <>
      <PageHeader title={tr("المخازن", "Inventory")} subtitle={tr("كل حركة مخزنية مستند مرقّم مرتبط بقيده المحاسبي.", "Every stock movement is a numbered document linked to its journal entry.")} />
      <InventoryTabs active="docs" />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select className="max-w-[12rem]" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{tr("كل الأنواع", "All types")}</option>
            {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{tr(v[0], v[1])}</option>)}
          </Select>
          <Select className="max-w-xs" value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">{tr("كل المخازن", "All warehouses")}</option>
            {(whs.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Input type="date" dir="ltr" className="max-w-[10rem]" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" dir="ltr" className="max-w-[10rem]" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Table head={[tr("الرقم", "No."), tr("النوع", "Type"), tr("التاريخ", "Date"), tr("المخزن", "Warehouse"), tr("المورد / ملاحظات", "Supplier / notes"), tr("الأسطر", "Lines"), tr("القيمة", "Value")]}>
          {loading && !data ? <LoadingRows cols={7} /> : (data ?? []).map((d) => {
            const t = DOC_TYPES[d.type];
            return (
              <Tr key={d.id} onClick={() => setOpen(d.id)}>
                <Td><span dir="ltr" className="font-mono text-xs">{d.code}</span></Td><Td><Badge tone={t[2]}>{tr(t[0], t[1])}</Badge></Td>
                <Td className="text-muted">{fmtDate(d.date, locale)}</Td><Td>{d.warehouse}{d.toWarehouse ? ` ← ${d.toWarehouse}` : ""}</Td>
                <Td className="text-muted">{d.supplier ?? d.notes ?? "—"}{d.reference ? ` · ${d.reference}` : ""}</Td><Td className="tabular">{d._count.movements}</Td>
                <Td className="tabular">{money(d.totalCost)}</Td>
              </Tr>
            );
          })}
        </Table>
        {!loading && !data?.length && <EmptyState title={tr("لا توجد مستندات", "No documents")} />}
      </Card>
      <DocModal id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function DocModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { tr, locale } = useSession();
  const money = useMoney();
  const { data } = useResource<Full>(id ? `/api/inventory/documents/${id}` : null);
  const t = data ? DOC_TYPES[data.type] : null;
  return (
    <Modal open={!!id} onClose={onClose} wide title={data ? `${data.code}` : "…"}>
      {!data || !t ? <LoadingRows cols={3} /> : <div className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <Badge tone={t[2]}>{tr(t[0], t[1])}</Badge><span className="text-muted">{fmtDate(data.date, locale)}</span>
          {data.journal && <span className="text-muted">{tr("القيد:", "Journal:")} <span dir="ltr" className="font-mono">{data.journal.code}</span></span>}
          {data.notes && <span>{data.notes}</span>}
        </div>
        <Table head={[tr("الصنف", "Item"), tr("المخزن", "Warehouse"), tr("الكمية", "Qty"), tr("تكلفة الوحدة", "Unit cost"), tr("القيمة", "Value")]}>
          {data.movements.map((m) => <Tr key={m.id}><Td className="font-medium">{m.item?.name}</Td><Td>{m.warehouse}</Td>
            <Td className={`tabular ${Number(m.quantity) < 0 ? "text-danger" : "text-success"}`} dir="ltr">{Number(m.quantity) > 0 ? "+" : ""}{Number(m.quantity)} {m.item?.unit}</Td>
            <Td className="tabular">{money(m.unitCost)}</Td><Td className="tabular">{money(m.totalCost)}</Td></Tr>)}
        </Table>
      </div>}
    </Modal>
  );
}

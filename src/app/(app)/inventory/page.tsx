"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, LoadingRows, Modal, PageHeader, Select, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { DOC_TYPES, InventoryTabs, LineEditor, type Line, type Supplier, toLines, useItems, useWarehouses } from "@/components/inventory/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Row = { id: string; name: string; sku: string | null; unit: string; group: string | null; isSellable: boolean; isConsumable: boolean; minStock: string; quantity: string; value: string; avgCost: string; nextExpiry: string | null; low: boolean; expired: boolean; byWarehouse: { warehouseId: string; name: string; quantity: string }[] };
type Overview = { warehouses: { id: string; name: string }[]; rows: Row[]; totalValue: string };
type Alerts = { low: { id: string; name: string; unit: string; minStock: string; quantity: string }[]; expiring: { id: string; lotNo: string | null; expiryDate: string; quantity: string; expired: boolean; value: string; item?: { name: string; unit: string }; warehouse?: { name: string } }[] };
const qn = (v: string | number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function InventoryPage() {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const [wh, setWh] = useState(""); const [q, setQ] = useState(""); const [low, setLow] = useState(false);
  const url = can("inventory.view") ? `/api/inventory/stock?warehouseId=${wh}&q=${encodeURIComponent(q)}${low ? "&low=1" : ""}` : null;
  const { data, loading, reload } = useResource<Overview>(url);
  const alerts = useResource<Alerts>(can("inventory.view") ? "/api/inventory/alerts" : null);
  const whs = useWarehouses();
  const [modal, setModal] = useState<"receive" | "issue" | "transfer" | null>(null);
  const [card, setCard] = useState<string | null>(null);
  if (!can("inventory.view")) return <Forbidden />;
  const done = () => { setModal(null); reload(); alerts.reload(); whs.reload(); };
  const expired = alerts.data?.expiring.filter((e) => e.expired) ?? [];
  return (
    <>
      <PageHeader title={tr("المخازن", "Inventory")} subtitle={tr("أرصدة المواد والمنتجات حسب المخزن، بالتشغيلات وتواريخ الانتهاء. التكلفة تُحسب بالوارد أولاً حسب أقرب انتهاء.", "Stock per warehouse with lots and expiry. Costed first-expiry-first-out.")}
        actions={can("inventory.create") && <div className="flex flex-wrap gap-2">
          <Button onClick={() => setModal("receive")}>+ {tr("استلام", "Receive")}</Button>
          <Button variant="secondary" onClick={() => setModal("transfer")}>{tr("نقل", "Transfer")}</Button>
          <Button variant="secondary" onClick={() => setModal("issue")}>{tr("صرف / إتلاف", "Issue / waste")}</Button>
        </div>} />
      <InventoryTabs active="stock" />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={tr("قيمة المخزون", "Stock value")} value={money(data?.totalValue ?? 0)} />
        <StatCard label={tr("الأصناف", "Items")} value={data?.rows.length ?? "—"} />
        <StatCard label={tr("تحت الحد الأدنى", "Below minimum")} value={<span className={alerts.data?.low.length ? "text-danger" : ""}>{alerts.data?.low.length ?? "—"}</span>} />
        <StatCard label={tr("تنتهي خلال 30 يوماً", "Expiring in 30 days")} value={<span className={expired.length ? "text-danger" : ""}>{alerts.data?.expiring.length ?? "—"}</span>} hint={expired.length ? tr(`${expired.length} منتهية`, `${expired.length} expired`) : undefined} />
      </div>
      {!!alerts.data?.expiring.length && (
        <Card className="mb-4">
          <div className="border-b border-line px-4 py-2 text-sm font-medium">{tr("تشغيلات منتهية أو قريبة الانتهاء", "Expired / expiring lots")}</div>
          <Table head={[tr("الصنف", "Item"), tr("المخزن", "Warehouse"), tr("التشغيلة", "Lot"), tr("الانتهاء", "Expiry"), tr("الكمية", "Qty"), tr("القيمة", "Value")]}>
            {alerts.data.expiring.slice(0, 8).map((e) => (
              <Tr key={e.id}><Td className="font-medium">{e.item?.name}</Td><Td className="text-muted">{e.warehouse?.name}</Td><Td dir="ltr">{e.lotNo ?? "—"}</Td>
                <Td><Badge tone={e.expired ? "red" : "amber"}>{fmtDate(e.expiryDate, locale)}</Badge></Td><Td className="tabular">{qn(e.quantity)} {e.item?.unit}</Td><Td className="tabular">{money(e.value)}</Td></Tr>
            ))}
          </Table>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder={tr("بحث بالاسم أو الرمز…", "Search name or SKU…")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="max-w-xs" value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">{tr("كل المخازن", "All warehouses")}</option>
            {(whs.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name} — {w.branch.name}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} />{tr("تحت الحد الأدنى فقط", "Below minimum only")}</label>
        </div>
        <Table head={[tr("الصنف", "Item"), tr("المجموعة", "Group"), tr("الرصيد", "On hand"), tr("الحد الأدنى", "Min"), tr("متوسط التكلفة", "Avg cost"), tr("القيمة", "Value"), tr("أقرب انتهاء", "Next expiry"), tr("التوزيع", "By warehouse")]}>
          {loading && !data ? <LoadingRows cols={8} /> : (data?.rows ?? []).map((r) => (
            <Tr key={r.id} onClick={() => setCard(r.id)}>
              <Td className="font-medium">{r.name}<div className="text-xs text-muted">{r.isConsumable ? tr("مادة مستهلكة", "Consumable") : tr("منتج للبيع", "Retail")}{r.sku ? ` · ${r.sku}` : ""}</div></Td>
              <Td className="text-muted">{r.group ?? "—"}</Td>
              <Td className="tabular">{r.low ? <Badge tone="red">{qn(r.quantity)} {r.unit}</Badge> : <>{qn(r.quantity)} <span className="text-muted">{r.unit}</span></>}</Td>
              <Td className="tabular text-muted">{qn(r.minStock)}</Td>
              <Td className="tabular">{money(r.avgCost)}</Td><Td className="tabular">{money(r.value)}</Td>
              <Td>{r.nextExpiry ? <Badge tone={r.expired ? "red" : "gray"}>{fmtDate(r.nextExpiry, locale)}</Badge> : "—"}</Td>
              <Td className="text-xs text-muted">{r.byWarehouse.filter((w) => Number(w.quantity)).map((w) => `${w.name}: ${qn(w.quantity)}`).join(" · ") || "—"}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && !data?.rows.length && <EmptyState title={tr("لا توجد أصناف مخزنية", "No stock items")} text={tr("فعّل «تتبع المخزون» للمنتج أو المادة من صفحة المنتجات.", "Turn on “Track stock” for a product or material on the Products page.")} />}
      </Card>
      <ReceiveModal open={modal === "receive"} onClose={() => setModal(null)} onDone={done} />
      <IssueModal open={modal === "issue"} onClose={() => setModal(null)} onDone={done} />
      <TransferModal open={modal === "transfer"} onClose={() => setModal(null)} onDone={done} />
      <ItemCard id={card} onClose={() => setCard(null)} />
    </>
  );
}

function ReceiveModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { tr, can } = useSession();
  const items = useItems();
  const whs = useWarehouses();
  const sups = useResource<Supplier[]>(open ? "/api/inventory/suppliers" : null);
  const cash = useResource<{ id: string; name: string; kind: string }[]>(open && (can("accounting.view") || can("invoices.view")) ? "/api/accounting/cash-accounts" : null);
  const [f, setF] = useState({ warehouseId: "", supplierId: "", cashAccountId: "", reference: "", date: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: "1", unitCost: "" }]);
  const { pending, run } = useSubmit();
  return (
    <Modal open={open} onClose={onClose} wide title={tr("استلام مواد / منتجات", "Receive stock")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="rcv" type="submit" loading={pending}>{tr("ترحيل الاستلام", "Post receipt")}</Button></>}>
      <form id="rcv" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f, date: f.date || undefined, supplierId: f.supplierId || null, cashAccountId: f.cashAccountId || null, lines: toLines(lines, true) };
        if (await run(() => api("/api/inventory/receipts", { method: "POST", body }), tr("تم الاستلام وترحيل القيد", "Received and posted"))) { setLines([{ itemId: "", quantity: "1", unitCost: "" }]); onDone(); }
      }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={tr("المخزن", "Warehouse")}><Select required value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">—</option>{(whs.data ?? []).filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          <Field label={tr("المورد (على الحساب)", "Supplier (on credit)")}><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{(sups.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label={tr("أو دُفع نقداً من", "Or paid now from")}><Select value={f.cashAccountId} onChange={(e) => setF({ ...f, cashAccountId: e.target.value })}><option value="">{tr("— على حساب المورد —", "— supplier credit —")}</option>{(cash.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label={tr("رقم فاتورة المورد", "Supplier invoice no.")}><Input dir="ltr" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label={tr("التاريخ", "Date")}><Input type="date" dir="ltr" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label={tr("ملاحظات", "Notes")}><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <LineEditor lines={lines} onChange={setLines} items={items} withCost />
        <p className="text-xs text-muted">{tr("يُرحَّل تلقائياً: مدين المخزون / دائن المورد أو الصندوق.", "Posts automatically: Dr Inventory / Cr Supplier or cash box.")}</p>
      </form>
    </Modal>
  );
}

function IssueModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const items = useItems(); const whs = useWarehouses();
  const [f, setF] = useState({ type: "ISSUE", warehouseId: "", notes: "", date: "" });
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: "1" }]);
  const { pending, run } = useSubmit();
  return (
    <Modal open={open} onClose={onClose} title={tr("صرف أو إتلاف مواد", "Issue or write off stock")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="iss" type="submit" variant={f.type === "WASTE" ? "danger" : "primary"} loading={pending}>{tr("ترحيل", "Post")}</Button></>}>
      <form id="iss" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api("/api/inventory/issues", { method: "POST", body: { ...f, date: f.date || undefined, lines: toLines(lines) } }), tr("تم الترحيل", "Posted"))) { setLines([{ itemId: "", quantity: "1" }]); onDone(); }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("النوع", "Type")}><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="ISSUE">{tr("صرف للاستخدام الداخلي", "Issue for internal use")}</option><option value="WASTE">{tr("إتلاف / تالف / منتهي", "Waste / damaged / expired")}</option></Select></Field>
          <Field label={tr("المخزن", "Warehouse")}><Select required value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">—</option>{(whs.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          <Field label={tr("السبب", "Reason")} className="sm:col-span-2"><Input required minLength={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <LineEditor lines={lines} onChange={setLines} items={items} />
      </form>
    </Modal>
  );
}

function TransferModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const items = useItems(); const whs = useWarehouses();
  const [f, setF] = useState({ fromWarehouseId: "", toWarehouseId: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: "1" }]);
  const { pending, fields, run } = useSubmit();
  return (
    <Modal open={open} onClose={onClose} title={tr("نقل بين المخازن / الفروع", "Transfer between warehouses / branches")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="trf" type="submit" loading={pending}>{tr("نقل", "Transfer")}</Button></>}>
      <form id="trf" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api("/api/inventory/transfers", { method: "POST", body: { ...f, lines: toLines(lines) } }), tr("تم النقل", "Transferred"))) { setLines([{ itemId: "", quantity: "1" }]); onDone(); }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("من", "From")}><Select required value={f.fromWarehouseId} onChange={(e) => setF({ ...f, fromWarehouseId: e.target.value })}><option value="">—</option>{(whs.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name} — {w.branch.name}</option>)}</Select></Field>
          <Field label={tr("إلى", "To")} error={fields.toWarehouseId}><Select required value={f.toWarehouseId} onChange={(e) => setF({ ...f, toWarehouseId: e.target.value })}><option value="">—</option>{(whs.data ?? []).filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.name} — {w.branch.name}</option>)}</Select></Field>
          <Field label={tr("ملاحظات", "Notes")} className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <LineEditor lines={lines} onChange={setLines} items={items} />
        <p className="text-xs text-muted">{tr("تنتقل التشغيلات بتكلفتها وتاريخ انتهائها. النقل بين فرعين يُرحّل قيداً بين الفرعين.", "Lots move with their cost and expiry. Transfers between branches post a branch-to-branch entry.")}</p>
      </form>
    </Modal>
  );
}

type CardData = { item: { name: string; unit: string; minStock: string }; lots: { id: string; lotNo: string | null; expiryDate: string | null; quantity: string; unitCost: string; warehouse?: string }[];
  movements: { id: string; quantity: string; unitCost: string; totalCost: string; createdAt: string; warehouse?: string; document: { code: string; type: string; date: string; notes: string | null } }[] };

function ItemCard({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { tr, locale } = useSession();
  const money = useMoney();
  const { data } = useResource<CardData>(id ? `/api/inventory/items/${id}` : null);
  return (
    <Modal open={!!id} onClose={onClose} wide title={data?.item.name ?? tr("بطاقة صنف", "Item card")}>
      {!data ? <LoadingBlock cols={3} /> : <div className="space-y-4">
        <div>
          <div className="mb-1 text-sm font-medium">{tr("التشغيلات المتاحة (ترتيب الصرف)", "Available lots (issue order)")}</div>
          <Table head={[tr("التشغيلة", "Lot"), tr("المخزن", "Warehouse"), tr("الانتهاء", "Expiry"), tr("الكمية", "Qty"), tr("التكلفة", "Cost")]}>
            {data.lots.map((l) => <Tr key={l.id}><Td dir="ltr">{l.lotNo ?? "—"}</Td><Td>{l.warehouse}</Td><Td>{l.expiryDate ? fmtDate(l.expiryDate, locale) : "—"}</Td><Td className="tabular">{qn(l.quantity)} {data.item.unit}</Td><Td className="tabular">{money(l.unitCost)}</Td></Tr>)}
          </Table>
          {!data.lots.length && <p className="p-3 text-sm text-muted">{tr("لا يوجد رصيد", "No stock")}</p>}
        </div>
        <div>
          <div className="mb-1 text-sm font-medium">{tr("سجل الحركة", "Movement history")}</div>
          <Table head={[tr("التاريخ", "Date"), tr("المستند", "Document"), tr("المخزن", "Warehouse"), tr("الكمية", "Qty"), tr("القيمة", "Value")]}>
            {data.movements.map((m) => {
              const t = DOC_TYPES[m.document.type];
              return <Tr key={m.id}><Td className="text-muted">{fmtDate(m.document.date, locale)}</Td><Td><span dir="ltr" className="font-mono text-xs">{m.document.code}</span> <Badge tone={t[2]}>{tr(t[0], t[1])}</Badge></Td><Td>{m.warehouse}</Td>
                <Td className={`tabular ${Number(m.quantity) < 0 ? "text-danger" : "text-success"}`} dir="ltr">{Number(m.quantity) > 0 ? "+" : ""}{qn(m.quantity)}</Td><Td className="tabular">{money(m.totalCost)}</Td></Tr>;
            })}
          </Table>
        </div>
      </div>}
    </Modal>
  );
}

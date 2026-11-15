"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { api } from "@/lib/client";

type Product = { id: string; name: string; nameEn: string | null; sku: string | null; barcode: string | null; unit: string; price: string; cost: string; taxRate: string | null; isActive: boolean; trackStock: boolean; isSellable: boolean; isConsumable: boolean; expiryTracking: boolean; minStock: string; groupId: string | null };

export default function ProductsPage() {
  const { tr, can } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Product[]>(can("services.view") ? "/api/products" : null);
  const [edit, setEdit] = useState<Product | "new" | null>(null);
  const [q, setQ] = useState("");
  if (!can("services.view")) return <Forbidden />;
  const rows = (data ?? []).filter((p) => !q || p.name.includes(q) || p.sku?.toLowerCase().includes(q.toLowerCase()) || p.barcode === q);
  return (
    <>
      <PageHeader title={tr("المنتجات", "Products")} subtitle={tr("كتالوج واحد لمنتجات البيع والمواد المستهلكة. فعّل «تتبع المخزون» لتُدار كمياتها في المخازن.", "One catalog for retail products and consumable materials. Turn on “Track stock” to manage quantities in Inventory.")}
        actions={can("services.create") && <Button onClick={() => setEdit("new")}>+ {tr("منتج", "Product")}</Button>} />
      <Card>
        <div className="border-b border-line p-3"><Input className="max-w-xs" placeholder={tr("بحث بالاسم أو الرمز أو الباركود…", "Search name, SKU, barcode…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Table head={[tr("المنتج", "Product"), tr("الرمز", "SKU"), tr("الوحدة", "Unit"), tr("السعر", "Price"), tr("التكلفة", "Cost"), tr("الهامش", "Margin"), tr("الحالة", "Status")]}>
          {loading && !data ? <LoadingRows cols={7} /> : rows.map((p) => {
            const margin = Number(p.price) ? Math.round(((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100) : 0;
            return (
              <Tr key={p.id} onClick={can("services.update") ? () => setEdit(p) : undefined}>
                <Td className="font-medium">{p.name}</Td><Td className="text-muted"><span dir="ltr">{p.sku ?? "—"}</span></Td><Td className="text-muted">{p.unit}</Td>
                <Td className="tabular">{money(p.price)}</Td><Td className="tabular text-muted">{money(p.cost)}</Td><Td className="tabular">{margin}%</Td>
                <Td><div className="flex flex-wrap gap-1"><Badge tone={p.isActive ? "green" : "gray"}>{p.isActive ? tr("متاح", "Active") : tr("معطل", "Inactive")}</Badge>{p.trackStock && <Badge tone="blue">{tr("مخزني", "Stocked")}</Badge>}{p.isConsumable && <Badge>{tr("مادة مستهلكة", "Consumable")}</Badge>}{!p.isSellable && <Badge>{tr("غير معروض للبيع", "Not for sale")}</Badge>}</div></Td>
              </Tr>
            );
          })}
        </Table>
        {!loading && rows.length === 0 && <EmptyState title={tr("لا توجد منتجات", "No products")} />}
      </Card>
      <ProductModal p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

function ProductModal({ p, onClose, onSaved }: { p: Product | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const isNew = p === "new";
  const blank = { name: "", nameEn: "", sku: "", barcode: "", unit: "قطعة", price: "0", cost: "0", taxRate: "", isActive: true, trackStock: false, isSellable: true, isConsumable: false, expiryTracking: false, minStock: "0", groupId: "" };
  const { can } = useSession();
  const groups = useResource<{ id: string; name: string }[]>(p && can("inventory.view") ? "/api/inventory/groups" : null);
  const [f, setF] = useState(blank);
  const { pending, fields, run } = useSubmit();
  useEffect(() => {
    if (p === "new") setF(blank);
    else if (p) setF({ name: p.name, nameEn: p.nameEn ?? "", sku: p.sku ?? "", barcode: p.barcode ?? "", unit: p.unit, price: String(Number(p.price)), cost: String(Number(p.cost)), taxRate: p.taxRate === null ? "" : String(Number(p.taxRate)), isActive: p.isActive, trackStock: p.trackStock, isSellable: p.isSellable, isConsumable: p.isConsumable, expiryTracking: p.expiryTracking, minStock: String(Number(p.minStock)), groupId: p.groupId ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open={!!p} onClose={onClose} title={isNew ? tr("منتج جديد", "New product") : tr("تعديل المنتج", "Edit product")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="prod" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="prod" className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api(isNew ? "/api/products" : `/api/products/${(p as Product).id}`, { method: isNew ? "POST" : "PATCH", body: { ...f, groupId: f.groupId || null } }), tr("تم الحفظ", "Saved"))) onSaved();
      }}>
        <Field label={tr("الاسم", "Name")} error={fields.name}><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label={tr("الاسم بالإنجليزية", "English name")}><Input dir="ltr" value={f.nameEn} onChange={set("nameEn")} /></Field>
        <Field label={tr("الرمز (SKU)", "SKU")}><Input dir="ltr" value={f.sku} onChange={set("sku")} /></Field>
        <Field label={tr("الباركود", "Barcode")}><Input dir="ltr" value={f.barcode} onChange={set("barcode")} /></Field>
        <Field label={tr("سعر البيع", "Price")} error={fields.price}><Input type="number" min={0} step="any" dir="ltr" value={f.price} onChange={set("price")} /></Field>
        <Field label={tr("التكلفة", "Cost")}><Input type="number" min={0} step="any" dir="ltr" value={f.cost} onChange={set("cost")} /></Field>
        <Field label={tr("الوحدة", "Unit")}><Input value={f.unit} onChange={set("unit")} /></Field>
        <Field label={tr("ضريبة خاصة % (اختياري)", "Own tax % (optional)")}><Input type="number" min={0} max={100} dir="ltr" value={f.taxRate} onChange={set("taxRate")} /></Field>
        <Checkbox label={tr("فعّال", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        <Checkbox label={tr("يظهر في نقطة البيع", "Sold at the POS")} checked={f.isSellable} onChange={(e) => setF({ ...f, isSellable: e.target.checked })} />
        <div className="space-y-2 rounded-lg border border-line p-3 sm:col-span-2">
          <Checkbox label={tr("تتبع المخزون (كميات وتشغيلات)", "Track stock (quantities & lots)")} checked={f.trackStock} onChange={(e) => setF({ ...f, trackStock: e.target.checked })} />
          {f.trackStock && <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox label={tr("مادة مستهلكة في الخدمات", "Consumed by services")} checked={f.isConsumable} onChange={(e) => setF({ ...f, isConsumable: e.target.checked })} />
            <Checkbox label={tr("تتبع تاريخ الانتهاء", "Track expiry dates")} checked={f.expiryTracking} onChange={(e) => setF({ ...f, expiryTracking: e.target.checked })} />
            <Field label={tr("الحد الأدنى للتنبيه", "Low-stock alert at")}><Input type="number" min={0} step="any" dir="ltr" value={f.minStock} onChange={set("minStock")} /></Field>
            <Field label={tr("المجموعة", "Group")}><Select value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })}><option value="">—</option>{(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
          </div>}
        </div>
      </form>
    </Modal>
  );
}

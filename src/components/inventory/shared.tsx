"use client";
import Link from "next/link";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Input, Select } from "@/components/ui";

export type Item = { id: string; name: string; unit: string; cost: string; trackStock: boolean; expiryTracking: boolean; isActive: boolean; isSellable: boolean; isConsumable: boolean; minStock: string; groupId: string | null; sku: string | null };
export type Warehouse = { id: string; name: string; code: string; branchId: string; isDefault: boolean; isActive: boolean; branch: { name: string }; value: string; items: number };
export type Supplier = { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; taxNo: string | null; notes: string | null; isActive: boolean };

export const DOC_TYPES: Record<string, [string, string, "green" | "red" | "blue" | "amber" | "gray" | "brand"]> = {
  RECEIPT: ["استلام", "Receipt", "green"], ISSUE: ["صرف", "Issue", "amber"], TRANSFER: ["نقل", "Transfer", "blue"], WASTE: ["إتلاف", "Waste", "red"],
  ADJUSTMENT: ["تسوية جرد", "Count adjustment", "brand"], SALE: ["مبيعات", "Sale", "gray"], CONSUMPTION: ["استهلاك خدمة", "Service use", "gray"], RETURN: ["إرجاع", "Return", "green"],
};

/** Stock-tracked items (sellable products + consumable materials). */
export function useItems() {
  const { can } = useSession();
  const r = useResource<Item[]>(can("inventory.view") && (can("services.view") || can("pos.view")) ? "/api/products" : null);
  return (r.data ?? []).filter((i) => i.trackStock && i.isActive);
}
export function useWarehouses() {
  const { can } = useSession();
  return useResource<Warehouse[]>(can("inventory.view") ? "/api/inventory/warehouses" : null);
}

export type Line = { itemId: string; quantity: string; unitCost?: string; lotNo?: string; expiryDate?: string };

/** Editable list of item lines; `withCost` adds cost / lot / expiry columns (receipts). */
export function LineEditor({ lines, onChange, items, withCost }: { lines: Line[]; onChange: (l: Line[]) => void; items: Item[]; withCost?: boolean }) {
  const { tr } = useSession();
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const it = items.find((x) => x.id === l.itemId);
        return (
          <div key={i} className={`grid items-end gap-2 rounded-lg border border-line p-2 ${withCost ? "sm:grid-cols-[2fr_1fr_1fr_1fr_1.2fr_auto]" : "sm:grid-cols-[3fr_1fr_auto]"}`}>
            <label className="text-xs text-muted">{tr("الصنف", "Item")}
              <Select value={l.itemId} onChange={(e) => { const x = items.find((y) => y.id === e.target.value); set(i, { itemId: e.target.value, ...(withCost && x ? { unitCost: String(Number(x.cost)) } : {}) }); }} required>
                <option value="">—</option>
                {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </label>
            <label className="text-xs text-muted">{tr("الكمية", "Qty")}{it ? ` (${it.unit})` : ""}<Input type="number" min={0} step="any" dir="ltr" required value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></label>
            {withCost && <>
              <label className="text-xs text-muted">{tr("تكلفة الوحدة", "Unit cost")}<Input type="number" min={0} step="any" dir="ltr" required value={l.unitCost ?? ""} onChange={(e) => set(i, { unitCost: e.target.value })} /></label>
              <label className="text-xs text-muted">{tr("رقم التشغيلة", "Lot no.")}<Input dir="ltr" value={l.lotNo ?? ""} onChange={(e) => set(i, { lotNo: e.target.value })} /></label>
              <label className="text-xs text-muted">{tr("تاريخ الانتهاء", "Expiry")}{it?.expiryTracking ? " *" : ""}<Input type="date" dir="ltr" required={!!it?.expiryTracking} value={l.expiryDate ?? ""} onChange={(e) => set(i, { expiryDate: e.target.value })} /></label>
            </>}
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="remove">✕</Button>
          </div>
        );
      })}
      <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...lines, { itemId: "", quantity: "1", unitCost: "", lotNo: "", expiryDate: "" }])}>+ {tr("سطر", "Line")}</Button>
    </div>
  );
}

export const toLines = (ls: Line[], withCost?: boolean) => ls.filter((l) => l.itemId).map((l) => ({
  itemId: l.itemId, quantity: Number(l.quantity),
  ...(withCost ? { unitCost: Number(l.unitCost || 0), lotNo: l.lotNo || null, expiryDate: l.expiryDate || null } : {}),
}));

export function InventoryTabs({ active }: { active: string }) {
  const { tr, can } = useSession();
  const tabs: [string, string, string, boolean][] = [
    ["/inventory", tr("الأرصدة", "Stock"), "stock", true],
    ["/inventory/documents", tr("الحركات والمستندات", "Documents"), "docs", true],
    ["/inventory/purchase-orders", tr("أوامر الشراء", "Purchase orders"), "po", true],
    ["/inventory/counts", tr("الجرد", "Stock counts"), "counts", true],
    ["/inventory/setup", tr("المخازن والموردون", "Warehouses & suppliers"), "setup", can("inventory.view")],
  ];
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.filter((t) => t[3]).map(([href, label, key]) => (
        <Link key={key} href={href} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${active === key ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"}`}>{label}</Link>
      ))}
    </div>
  );
}

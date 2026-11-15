/**
 * Inventory. Stock lives in lots (item × warehouse × cost × expiry); lots can
 * never go negative (DB CHECK). Outgoing stock is taken FIFO by earliest
 * expiry, with rows locked FOR UPDATE so two sales can't take the same units.
 * Every document writes signed StockMovements and posts its accounting entry
 * in the same transaction.
 */
import { z } from "zod";
import { Prisma, type StockDocType } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { assertBranchAccess, nextCounter, optText, recordBranchScope, todayDate, uuidOpt } from "./common";
import { D, min, r2, sum, ZERO } from "./money";
import { cashAccountFor, postStockDocument } from "./accounting";
import { settingsTx } from "./settings";

const qty = z.coerce.number().positive().max(1e7);
const PREFIX: Record<StockDocType, string> = { RECEIPT: "GRN", ISSUE: "ISS", TRANSFER: "TRF", WASTE: "WST", ADJUSTMENT: "ADJ", SALE: "SAL", CONSUMPTION: "CON", RETURN: "RET" };

// ------------------------------------------------------------- primitives ----

async function newDoc(tx: Tx, tenantId: string, userId: string | null, type: StockDocType, data: Omit<Prisma.StockDocumentUncheckedCreateInput, "tenantId" | "code" | "type">) {
  const code = `${PREFIX[type]}-${String(await nextCounter(tx, tenantId, `stock_${type}`)).padStart(6, "0")}`;
  return tx.stockDocument.create({ data: { ...data, tenantId, code, type, createdById: userId } });
}

async function addLot(tx: Tx, tenantId: string, docId: string, l: { itemId: string; warehouseId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; lotNo?: string | null; expiryDate?: Date | null }) {
  const lot = await tx.stockLot.create({ data: { tenantId, itemId: l.itemId, warehouseId: l.warehouseId, quantity: l.quantity, unitCost: l.unitCost, lotNo: l.lotNo ?? null, expiryDate: l.expiryDate ?? null } });
  const totalCost = r2(l.quantity.times(l.unitCost));
  await tx.stockMovement.create({ data: { tenantId, documentId: docId, itemId: l.itemId, warehouseId: l.warehouseId, lotId: lot.id, quantity: l.quantity, unitCost: l.unitCost, totalCost } });
  return { lot, totalCost };
}

/** Takes `need` units FIFO (earliest expiry first). Returns cost taken and any shortfall. */
async function takeFIFO(tx: Tx, tenantId: string, docId: string, itemId: string, warehouseId: string, need: Prisma.Decimal) {
  const lots = await tx.$queryRaw<{ id: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; lotNo: string | null; expiryDate: Date | null }[]>`
    SELECT id, quantity, "unitCost", "lotNo", "expiryDate" FROM "StockLot"
    WHERE "tenantId" = ${tenantId}::uuid AND "itemId" = ${itemId}::uuid AND "warehouseId" = ${warehouseId}::uuid AND quantity > 0
    ORDER BY "expiryDate" ASC NULLS LAST, "receivedAt" ASC FOR UPDATE`;
  let left = D(need), cost = ZERO;
  const taken: { lotNo: string | null; expiryDate: Date | null; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[] = [];
  for (const l of lots) {
    if (left.lessThanOrEqualTo(0)) break;
    const q = min(left, D(l.quantity));
    await tx.stockLot.update({ where: { id: l.id }, data: { quantity: { decrement: q } } });
    const c = r2(q.times(l.unitCost));
    await tx.stockMovement.create({ data: { tenantId, documentId: docId, itemId, warehouseId, lotId: l.id, quantity: q.negated(), unitCost: l.unitCost, totalCost: c.negated() } });
    cost = cost.plus(c); left = left.minus(q);
    taken.push({ lotNo: l.lotNo, expiryDate: l.expiryDate, quantity: q, unitCost: D(l.unitCost) });
  }
  return { cost, short: left.greaterThan(0) ? left : ZERO, taken };
}

async function finish(tx: Tx, tenantId: string, docId: string, totalCost: Prisma.Decimal, userId: string | null) {
  await tx.stockDocument.update({ where: { id: docId }, data: { totalCost: r2(totalCost) } });
  await postStockDocument(tx, tenantId, docId, userId);
}

async function warehouseOr400(tx: Tx, ctx: Ctx, tenantId: string, id: string) {
  const w = await tx.warehouse.findFirst({ where: { id, tenantId, isActive: true } });
  if (!w) throw badRequest("Warehouse not found");
  assertBranchAccess(ctx, w.branchId);
  return w;
}

async function trackedItems(tx: Tx, tenantId: string, ids: string[]) {
  const items = await tx.product.findMany({ where: { tenantId, id: { in: ids } } });
  if (items.length !== new Set(ids).size) throw badRequest("Item not found");
  const untracked = items.filter((i) => !i.trackStock);
  if (untracked.length) throw badRequest(`Stock tracking is off for: ${untracked.map((i) => i.name).join(", ")}`);
  return items;
}

/** The branch's default warehouse, created on first need. */
export async function defaultWarehouse(tx: Tx, tenantId: string, branchId: string) {
  const w = (await tx.warehouse.findFirst({ where: { tenantId, branchId, isDefault: true, isActive: true } })) ?? (await tx.warehouse.findFirst({ where: { tenantId, branchId, isActive: true } }));
  if (w) return w;
  const b = await tx.branch.findFirstOrThrow({ where: { id: branchId, tenantId } });
  return tx.warehouse.create({ data: { tenantId, branchId, code: `WH-${b.code}`, name: `مخزن ${b.name}`, isDefault: true } });
}

// --------------------------------------------------- warehouses / groups ----

export const warehouseSchema = z.object({ branchId: z.string().uuid(), code: z.string().trim().toUpperCase().min(2).max(20).regex(/^[A-Z0-9_-]+$/), name: z.string().trim().min(2).max(120), isDefault: z.boolean().default(false), isActive: z.boolean().default(true) });

export async function listWarehouses(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, async (tx) => {
    for (const b of await tx.branch.findMany({ where: { tenantId, isActive: true, ...(recordBranchScope(ctx).branchId ? { id: { in: ctx.user.branchIds } } : {}) } })) await defaultWarehouse(tx, tenantId, b.id);
    const rows = await tx.warehouse.findMany({ where: { tenantId, ...recordBranchScope(ctx) }, include: { branch: { select: { name: true } } }, orderBy: [{ branchId: "asc" }, { name: "asc" }] });
    const vals = await tx.$queryRaw<{ warehouseId: string; value: Prisma.Decimal; items: bigint }[]>`
      SELECT "warehouseId", SUM(quantity * "unitCost") AS value, COUNT(DISTINCT "itemId") FILTER (WHERE quantity > 0) AS items FROM "StockLot" WHERE "tenantId" = ${tenantId}::uuid GROUP BY "warehouseId"`;
    return rows.map((w) => { const v = vals.find((x) => x.warehouseId === w.id); return { ...w, value: r2(D(v?.value ?? 0)), items: Number(v?.items ?? 0) }; });
  });
}

export async function saveWarehouse(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "inventory.update" : "inventory.create");
  const d = warehouseSchema.parse(raw);
  assertBranchAccess(ctx, d.branchId);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.branch.findFirst({ where: { id: d.branchId, tenantId } }))) throw badRequest("Branch not found");
    const dupe = await tx.warehouse.findFirst({ where: { tenantId, code: d.code, ...(id ? { id: { not: id } } : {}) } });
    if (dupe) throw conflict("Warehouse code already exists");
    if (d.isDefault) await tx.warehouse.updateMany({ where: { tenantId, branchId: d.branchId, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
    const w = id ? await tx.warehouse.update({ where: { id }, data: d }) : await tx.warehouse.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "warehouse.update" : "warehouse.create", entity: "Warehouse", entityId: w.id, after: w });
    return w;
  });
}

export async function listGroups(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, (tx) => tx.itemGroup.findMany({ where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { items: true } } } }));
}

export async function saveGroup(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "inventory.update" : "inventory.create");
  const d = z.object({ name: z.string().trim().min(1).max(120), parentId: uuidOpt, sortOrder: z.coerce.number().int().default(0) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (d.parentId && (d.parentId === id || !(await tx.itemGroup.findFirst({ where: { id: d.parentId, tenantId } })))) throw badRequest("Invalid parent group");
    const g = id ? await tx.itemGroup.update({ where: { id }, data: d }) : await tx.itemGroup.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "item_group.update" : "item_group.create", entity: "ItemGroup", entityId: g.id, after: g });
    return g;
  });
}

// --------------------------------------------------------------- suppliers ----

export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160), contactName: optText(120), phone: optText(40), email: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  address: optText(300), taxNo: optText(60), notes: optText(1000), isActive: z.boolean().default(true),
});

export async function listSuppliers(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, (tx) => tx.supplier.findMany({ where: { tenantId }, orderBy: { name: "asc" } }));
}

export async function saveSupplier(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "inventory.update" : "inventory.create");
  const d = supplierSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (id && !(await tx.supplier.findFirst({ where: { id, tenantId } }))) throw notFound("Supplier not found");
    const s = id ? await tx.supplier.update({ where: { id }, data: d }) : await tx.supplier.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "supplier.update" : "supplier.create", entity: "Supplier", entityId: s.id, after: s });
    return s;
  });
}

// ------------------------------------------------------------------ stock ----

export async function stockOverview(ctx: Ctx, q: { warehouseId?: string; groupId?: string; search?: string; low?: boolean }) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, async (tx) => {
    const whs = await tx.warehouse.findMany({ where: { tenantId, ...recordBranchScope(ctx) }, select: { id: true, name: true } });
    const whIds = q.warehouseId ? whs.filter((w) => w.id === q.warehouseId).map((w) => w.id) : whs.map((w) => w.id);
    const items = await tx.product.findMany({
      where: { tenantId, trackStock: true, ...(q.groupId ? { groupId: q.groupId } : {}), ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { sku: { contains: q.search, mode: "insensitive" } }, { barcode: q.search }] } : {}) },
      include: { group: { select: { name: true } } }, orderBy: { name: "asc" },
    });
    const lots = await tx.stockLot.findMany({ where: { tenantId, warehouseId: { in: whIds }, quantity: { gt: 0 } }, select: { itemId: true, warehouseId: true, quantity: true, unitCost: true, expiryDate: true } });
    const today = todayDate();
    const rows = items.map((it) => {
      const mine = lots.filter((l) => l.itemId === it.id);
      const total = sum(mine.map((l) => D(l.quantity)));
      const value = r2(sum(mine.map((l) => D(l.quantity).times(l.unitCost))));
      const expiries = mine.map((l) => l.expiryDate).filter(Boolean) as Date[];
      const nextExpiry = expiries.sort((a, b) => +a - +b)[0] ?? null;
      const byWarehouse = whs.filter((w) => whIds.includes(w.id)).map((w) => ({ warehouseId: w.id, name: w.name, quantity: sum(mine.filter((l) => l.warehouseId === w.id).map((l) => D(l.quantity))) }));
      return {
        id: it.id, name: it.name, sku: it.sku, unit: it.unit, group: it.group?.name ?? null, isSellable: it.isSellable, isConsumable: it.isConsumable, minStock: it.minStock,
        quantity: total, value, avgCost: total.isZero() ? D(it.cost) : r2(value.dividedBy(total)), nextExpiry, low: total.lessThan(it.minStock),
        expired: expiries.some((e) => e < today), byWarehouse,
      };
    });
    return { warehouses: whs.filter((w) => whIds.includes(w.id)), rows: q.low ? rows.filter((r) => r.low) : rows, totalValue: r2(sum(rows.map((r) => r.value))) };
  });
}

export async function stockAlerts(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, async (tx) => {
    const whIds = (await tx.warehouse.findMany({ where: { tenantId, ...recordBranchScope(ctx) }, select: { id: true } })).map((w) => w.id);
    const today = todayDate(), in30 = new Date(+today + 30 * 86400000);
    const [low, expiring] = await Promise.all([
      tx.$queryRaw<{ id: string; name: string; unit: string; minStock: Prisma.Decimal; quantity: Prisma.Decimal }[]>`
        SELECT p.id, p.name, p.unit, p."minStock", COALESCE(SUM(l.quantity) FILTER (WHERE l."warehouseId" = ANY(${whIds}::uuid[])), 0) AS quantity
        FROM "Product" p LEFT JOIN "StockLot" l ON l."itemId" = p.id
        WHERE p."tenantId" = ${tenantId}::uuid AND p."trackStock" AND p."isActive"
        GROUP BY p.id HAVING COALESCE(SUM(l.quantity) FILTER (WHERE l."warehouseId" = ANY(${whIds}::uuid[])), 0) < p."minStock" ORDER BY p.name`,
      tx.stockLot.findMany({ where: { tenantId, warehouseId: { in: whIds }, quantity: { gt: 0 }, expiryDate: { lte: in30 } }, orderBy: { expiryDate: "asc" }, take: 300 }),
    ]);
    const items = await tx.product.findMany({ where: { tenantId, id: { in: expiring.map((l) => l.itemId) } }, select: { id: true, name: true, unit: true } });
    const whs = await tx.warehouse.findMany({ where: { tenantId, id: { in: expiring.map((l) => l.warehouseId) } }, select: { id: true, name: true } });
    return {
      low: low.map((r) => ({ ...r, quantity: D(r.quantity) })),
      expiring: expiring.map((l) => ({ ...l, item: items.find((i) => i.id === l.itemId), warehouse: whs.find((w) => w.id === l.warehouseId), expired: l.expiryDate! < today, value: r2(D(l.quantity).times(l.unitCost)) })),
    };
  });
}

export async function itemCard(ctx: Ctx, itemId: string) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, async (tx) => {
    const item = await tx.product.findFirst({ where: { id: itemId, tenantId } });
    if (!item) throw notFound("Item not found");
    const whIds = (await tx.warehouse.findMany({ where: { tenantId, ...recordBranchScope(ctx) }, select: { id: true } })).map((w) => w.id);
    const [lots, moves] = await Promise.all([
      tx.stockLot.findMany({ where: { tenantId, itemId, warehouseId: { in: whIds }, quantity: { gt: 0 } }, orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }] }),
      tx.stockMovement.findMany({ where: { tenantId, itemId, warehouseId: { in: whIds } }, include: { document: { select: { code: true, type: true, date: true, notes: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
    ]);
    const whs = await tx.warehouse.findMany({ where: { tenantId, id: { in: whIds } }, select: { id: true, name: true } });
    return { item, lots: lots.map((l) => ({ ...l, warehouse: whs.find((w) => w.id === l.warehouseId)?.name })), movements: moves.map((m) => ({ ...m, warehouse: whs.find((w) => w.id === m.warehouseId)?.name })) };
  });
}

// ------------------------------------------------------------- documents ----

const lineIn = z.object({ itemId: z.string().uuid(), quantity: qty, unitCost: z.coerce.number().min(0).max(1e10), lotNo: optText(60), expiryDate: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)) });

export const receiptSchema = z.object({
  warehouseId: z.string().uuid(), supplierId: uuidOpt, date: z.coerce.date().default(() => new Date()), reference: optText(60), notes: optText(500),
  /** pay now from this cash box; empty = on the supplier's credit */
  cashAccountId: uuidOpt, purchaseOrderId: uuidOpt,
  lines: z.array(lineIn).min(1).max(300),
});

async function receiveTx(tx: Tx, ctx: Ctx, tenantId: string, d: z.infer<typeof receiptSchema>) {
  await warehouseOr400(tx, ctx, tenantId, d.warehouseId);
  const items = await trackedItems(tx, tenantId, d.lines.map((l) => l.itemId));
  if (!d.supplierId && !d.cashAccountId) throw badRequest("Choose the supplier (on credit) or the cash box that paid");
  if (d.supplierId && !(await tx.supplier.findFirst({ where: { id: d.supplierId, tenantId } }))) throw badRequest("Supplier not found");
  if (d.cashAccountId) await cashAccountFor(tx, tenantId, { cashAccountId: d.cashAccountId });
  for (const l of d.lines) {
    const it = items.find((i) => i.id === l.itemId)!;
    if (it.expiryTracking && !l.expiryDate) throw badRequest(`Expiry date is required for ${it.name}`);
  }
  const doc = await newDoc(tx, tenantId, ctx.user.id, "RECEIPT", { warehouseId: d.warehouseId, supplierId: d.supplierId, cashAccountId: d.cashAccountId, purchaseOrderId: d.purchaseOrderId, date: d.date, reference: d.reference, notes: d.notes });
  let total = ZERO;
  for (const l of d.lines) total = total.plus((await addLot(tx, tenantId, doc.id, { itemId: l.itemId, warehouseId: d.warehouseId, quantity: D(l.quantity), unitCost: D(l.unitCost), lotNo: l.lotNo, expiryDate: l.expiryDate })).totalCost);
  // Keep the item's reference cost current.
  for (const l of d.lines) await tx.product.update({ where: { id: l.itemId }, data: { cost: D(l.unitCost) } });
  await finish(tx, tenantId, doc.id, total, ctx.user.id);
  await audit(tx, ctx, { action: "stock.receipt", entity: "StockDocument", entityId: doc.id, after: { code: doc.code, total, lines: d.lines.length } });
  return tx.stockDocument.findUniqueOrThrow({ where: { id: doc.id } });
}

export async function receiveStock(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "inventory.create");
  const d = receiptSchema.parse(raw);
  return withTenant(tenantId, (tx) => receiveTx(tx, ctx, tenantId, d));
}

export const issueSchema = z.object({
  type: z.enum(["ISSUE", "WASTE"]), warehouseId: z.string().uuid(), date: z.coerce.date().default(() => new Date()),
  notes: z.string().trim().min(2).max(500), lines: z.array(z.object({ itemId: z.string().uuid(), quantity: qty })).min(1).max(300),
});

export async function issueStock(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "inventory.create");
  const d = issueSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await warehouseOr400(tx, ctx, tenantId, d.warehouseId);
    const items = await trackedItems(tx, tenantId, d.lines.map((l) => l.itemId));
    const doc = await newDoc(tx, tenantId, ctx.user.id, d.type, { warehouseId: d.warehouseId, date: d.date, notes: d.notes });
    let total = ZERO;
    for (const l of d.lines) {
      const r = await takeFIFO(tx, tenantId, doc.id, l.itemId, d.warehouseId, D(l.quantity));
      if (r.short.greaterThan(0)) throw new AppError(409, "INSUFFICIENT_STOCK", `Not enough ${items.find((i) => i.id === l.itemId)!.name} in stock (short ${r.short})`);
      total = total.plus(r.cost);
    }
    await finish(tx, tenantId, doc.id, total, ctx.user.id);
    await audit(tx, ctx, { action: `stock.${d.type.toLowerCase()}`, entity: "StockDocument", entityId: doc.id, after: { code: doc.code, total } });
    return tx.stockDocument.findUniqueOrThrow({ where: { id: doc.id } });
  });
}

export const transferSchema = z.object({
  fromWarehouseId: z.string().uuid(), toWarehouseId: z.string().uuid(), date: z.coerce.date().default(() => new Date()), notes: optText(500),
  lines: z.array(z.object({ itemId: z.string().uuid(), quantity: qty })).min(1).max(300),
}).refine((d) => d.fromWarehouseId !== d.toWarehouseId, { message: "Choose two different warehouses", path: ["toWarehouseId"] });

export async function transferStock(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "inventory.create");
  const d = transferSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await warehouseOr400(tx, ctx, tenantId, d.fromWarehouseId);
    const to = await tx.warehouse.findFirst({ where: { id: d.toWarehouseId, tenantId, isActive: true } });
    if (!to) throw badRequest("Destination warehouse not found");
    const items = await trackedItems(tx, tenantId, d.lines.map((l) => l.itemId));
    const doc = await newDoc(tx, tenantId, ctx.user.id, "TRANSFER", { warehouseId: d.fromWarehouseId, toWarehouseId: d.toWarehouseId, date: d.date, notes: d.notes });
    let total = ZERO;
    for (const l of d.lines) {
      const r = await takeFIFO(tx, tenantId, doc.id, l.itemId, d.fromWarehouseId, D(l.quantity));
      if (r.short.greaterThan(0)) throw new AppError(409, "INSUFFICIENT_STOCK", `Not enough ${items.find((i) => i.id === l.itemId)!.name} to transfer (short ${r.short})`);
      // Lots move with their cost and expiry.
      for (const t of r.taken) await addLot(tx, tenantId, doc.id, { itemId: l.itemId, warehouseId: d.toWarehouseId, quantity: t.quantity, unitCost: t.unitCost, lotNo: t.lotNo, expiryDate: t.expiryDate });
      total = total.plus(r.cost);
    }
    await finish(tx, tenantId, doc.id, total, ctx.user.id);
    await audit(tx, ctx, { action: "stock.transfer", entity: "StockDocument", entityId: doc.id, after: { code: doc.code, total, to: to.name } });
    return tx.stockDocument.findUniqueOrThrow({ where: { id: doc.id } });
  });
}

export async function listDocuments(ctx: Ctx, q: { type?: string; warehouseId?: string; from?: string; to?: string }) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, async (tx) => {
    const whIds = (await tx.warehouse.findMany({ where: { tenantId, ...recordBranchScope(ctx) }, select: { id: true } })).map((w) => w.id);
    const where: Prisma.StockDocumentWhereInput = { tenantId, OR: [{ warehouseId: { in: whIds } }, { toWarehouseId: { in: whIds } }] };
    if (q.type) where.type = q.type as StockDocType;
    if (q.warehouseId) where.AND = [{ OR: [{ warehouseId: q.warehouseId }, { toWarehouseId: q.warehouseId }] }];
    if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
    const docs = await tx.stockDocument.findMany({ where, orderBy: { date: "desc" }, take: 500, include: { _count: { select: { movements: true } } } });
    const [whs, sups] = await Promise.all([tx.warehouse.findMany({ where: { tenantId }, select: { id: true, name: true } }), tx.supplier.findMany({ where: { tenantId }, select: { id: true, name: true } })]);
    return docs.map((d) => ({ ...d, warehouse: whs.find((w) => w.id === d.warehouseId)?.name, toWarehouse: whs.find((w) => w.id === d.toWarehouseId)?.name ?? null, supplier: sups.find((s) => s.id === d.supplierId)?.name ?? null }));
  });
}

export async function getDocument(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, async (tx) => {
    const d = await tx.stockDocument.findFirst({ where: { id, tenantId }, include: { movements: true } });
    if (!d) throw notFound("Document not found");
    const items = await tx.product.findMany({ where: { tenantId, id: { in: d.movements.map((m) => m.itemId) } }, select: { id: true, name: true, unit: true } });
    const whs = await tx.warehouse.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const journal = await tx.journalEntry.findFirst({ where: { tenantId, source: "STOCK", sourceId: id }, select: { id: true, code: true } });
    return { ...d, journal, movements: d.movements.map((m) => ({ ...m, item: items.find((i) => i.id === m.itemId), warehouse: whs.find((w) => w.id === m.warehouseId)?.name })) };
  });
}

// --------------------------------------------------------- purchase orders ----

export const poSchema = z.object({
  supplierId: z.string().uuid(), warehouseId: z.string().uuid(), expectedDate: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)), notes: optText(500),
  lines: z.array(z.object({ itemId: z.string().uuid(), quantity: qty, unitCost: z.coerce.number().min(0) })).min(1).max(300),
});

export async function listPOs(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.purchaseOrder.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { lines: true }, take: 300 });
    const [sups, whs, items] = await Promise.all([
      tx.supplier.findMany({ where: { tenantId }, select: { id: true, name: true } }), tx.warehouse.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      tx.product.findMany({ where: { tenantId, id: { in: rows.flatMap((r) => r.lines.map((l) => l.itemId)) } }, select: { id: true, name: true, unit: true } }),
    ]);
    return rows.map((r) => ({ ...r, supplier: sups.find((s) => s.id === r.supplierId)?.name, warehouse: whs.find((w) => w.id === r.warehouseId)?.name, lines: r.lines.map((l) => ({ ...l, item: items.find((i) => i.id === l.itemId) })) }));
  });
}

export async function savePO(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "inventory.update" : "inventory.create");
  const d = poSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await warehouseOr400(tx, ctx, tenantId, d.warehouseId);
    if (!(await tx.supplier.findFirst({ where: { id: d.supplierId, tenantId } }))) throw badRequest("Supplier not found");
    await trackedItems(tx, tenantId, d.lines.map((l) => l.itemId));
    const total = r2(sum(d.lines.map((l) => D(l.quantity).times(l.unitCost))));
    const { lines, ...head } = d;
    let po;
    if (id) {
      const before = await tx.purchaseOrder.findFirst({ where: { id, tenantId } });
      if (!before) throw notFound("Purchase order not found");
      if (before.status !== "DRAFT") throw conflict("Only draft orders can be edited");
      await tx.purchaseOrderLine.deleteMany({ where: { tenantId, orderId: id } });
      po = await tx.purchaseOrder.update({ where: { id }, data: { ...head, total, lines: { create: lines.map((l) => ({ ...l, tenantId })) } } });
    } else {
      const code = `PO-${String(await nextCounter(tx, tenantId, "purchase_order")).padStart(6, "0")}`;
      po = await tx.purchaseOrder.create({ data: { ...head, tenantId, code, total, createdById: ctx.user.id, lines: { create: lines.map((l) => ({ ...l, tenantId })) } } });
    }
    await audit(tx, ctx, { action: id ? "po.update" : "po.create", entity: "PurchaseOrder", entityId: po.id, after: { code: po.code, total } });
    return po;
  });
}

export async function setPOStatus(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "inventory.approve");
  const { action } = z.object({ action: z.enum(["ORDER", "CANCEL"]) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id, tenantId } });
    if (!po) throw notFound("Purchase order not found");
    if (action === "ORDER" && po.status !== "DRAFT") throw conflict("Only drafts can be sent");
    if (action === "CANCEL" && !["DRAFT", "ORDERED"].includes(po.status)) throw conflict("Partially received orders can't be cancelled");
    const after = await tx.purchaseOrder.update({ where: { id }, data: { status: action === "ORDER" ? "ORDERED" : "CANCELLED" } });
    await audit(tx, ctx, { action: `po.${action.toLowerCase()}`, entity: "PurchaseOrder", entityId: id, after: { status: after.status } });
    return after;
  });
}

/** Receive (part of) an order: creates a receipt document on the supplier's credit. */
export async function receivePO(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "inventory.create");
  const d = z.object({
    reference: optText(60), cashAccountId: uuidOpt,
    lines: z.array(z.object({ lineId: z.string().uuid(), quantity: z.coerce.number().min(0), lotNo: optText(60), expiryDate: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)) })).min(1),
  }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!po) throw notFound("Purchase order not found");
    if (!["ORDERED", "PARTIAL"].includes(po.status)) throw conflict("Send the order before receiving it");
    const lines = d.lines.filter((l) => l.quantity > 0).map((l) => {
      const pl = po.lines.find((x) => x.id === l.lineId);
      if (!pl) throw badRequest("Order line not found");
      if (D(pl.receivedQty).plus(l.quantity).greaterThan(pl.quantity)) throw badRequest("Received quantity exceeds what was ordered");
      return { pl, ...l };
    });
    if (!lines.length) throw badRequest("Enter received quantities");
    const doc = await receiveTx(tx, ctx, tenantId, receiptSchema.parse({
      warehouseId: po.warehouseId, supplierId: po.supplierId, cashAccountId: d.cashAccountId, purchaseOrderId: po.id, reference: d.reference ?? po.code,
      lines: lines.map((l) => ({ itemId: l.pl.itemId, quantity: l.quantity, unitCost: Number(l.pl.unitCost), lotNo: l.lotNo, expiryDate: l.expiryDate })),
    }));
    for (const l of lines) await tx.purchaseOrderLine.update({ where: { id: l.pl.id }, data: { receivedQty: { increment: l.quantity } } });
    const fresh = await tx.purchaseOrderLine.findMany({ where: { orderId: id } });
    const done = fresh.every((l) => D(l.receivedQty).greaterThanOrEqualTo(l.quantity));
    await tx.purchaseOrder.update({ where: { id }, data: { status: done ? "RECEIVED" : "PARTIAL" } });
    return doc;
  });
}

// ------------------------------------------------------------- stock count ----

export async function listCounts(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.stockCount.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { lines: true } } }, take: 100 });
    const whs = await tx.warehouse.findMany({ where: { tenantId }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, warehouse: whs.find((w) => w.id === r.warehouseId)?.name }));
  });
}

export async function startCount(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "inventory.create");
  const { warehouseId, notes } = z.object({ warehouseId: z.string().uuid(), notes: optText(300) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    await warehouseOr400(tx, ctx, tenantId, warehouseId);
    if (await tx.stockCount.findFirst({ where: { tenantId, warehouseId, status: "DRAFT" } })) throw conflict("A count is already open for this warehouse");
    const items = await tx.product.findMany({ where: { tenantId, trackStock: true, isActive: true }, select: { id: true } });
    const qtys = await tx.stockLot.groupBy({ by: ["itemId"], where: { tenantId, warehouseId }, _sum: { quantity: true } });
    const code = `CNT-${String(await nextCounter(tx, tenantId, "stock_count")).padStart(6, "0")}`;
    const c = await tx.stockCount.create({
      data: { tenantId, code, warehouseId, notes, createdById: ctx.user.id, lines: { create: items.map((i) => ({ tenantId, itemId: i.id, expectedQty: D(qtys.find((q) => q.itemId === i.id)?._sum.quantity ?? 0) })) } },
    });
    await audit(tx, ctx, { action: "stock.count.start", entity: "StockCount", entityId: c.id, after: { code } });
    return c;
  });
}

export async function getCount(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "inventory.view");
  return withTenant(tenantId, async (tx) => {
    const c = await tx.stockCount.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!c) throw notFound("Count not found");
    const items = await tx.product.findMany({ where: { tenantId, id: { in: c.lines.map((l) => l.itemId) } }, select: { id: true, name: true, unit: true, sku: true, cost: true } });
    return { ...c, lines: c.lines.map((l) => ({ ...l, item: items.find((i) => i.id === l.itemId) })).sort((a, b) => (a.item?.name ?? "").localeCompare(b.item?.name ?? "")) };
  });
}

export async function updateCount(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "inventory.update");
  const d = z.array(z.object({ lineId: z.string().uuid(), countedQty: z.coerce.number().min(0).nullable() })).max(5000).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const c = await tx.stockCount.findFirst({ where: { id, tenantId } });
    if (!c) throw notFound("Count not found");
    if (c.status !== "DRAFT") throw conflict("Count is closed");
    for (const l of d) await tx.stockCountLine.updateMany({ where: { id: l.lineId, countId: id }, data: { countedQty: l.countedQty } });
    return { ok: true };
  });
}

/** Posts differences: surplus as a new lot at average cost, shortage taken FIFO. */
export async function postCount(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "inventory.approve");
  return withTenant(tenantId, async (tx) => {
    const c = await tx.stockCount.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!c) throw notFound("Count not found");
    if (c.status !== "DRAFT") throw conflict("Count is already closed");
    const counted = c.lines.filter((l) => l.countedQty !== null);
    if (!counted.length) throw badRequest("Enter at least one counted quantity");
    const doc = await newDoc(tx, tenantId, ctx.user.id, "ADJUSTMENT", { warehouseId: c.warehouseId, countId: c.id, notes: `جرد ${c.code}` });
    let total = ZERO;
    for (const l of counted) {
      const current = D((await tx.stockLot.aggregate({ where: { tenantId, warehouseId: c.warehouseId, itemId: l.itemId }, _sum: { quantity: true } }))._sum.quantity ?? 0);
      const diff = D(l.countedQty!).minus(current);
      if (diff.isZero()) continue;
      if (diff.greaterThan(0)) {
        const item = await tx.product.findUniqueOrThrow({ where: { id: l.itemId } });
        total = total.plus((await addLot(tx, tenantId, doc.id, { itemId: l.itemId, warehouseId: c.warehouseId, quantity: diff, unitCost: D(item.cost), lotNo: `CNT-${c.code}` })).totalCost);
      } else {
        const r = await takeFIFO(tx, tenantId, doc.id, l.itemId, c.warehouseId, diff.negated());
        total = total.minus(r.cost);
      }
    }
    await finish(tx, tenantId, doc.id, total, ctx.user.id);
    const after = await tx.stockCount.update({ where: { id }, data: { status: "POSTED", postedAt: new Date() } });
    await audit(tx, ctx, { action: "stock.count.post", entity: "StockCount", entityId: id, after: { code: c.code, adjustment: total, document: doc.code } });
    return after;
  });
}

// -------------------------------------------------- service materials ----

export async function saveServiceMaterials(ctx: Ctx, serviceId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "services.update");
  const d = z.array(z.object({ itemId: z.string().uuid(), quantity: qty })).max(50).refine((a) => new Set(a.map((x) => x.itemId)).size === a.length, "Each item once").parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.service.findFirst({ where: { id: serviceId, tenantId } }))) throw notFound("Service not found");
    if (d.length) await trackedItems(tx, tenantId, d.map((x) => x.itemId));
    await tx.serviceMaterial.deleteMany({ where: { tenantId, serviceId } });
    if (d.length) await tx.serviceMaterial.createMany({ data: d.map((x) => ({ ...x, tenantId, serviceId })) });
    await audit(tx, ctx, { action: "service.materials", entity: "Service", entityId: serviceId, after: d });
    return tx.serviceMaterial.findMany({ where: { tenantId, serviceId }, include: { item: { select: { name: true, unit: true } } } });
  });
}

export async function listServiceMaterials(ctx: Ctx, serviceId: string) {
  const tenantId = requireTenant(ctx, "services.view");
  return withTenant(tenantId, (tx) => tx.serviceMaterial.findMany({ where: { tenantId, serviceId }, include: { item: { select: { name: true, unit: true } } } }));
}

// ---------------------------------------------------------- automatic hooks ----

type Need = { itemId: string; quantity: Prisma.Decimal; name: string };

/** Deducts materials from the branch's default warehouse; returns any shortages. */
async function consume(tx: Tx, ctx: Ctx, tenantId: string, branchId: string, type: "CONSUMPTION" | "SALE", needs: Need[], refs: Partial<Prisma.StockDocumentUncheckedCreateInput>, notes: string) {
  if (!needs.length) return [];
  const s = await settingsTx(tx, tenantId);
  const wh = await defaultWarehouse(tx, tenantId, branchId);
  const doc = await newDoc(tx, tenantId, ctx.user.id, type, { warehouseId: wh.id, notes, ...refs });
  let total = ZERO;
  const shortages: { item: string; short: string }[] = [];
  for (const n of needs) {
    const r = await takeFIFO(tx, tenantId, doc.id, n.itemId, wh.id, n.quantity);
    total = total.plus(r.cost);
    if (r.short.greaterThan(0)) shortages.push({ item: n.name, short: r.short.toString() });
  }
  if (shortages.length && s.blockOnStockShortage) {
    throw new AppError(409, "INSUFFICIENT_STOCK", `Not enough stock in ${wh.name}: ${shortages.map((x) => `${x.item} (−${x.short})`).join(", ")}`);
  }
  await finish(tx, tenantId, doc.id, total, ctx.user.id);
  if (shortages.length) await audit(tx, ctx, { action: "stock.shortage", entity: "StockDocument", entityId: doc.id, after: { shortages } });
  return shortages;
}

export async function consumeForAppointment(tx: Tx, ctx: Ctx, tenantId: string, a: { id: string; serviceId: string | null; branchId: string }) {
  if (!a.serviceId || !ctx.features.has("inventory")) return [];
  const s = await settingsTx(tx, tenantId);
  if (!s.autoConsumeMaterials) return [];
  if (await tx.stockDocument.findFirst({ where: { tenantId, appointmentId: a.id, type: "CONSUMPTION" } })) return [];
  const mats = await tx.serviceMaterial.findMany({ where: { tenantId, serviceId: a.serviceId }, include: { item: true } });
  return consume(tx, ctx, tenantId, a.branchId, "CONSUMPTION", mats.filter((m) => m.item.trackStock).map((m) => ({ itemId: m.itemId, quantity: D(m.quantity), name: m.item.name })), { appointmentId: a.id }, "استهلاك مواد زيارة");
}

export async function consumeForSurgery(tx: Tx, ctx: Ctx, tenantId: string, surgeryId: string) {
  if (!ctx.features.has("inventory")) return [];
  const s = await tx.surgery.findUniqueOrThrow({ where: { id: surgeryId }, include: { supplies: true } });
  const supplies = s.supplies.filter((x) => x.itemId && !x.consumed);
  const items = await tx.product.findMany({ where: { tenantId, id: { in: supplies.map((x) => x.itemId!) }, trackStock: true } });
  const needs = supplies.filter((x) => items.some((i) => i.id === x.itemId)).map((x) => ({ itemId: x.itemId!, quantity: D(x.quantity), name: items.find((i) => i.id === x.itemId)!.name }));
  const res = await consume(tx, ctx, tenantId, s.branchId, "CONSUMPTION", needs, { surgeryId }, `مستلزمات عملية ${s.code}`);
  if (needs.length) await tx.surgerySupply.updateMany({ where: { surgeryId, itemId: { in: needs.map((n) => n.itemId) } }, data: { consumed: true } });
  return res;
}

export async function stockForInvoice(tx: Tx, ctx: Ctx, tenantId: string, invoiceId: string) {
  if (!ctx.features.has("inventory")) return [];
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { where: { kind: "PRODUCT", voided: false }, include: { product: true } } } });
  const needs = inv.lines.filter((l) => l.product?.trackStock).map((l) => ({ itemId: l.productId!, quantity: D(l.quantity), name: l.product!.name }));
  return consume(tx, ctx, tenantId, inv.branchId, "SALE", needs, { invoiceId }, `مبيعات ${inv.code}`);
}

/** Puts sold units back (invoice cancelled): each original lot gets its quantity back. */
export async function returnForInvoice(tx: Tx, ctx: Ctx, tenantId: string, invoiceId: string) {
  const sales = await tx.stockDocument.findMany({ where: { tenantId, invoiceId, type: "SALE" }, include: { movements: true } });
  if (!sales.length || (await tx.stockDocument.findFirst({ where: { tenantId, invoiceId, type: "RETURN" } }))) return;
  const doc = await newDoc(tx, tenantId, ctx.user.id, "RETURN", { warehouseId: sales[0].warehouseId, invoiceId, notes: "إلغاء فاتورة — إرجاع للمخزون" });
  let total = ZERO;
  for (const m of sales.flatMap((s) => s.movements)) {
    const q = D(m.quantity).negated();
    if (m.lotId) await tx.stockLot.update({ where: { id: m.lotId }, data: { quantity: { increment: q } } });
    await tx.stockMovement.create({ data: { tenantId, documentId: doc.id, itemId: m.itemId, warehouseId: m.warehouseId, lotId: m.lotId, quantity: q, unitCost: m.unitCost, totalCost: D(m.totalCost).negated() } });
    total = total.plus(D(m.totalCost).negated());
  }
  await finish(tx, tenantId, doc.id, total, ctx.user.id);
}

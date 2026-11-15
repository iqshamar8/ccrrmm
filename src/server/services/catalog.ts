/**
 * Service catalog (multi-level category tree + services), rooms, and the
 * bookable staff list used by the calendar.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { assertBranchAccess, optText, recordBranchScope, uuidOpt } from "./common";

const SERVICE_KINDS = ["CONSULTATION", "MEDICAL", "COSMETIC", "LASER", "DENTAL", "SURGERY", "FOLLOW_UP", "OTHER"] as const;
const money = z.coerce.number().min(0).max(1e10);
const commission = z.object({ type: z.enum(["NONE", "PERCENT", "FIXED"]), value: money }).refine(
  (c) => c.type !== "PERCENT" || c.value <= 100, "Percentage cannot exceed 100",
);

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  parentId: uuidOpt,
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const serviceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional().nullable().transform((v) => v || null),
  code: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  description: optText(2000),
  categoryId: uuidOpt,
  kind: z.enum(SERVICE_KINDS).default("OTHER"),
  price: money,
  cost: money.default(0),
  durationMin: z.coerce.number().int().min(5).max(24 * 60),
  execCommission: commission.default({ type: "NONE", value: 0 }),
  marketingCommission: commission.default({ type: "NONE", value: 0 }),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable().or(z.literal("").transform(() => null)),
  isActive: z.boolean().default(true),
  staffIds: z.array(z.string().uuid()).max(500).default([]),
  branchPrices: z.array(z.object({ branchId: z.string().uuid(), price: money })).max(200).default([]),
});

export const roomSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["TREATMENT", "LASER", "CONSULTATION", "OPERATING", "DENTAL"]).default("TREATMENT"),
  isActive: z.boolean().default(true),
});

// ---------------------------------------------------------------- read ----

export async function getCatalog(ctx: Ctx, opts: { activeOnly?: boolean } = {}) {
  const tenantId = requireTenant(ctx, ctx.permissions.has("services.view") ? "services.view" : "appointments.view");
  return withTenant(tenantId, async (tx) => {
    const [categories, services] = await Promise.all([
      tx.serviceCategory.findMany({ where: { tenantId, ...(opts.activeOnly ? { isActive: true } : {}) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      tx.service.findMany({
        where: { tenantId, ...(opts.activeOnly ? { isActive: true } : {}) },
        orderBy: { name: "asc" },
        include: { staff: { select: { userId: true } }, branchPrices: { select: { branchId: true, price: true } }, _count: { select: { appointments: true } } },
      }),
    ]);
    // Cost & commission are financial data.
    const fin = ctx.permissions.has("finance.view_data") || ctx.permissions.has("services.update");
    return {
      categories,
      services: services.map(({ staff, _count, ...s }) => ({
        ...s, staffIds: staff.map((x) => x.userId), appointments: _count.appointments,
        ...(fin ? {} : { cost: null, execCommissionValue: null, marketingCommissionValue: null }),
      })),
    };
  });
}

// ------------------------------------------------------------ categories ----

async function assertNoCycle(tx: Tx, tenantId: string, id: string, parentId: string | null) {
  let cur = parentId;
  for (let depth = 0; cur; depth++) {
    if (cur === id) throw badRequest("A category cannot be moved under itself");
    if (depth > 20) throw badRequest("Category tree is too deep");
    const p: { parentId: string | null } | null = await tx.serviceCategory.findFirst({ where: { id: cur, tenantId }, select: { parentId: true } });
    if (!p) throw badRequest("Parent category not found");
    cur = p.parentId;
  }
}

export async function createCategory(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "services.create");
  const data = categorySchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (data.parentId && !(await tx.serviceCategory.findFirst({ where: { id: data.parentId, tenantId } }))) throw badRequest("Parent category not found");
    const c = await tx.serviceCategory.create({ data: { ...data, tenantId } });
    await audit(tx, ctx, { action: "service_category.create", entity: "ServiceCategory", entityId: c.id, after: c });
    return c;
  });
}

export async function updateCategory(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "services.update");
  const data = categorySchema.partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.serviceCategory.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Category not found");
    if (data.parentId !== undefined) await assertNoCycle(tx, tenantId, id, data.parentId);
    const after = await tx.serviceCategory.update({ where: { id }, data });
    await audit(tx, ctx, { action: "service_category.update", entity: "ServiceCategory", entityId: id, before, after });
    return after;
  });
}

export async function deleteCategory(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "services.delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.serviceCategory.findFirst({ where: { id, tenantId }, include: { _count: { select: { children: true, services: true } } } });
    if (!before) throw notFound("Category not found");
    if (before._count.children || before._count.services) throw conflict("Move or delete its sub-categories and services first");
    await tx.serviceCategory.delete({ where: { id } });
    await audit(tx, ctx, { action: "service_category.delete", entity: "ServiceCategory", entityId: id, before });
    return { ok: true };
  });
}

// -------------------------------------------------------------- services ----

async function validateServiceRefs(tx: Tx, tenantId: string, d: { categoryId?: string | null; staffIds?: string[]; branchPrices?: { branchId: string }[] }) {
  if (d.categoryId && !(await tx.serviceCategory.findFirst({ where: { id: d.categoryId, tenantId } }))) throw badRequest("Category not found");
  if (d.staffIds?.length && (await tx.user.count({ where: { tenantId, id: { in: d.staffIds } } })) !== new Set(d.staffIds).size) {
    throw badRequest("One or more staff members not found");
  }
  const b = d.branchPrices?.map((x) => x.branchId) ?? [];
  if (b.length && (await tx.branch.count({ where: { tenantId, id: { in: b } } })) !== new Set(b).size) throw badRequest("Branch not found");
}

function serviceData(d: Partial<z.infer<typeof serviceSchema>>) {
  const { staffIds: _s, branchPrices: _b, execCommission, marketingCommission, ...rest } = d;
  return {
    ...rest,
    ...(execCommission ? { execCommissionType: execCommission.type, execCommissionValue: execCommission.value } : {}),
    ...(marketingCommission ? { marketingCommissionType: marketingCommission.type, marketingCommissionValue: marketingCommission.value } : {}),
  };
}

async function syncServiceLinks(tx: Tx, tenantId: string, serviceId: string, d: { staffIds?: string[]; branchPrices?: { branchId: string; price: number }[] }) {
  if (d.staffIds) {
    await tx.serviceStaff.deleteMany({ where: { tenantId, serviceId } });
    if (d.staffIds.length) await tx.serviceStaff.createMany({ data: [...new Set(d.staffIds)].map((userId) => ({ tenantId, serviceId, userId })) });
  }
  if (d.branchPrices) {
    await tx.serviceBranchPrice.deleteMany({ where: { tenantId, serviceId } });
    if (d.branchPrices.length) await tx.serviceBranchPrice.createMany({ data: d.branchPrices.map((p) => ({ tenantId, serviceId, ...p })) });
  }
}

export async function createService(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "services.create");
  const d = serviceSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await validateServiceRefs(tx, tenantId, d);
    const s = await tx.service.create({ data: { ...serviceData(d), tenantId } as Prisma.ServiceUncheckedCreateInput });
    await syncServiceLinks(tx, tenantId, s.id, d);
    await audit(tx, ctx, { action: "service.create", entity: "Service", entityId: s.id, after: { ...s, staffIds: d.staffIds, branchPrices: d.branchPrices } });
    return s;
  });
}

export async function updateService(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "services.update");
  const d = serviceSchema.partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.service.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Service not found");
    await validateServiceRefs(tx, tenantId, d);
    const after = await tx.service.update({ where: { id }, data: serviceData(d) as Prisma.ServiceUncheckedUpdateInput });
    await syncServiceLinks(tx, tenantId, id, d);
    await audit(tx, ctx, { action: "service.update", entity: "Service", entityId: id, before, after });
    return after;
  });
}

export async function deleteService(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "services.delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.service.findFirst({ where: { id, tenantId }, include: { _count: { select: { appointments: true } } } });
    if (!before) throw notFound("Service not found");
    if (before._count.appointments) throw conflict("This service has appointments — deactivate it instead of deleting");
    await tx.service.delete({ where: { id } });
    await audit(tx, ctx, { action: "service.delete", entity: "Service", entityId: id, before });
    return { ok: true };
  });
}

/** Effective price for a branch (branch override or base price). */
export async function servicePrice(tx: Tx, serviceId: string, branchId: string) {
  const o = await tx.serviceBranchPrice.findUnique({ where: { serviceId_branchId: { serviceId, branchId } } });
  if (o) return o.price;
  return (await tx.service.findUniqueOrThrow({ where: { id: serviceId } })).price;
}

// ----------------------------------------------------------------- rooms ----

export async function listRooms(ctx: Ctx) {
  const tenantId = requireTenant(ctx, ctx.permissions.has("branches.view") ? "branches.view" : "appointments.view");
  return withTenant(tenantId, (tx) =>
    tx.room.findMany({ where: { tenantId, ...recordBranchScope(ctx) }, orderBy: [{ branchId: "asc" }, { name: "asc" }], include: { branch: { select: { name: true } } } }),
  );
}

export async function createRoom(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "branches.update");
  const d = roomSchema.parse(raw);
  assertBranchAccess(ctx, d.branchId);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.branch.findFirst({ where: { id: d.branchId, tenantId } }))) throw badRequest("Branch not found");
    const r = await tx.room.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: "room.create", entity: "Room", entityId: r.id, after: r });
    return r;
  });
}

export async function updateRoom(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "branches.update");
  const d = roomSchema.partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.room.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!before) throw notFound("Room not found");
    if (d.branchId) {
      assertBranchAccess(ctx, d.branchId);
      if (!(await tx.branch.findFirst({ where: { id: d.branchId, tenantId } }))) throw badRequest("Branch not found");
    }
    const after = await tx.room.update({ where: { id }, data: d });
    await audit(tx, ctx, { action: "room.update", entity: "Room", entityId: id, before, after });
    return after;
  });
}

export async function deleteRoom(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "branches.update");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.room.findFirst({ where: { id, tenantId, ...recordBranchScope(ctx) } });
    if (!before) throw notFound("Room not found");
    await tx.room.delete({ where: { id } });
    await audit(tx, ctx, { action: "room.delete", entity: "Room", entityId: id, before });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- staff ----

/** Active staff who can be booked (any active user of the tenant). */
export async function listStaff(ctx: Ctx) {
  const tenantId = requireTenant(ctx, ctx.permissions.has("appointments.view") ? "appointments.view" : "services.view");
  return withTenant(tenantId, async (tx) => {
    const users = await tx.user.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, fullName: true, jobTitle: true, allBranches: true, role: { select: { key: true, nameAr: true, name: true } }, branchAccess: { select: { branchId: true } } },
      orderBy: { fullName: "asc" },
    });
    return users.map(({ branchAccess, ...u }) => ({ ...u, branchIds: branchAccess.map((b) => b.branchId) }));
  });
}

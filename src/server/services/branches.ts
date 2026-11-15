import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { withTenant } from "../db";
import { conflict, forbidden, notFound, planLimit } from "../errors";

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().min(2).max(20).regex(/^[A-Z0-9_-]+$/, "Only A-Z, 0-9, _ and -"),
  phone: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  address: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  isActive: z.boolean().default(true),
});

/** Branches the caller may see: all (with branches.view_all or allBranches) or only assigned ones. */
export function branchScope(ctx: Ctx): Prisma.BranchWhereInput {
  if (ctx.user.allBranches || ctx.permissions.has("branches.view_all")) return {};
  return { id: { in: ctx.user.branchIds } };
}

export async function listBranches(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "branches.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.branch.findMany({
      where: { tenantId, ...branchScope(ctx) },
      orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { userAccess: true } } },
    });
    return rows.map(({ _count, ...b }) => ({ ...b, users: _count.userAccess }));
  });
}

export async function createBranch(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "branches.create");
  const data = branchSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const max = ctx.tenant!.plan?.maxBranches ?? 0;
    if ((await tx.branch.count({ where: { tenantId } })) >= max) throw planLimit(`Your plan allows up to ${max} branches`);
    if (await tx.branch.findFirst({ where: { tenantId, code: data.code } })) throw conflict("Branch code already exists");
    const b = await tx.branch.create({ data: { ...data, tenantId } });
    await audit(tx, ctx, { action: "branch.create", entity: "Branch", entityId: b.id, after: b });
    return b;
  });
}

export async function updateBranch(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "branches.update");
  const data = branchSchema.partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.branch.findFirst({ where: { id, tenantId, ...branchScope(ctx) } });
    if (!before) throw notFound("Branch not found");
    if (before.isMain && data.isActive === false) throw forbidden("The main branch cannot be deactivated");
    if (data.code && data.code !== before.code && (await tx.branch.findFirst({ where: { tenantId, code: data.code } }))) {
      throw conflict("Branch code already exists");
    }
    const after = await tx.branch.update({ where: { id }, data });
    await audit(tx, ctx, { action: "branch.update", entity: "Branch", entityId: id, before, after });
    return after;
  });
}

export async function deleteBranch(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "branches.delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.branch.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Branch not found");
    if (before.isMain) throw forbidden("The main branch cannot be deleted");
    await tx.branch.delete({ where: { id } });
    await audit(tx, ctx, { action: "branch.delete", entity: "Branch", entityId: id, before });
    return { ok: true };
  });
}

import { z } from "zod";
import { ALL_PERMISSIONS, isValidPermission } from "@/lib/permissions";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { withTenant } from "../db";
import { conflict, forbidden, notFound } from "../errors";

export const roleSchema = z.object({
  key: z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-z0-9_]+$/, "Only a-z, 0-9 and _"),
  name: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  permissions: z.array(z.string()).max(1000).refine((p) => p.every(isValidPermission), "Unknown permission"),
});

export async function listRoles(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "roles.view");
  return withTenant(tenantId, async (tx) => {
    const roles = await tx.role.findMany({
      where: { tenantId }, orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { users: true } } },
    });
    return roles.map(({ _count, ...r }) => ({ ...r, users: _count.users }));
  });
}

export async function createRole(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "roles.create");
  const data = roleSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (await tx.role.findFirst({ where: { tenantId, key: data.key } })) throw conflict("Role key already exists");
    const role = await tx.role.create({ data: { ...data, tenantId, isSystem: false } });
    await audit(tx, ctx, { action: "role.create", entity: "Role", entityId: role.id, after: role });
    return role;
  });
}

export async function updateRole(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "roles.update");
  const data = roleSchema.partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.role.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Role not found");
    if (before.isSystem && data.key && data.key !== before.key) throw forbidden("System role keys cannot be changed");
    // The org-admin role always keeps every permission so nobody locks the org out.
    if (before.key === "tenant_admin") data.permissions = [...ALL_PERMISSIONS];
    // Privilege-escalation guard: you cannot grant permissions you don't have.
    const grant = (data.permissions ?? []).filter((p) => !before.permissions.includes(p));
    const missing = grant.filter((p) => !ctx.permissions.has(p) && ctx.user.roleKey !== "tenant_admin");
    if (missing.length) throw forbidden(`You cannot grant permissions you do not hold: ${missing.slice(0, 5).join(", ")}`);
    if (data.key && data.key !== before.key && (await tx.role.findFirst({ where: { tenantId, key: data.key } }))) {
      throw conflict("Role key already exists");
    }
    const after = await tx.role.update({ where: { id }, data });
    if (data.permissions) {
      // Permission changes apply on next request (context is loaded per request); no session bump needed.
    }
    await audit(tx, ctx, { action: "role.update", entity: "Role", entityId: id, before, after });
    return after;
  });
}

export async function deleteRole(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "roles.delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.role.findFirst({ where: { id, tenantId }, include: { _count: { select: { users: true } } } });
    if (!before) throw notFound("Role not found");
    if (before.isSystem) throw forbidden("System roles cannot be deleted");
    if (before._count.users > 0) throw conflict("Reassign this role's users before deleting it");
    await tx.role.delete({ where: { id } });
    await audit(tx, ctx, { action: "role.delete", entity: "Role", entityId: id, before });
    return { ok: true };
  });
}

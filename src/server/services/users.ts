/**
 * Tenant user management. All queries run inside withTenant (RLS) AND filter by
 * tenantId explicitly. A user id from another tenant is simply "not found".
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { hashPassword, passwordProblem } from "../auth";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, forbidden, notFound, planLimit } from "../errors";

const base = {
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  jobTitle: z.string().trim().max(80).optional().nullable().transform((v) => v || null),
  roleId: z.string().uuid(),
  allBranches: z.boolean().default(false),
  branchIds: z.array(z.string().uuid()).max(500).default([]),
  status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
  locale: z.enum(["ar", "en"]).default("ar"),
};
export const createUserSchema = z.object({
  ...base,
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(8).max(128),
});
export const updateUserSchema = z.object({
  ...base,
  password: z.string().max(128).optional().or(z.literal("")),
}).partial();

const userSelect = {
  id: true, email: true, fullName: true, phone: true, jobTitle: true, status: true, allBranches: true, locale: true,
  lastLoginAt: true, createdAt: true, roleId: true,
  role: { select: { id: true, key: true, name: true, nameAr: true } },
  branchAccess: { select: { branchId: true, branch: { select: { name: true } } } },
} satisfies Prisma.UserSelect;

async function assertRoleAndBranches(tx: Tx, tenantId: string, roleId: string | undefined, branchIds: string[] | undefined) {
  if (roleId) {
    const role = await tx.role.findFirst({ where: { id: roleId, tenantId } });
    if (!role) throw badRequest("Role not found");
  }
  if (branchIds?.length) {
    const n = await tx.branch.count({ where: { tenantId, id: { in: branchIds } } });
    if (n !== new Set(branchIds).size) throw badRequest("One or more branches not found");
  }
}

/** Is this user the last ACTIVE tenant_admin? (prevents locking the org out) */
async function isLastAdmin(tx: Tx, tenantId: string, userId: string) {
  const admins = await tx.user.findMany({
    where: { tenantId, status: "ACTIVE", role: { key: "tenant_admin" } }, select: { id: true },
  });
  return admins.length === 1 && admins[0].id === userId;
}

export async function listUsers(ctx: Ctx, q: { search?: string; roleId?: string; status?: string } = {}) {
  const tenantId = requireTenant(ctx, "users.view");
  const where: Prisma.UserWhereInput = { tenantId };
  if (q.search) {
    where.OR = [
      { fullName: { contains: q.search, mode: "insensitive" } },
      { email: { contains: q.search, mode: "insensitive" } },
      { phone: { contains: q.search } },
    ];
  }
  if (q.roleId) where.roleId = q.roleId;
  if (q.status === "ACTIVE" || q.status === "DISABLED") where.status = q.status;
  return withTenant(tenantId, (tx) => tx.user.findMany({ where, select: userSelect, orderBy: { createdAt: "asc" }, take: 1000 }));
}

export async function getUser(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "users.view");
  const u = await withTenant(tenantId, (tx) => tx.user.findFirst({ where: { id, tenantId }, select: userSelect }));
  if (!u) throw notFound("User not found");
  return u;
}

export async function createUser(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "users.create");
  const input = createUserSchema.parse(raw);
  const pw = passwordProblem(input.password);
  if (pw) throw badRequest(pw);
  const passwordHash = await hashPassword(input.password);

  return withTenant(tenantId, async (tx) => {
    const max = ctx.tenant!.plan?.maxUsers ?? 0;
    const count = await tx.user.count({ where: { tenantId } });
    if (count >= max) throw planLimit(`Your plan allows up to ${max} users`);
    await assertRoleAndBranches(tx, tenantId, input.roleId, input.branchIds);

    // email is globally unique; this check can't see other tenants (RLS) so we
    // rely on the unique index and map P2002 -> 409 in the API layer.
    const { branchIds, password: _p, ...data } = input;
    const user = await tx.user.create({
      data: {
        ...data, tenantId, passwordHash,
        branchAccess: { create: branchIds.map((branchId) => ({ tenantId, branchId })) },
      },
      select: userSelect,
    });
    await audit(tx, ctx, { action: "user.create", entity: "User", entityId: user.id, after: user });
    return user;
  });
}

export async function updateUser(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "users.update");
  const input = updateUserSchema.parse(raw);
  let passwordHash: string | undefined;
  if (input.password) {
    const pw = passwordProblem(input.password);
    if (pw) throw badRequest(pw);
    passwordHash = await hashPassword(input.password);
  }

  return withTenant(tenantId, async (tx) => {
    const before = await tx.user.findFirst({ where: { id, tenantId }, select: { ...userSelect, sessionVersion: true } });
    if (!before) throw notFound("User not found");
    await assertRoleAndBranches(tx, tenantId, input.roleId, input.branchIds);

    const demoting =
      (input.status === "DISABLED" && before.status === "ACTIVE") ||
      (input.roleId && input.roleId !== before.roleId && before.role?.key === "tenant_admin");
    if (demoting && (await isLastAdmin(tx, tenantId, id))) throw conflict("Cannot remove the last active organization admin");
    if (id === ctx.user.id && input.status === "DISABLED") throw forbidden("You cannot disable your own account");

    const { branchIds, password: _p, ...data } = input;
    const revoke = !!passwordHash || input.status === "DISABLED" || (input.roleId && input.roleId !== before.roleId);
    if (branchIds) {
      await tx.userBranch.deleteMany({ where: { tenantId, userId: id } });
      if (branchIds.length) await tx.userBranch.createMany({ data: branchIds.map((branchId) => ({ tenantId, userId: id, branchId })) });
    }
    const after = await tx.user.update({
      where: { id },
      data: { ...data, ...(passwordHash ? { passwordHash } : {}), ...(revoke ? { sessionVersion: { increment: 1 } } : {}) },
      select: userSelect,
    });
    await audit(tx, ctx, {
      action: passwordHash ? "user.update.password" : "user.update", entity: "User", entityId: id, before, after,
    });
    return after;
  });
}

export async function deleteUser(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "users.delete");
  if (id === ctx.user.id) throw forbidden("You cannot delete your own account");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.user.findFirst({ where: { id, tenantId }, select: userSelect });
    if (!before) throw notFound("User not found");
    if (await isLastAdmin(tx, tenantId, id)) throw conflict("Cannot delete the last active organization admin");
    await tx.user.delete({ where: { id } });
    await audit(tx, ctx, { action: "user.delete", entity: "User", entityId: id, before });
    return { ok: true };
  });
}

/**
 * Tenant isolation — the most important tests in the project.
 * Layer 1: PostgreSQL RLS (raw queries as crm_app).
 * Layer 2: service/API layer (cross-tenant ids behave as "not found").
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, rawAppClient, withTenant } from "@/server/db";
import { createUser, deleteUser, getUser, listUsers, updateUser } from "@/server/services/users";
import { deleteBranch, listBranches, updateBranch } from "@/server/services/branches";
import { listRoles, updateRole } from "@/server/services/roles";
import { listAudit } from "@/server/services/organization";
import { makePlan, makeTenant, PW } from "./helpers";

let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  const plan = await makePlan();
  A = await makeTenant(plan.id);
  B = await makeTenant(plan.id);
});
afterAll(disconnectAll);

describe("database layer (RLS)", () => {
  it("returns nothing when no tenant is set (fail closed)", async () => {
    const db = rawAppClient();
    expect(await db.user.count()).toBe(0);
    expect(await db.branch.count()).toBe(0);
    expect(await db.role.count()).toBe(0);
    expect(await db.tenant.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("only exposes the current tenant's rows, even without a WHERE clause", async () => {
    const users = await withTenant(A.tenant.id, (tx) => tx.user.findMany());
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => u.tenantId === A.tenant.id)).toBe(true);
    const tenants = await withTenant(A.tenant.id, (tx) => tx.tenant.findMany());
    expect(tenants.map((t) => t.id)).toEqual([A.tenant.id]);
  });

  it("cannot read another tenant's row by primary key", async () => {
    const found = await withTenant(A.tenant.id, (tx) => tx.user.findUnique({ where: { id: B.admin.id } }));
    expect(found).toBeNull();
  });

  it("cannot INSERT a row for another tenant", async () => {
    await expect(
      withTenant(A.tenant.id, (tx) => tx.branch.create({ data: { tenantId: B.tenant.id, name: "evil", code: "EVIL" } })),
    ).rejects.toThrow();
  });

  it("cannot UPDATE or DELETE another tenant's rows", async () => {
    const upd = await withTenant(A.tenant.id, (tx) => tx.user.updateMany({ where: { id: B.admin.id }, data: { fullName: "hacked" } }));
    expect(upd.count).toBe(0);
    const del = await withTenant(A.tenant.id, (tx) => tx.branch.deleteMany({ where: { tenantId: B.tenant.id } }));
    expect(del.count).toBe(0);
  });

  it("cannot move an own row into another tenant", async () => {
    const own = await withTenant(A.tenant.id, (tx) => tx.branch.findFirstOrThrow({ where: { tenantId: A.tenant.id } }));
    await expect(
      withTenant(A.tenant.id, (tx) => tx.branch.update({ where: { id: own.id }, data: { tenantId: B.tenant.id } })),
    ).rejects.toThrow();
  });

  it("cannot create a platform admin from a tenant session", async () => {
    await expect(
      withTenant(A.tenant.id, (tx) =>
        tx.user.create({ data: { tenantId: A.tenant.id, email: `x-${A.u}@t.test`, fullName: "x", passwordHash: "x", isPlatformAdmin: true } }),
      ),
    ).rejects.toThrow();
  });

  it("cannot change own tenant status or plan (column-level grants)", async () => {
    await expect(
      withTenant(A.tenant.id, (tx) => tx.tenant.update({ where: { id: A.tenant.id }, data: { status: "ACTIVE" } })),
    ).rejects.toThrow();
    await expect(
      withTenant(A.tenant.id, (tx) => tx.tenantSubscription.updateMany({ data: { status: "ACTIVE" } })),
    ).rejects.toThrow();
  });

  it("audit log is append-only for tenants", async () => {
    await expect(withTenant(A.tenant.id, (tx) => tx.auditLog.deleteMany({}))).rejects.toThrow();
  });

  it("tenant setting does not leak between transactions on pooled connections", async () => {
    await withTenant(A.tenant.id, (tx) => tx.user.count());
    expect(await rawAppClient().user.count()).toBe(0);
  });
});

describe("service / API layer", () => {
  it("lists only own users, branches, roles and audit rows", async () => {
    const users = await listUsers(A.ctx);
    expect(users.some((u) => u.id === B.admin.id)).toBe(false);
    const branches = await listBranches(A.ctx);
    expect(branches.length).toBe(1);
    const roles = await listRoles(A.ctx);
    expect(roles.length).toBe(10);
    const audit = await listAudit(A.ctx);
    expect(audit.items.every((r) => r.tenantId === A.tenant.id)).toBe(true);
  });

  it("treats another tenant's ids as not found (get/update/delete)", async () => {
    await expect(getUser(A.ctx, B.admin.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateUser(A.ctx, B.admin.id, { fullName: "hacked" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteUser(A.ctx, B.admin.id)).rejects.toMatchObject({ status: 404 });
    const bBranch = (await listBranches(B.ctx))[0];
    await expect(updateBranch(A.ctx, bBranch.id, { name: "hacked" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteBranch(A.ctx, bBranch.id)).rejects.toMatchObject({ status: 404 });
    const bRole = (await listRoles(B.ctx))[1];
    await expect(updateRole(A.ctx, bRole.id, { nameAr: "hacked" })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to attach another tenant's role or branch to a user", async () => {
    const bRole = (await listRoles(B.ctx))[0];
    const aRole = (await listRoles(A.ctx))[0];
    const bBranch = (await listBranches(B.ctx))[0];
    await expect(
      createUser(A.ctx, { fullName: "Mallory", email: `x1-${A.u}@t.test`, password: PW, roleId: bRole.id }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createUser(A.ctx, { fullName: "Mallory", email: `x2-${A.u}@t.test`, password: PW, roleId: aRole.id, branchIds: [bBranch.id] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("B's data is untouched after all attacks", async () => {
    const b = await getUser(B.ctx, B.admin.id);
    expect(b.fullName).toBe("Admin");
    expect((await listBranches(B.ctx)).length).toBe(1);
  });
});

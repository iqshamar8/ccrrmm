import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withPlatform } from "@/server/db";
import { loadContext } from "@/server/context";
import { login } from "@/server/services/session";
import { createBranch } from "@/server/services/branches";
import { createRole, deleteRole, listRoles, updateRole } from "@/server/services/roles";
import { createUser, deleteUser, listUsers, updateUser } from "@/server/services/users";
import { createTenant, listTenants, updateTenant } from "@/server/services/platform";
import { makePlan, makePlatformAdmin, makeTenant, makeUserWithRole, PW } from "./helpers";

afterAll(disconnectAll);

describe("RBAC", () => {
  let T: Awaited<ReturnType<typeof makeTenant>>;
  beforeAll(async () => {
    T = await makeTenant((await makePlan({ maxUsers: 6, maxBranches: 2, features: ["clients", "appointments"] })).id);
  });

  it("receptionist can view nothing in user admin and cannot create users", async () => {
    const rec = await makeUserWithRole(T.tenant.id, "receptionist");
    await expect(listUsers(rec)).rejects.toMatchObject({ status: 403 });
    await expect(createUser(rec, {})).rejects.toMatchObject({ status: 403 });
  });

  it("plan features filter role permissions (module not in plan => no permission)", async () => {
    const doc = await makeUserWithRole(T.tenant.id, "doctor");
    expect(doc.permissions.has("clients.view")).toBe(true); // in plan
    expect(doc.permissions.has("medical.view")).toBe(false); // role has it, plan doesn't
    expect(doc.permissions.has("surgeries.create")).toBe(false);
  });

  it("enforces plan user and branch limits", async () => {
    const roles = await listRoles(T.ctx);
    const rec = roles.find((r) => r.key === "receptionist")!;
    const count = (await listUsers(T.ctx)).length;
    for (let i = count; i < 6; i++) {
      await createUser(T.ctx, { fullName: `U${i}`, email: `u${i}-${T.u}@t.test`, password: PW, roleId: rec.id });
    }
    await expect(
      createUser(T.ctx, { fullName: "over", email: `over-${T.u}@t.test`, password: PW, roleId: rec.id }),
    ).rejects.toMatchObject({ status: 402 });
    await createBranch(T.ctx, { name: "Second", code: "SEC" });
    await expect(createBranch(T.ctx, { name: "Third", code: "THR" })).rejects.toMatchObject({ status: 402 });
  });

  it("system roles cannot be deleted; tenant_admin always keeps all permissions", async () => {
    const roles = await listRoles(T.ctx);
    const admin = roles.find((r) => r.key === "tenant_admin")!;
    await expect(deleteRole(T.ctx, admin.id)).rejects.toMatchObject({ status: 403 });
    const after = await updateRole(T.ctx, admin.id, { permissions: [] });
    expect(after.permissions.length).toBeGreaterThan(50);
  });

  it("custom roles: create, assign-guard, delete", async () => {
    const r = await createRole(T.ctx, { key: "viewer", name: "Viewer", nameAr: "مشاهد", permissions: ["clients.view"] });
    await expect(createRole(T.ctx, { key: "viewer", name: "Dup", nameAr: "مكرر", permissions: [] })).rejects.toMatchObject({ status: 409 });
    await expect(createRole(T.ctx, { key: "bad", name: "Bad", nameAr: "خطأ", permissions: ["nope.nope"] })).rejects.toThrow();
    await deleteRole(T.ctx, r.id);
  });

  it("cannot delete or disable the last organization admin / yourself", async () => {
    await expect(deleteUser(T.ctx, T.admin.id)).rejects.toMatchObject({ status: 403 });
    await expect(updateUser(T.ctx, T.admin.id, { status: "DISABLED" })).rejects.toMatchObject({ status: 409 });
  });

  it("every change writes an audit row in the same tenant", async () => {
    const rows = await withPlatform((tx) => tx.auditLog.findMany({ where: { tenantId: T.tenant.id } }));
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has("user.create")).toBe(true);
    expect(actions.has("branch.create")).toBe(true);
    expect(actions.has("role.delete")).toBe(true);
    expect(rows.every((r) => !JSON.stringify(r.after ?? {}).includes("passwordHash"))).toBe(true);
  });
});

describe("platform owner", () => {
  it("tenant users cannot call platform services", async () => {
    const T = await makeTenant((await makePlan()).id);
    await expect(listTenants(T.ctx)).rejects.toMatchObject({ status: 403 });
    await expect(createTenant(T.ctx, {})).rejects.toMatchObject({ status: 403 });
  });

  it("suspending a tenant blocks login and invalidates sessions", async () => {
    const owner = await makePlatformAdmin();
    const T = await makeTenant((await makePlan()).id);
    const before = await withPlatform((tx) => tx.user.findUniqueOrThrow({ where: { id: T.admin.id } }));
    await updateTenant(owner, T.tenant.id, { status: "SUSPENDED" });
    expect(await loadContext(T.admin.id, before.sessionVersion)).toBeNull(); // old session dead
    const ctx = await loadContext(T.admin.id, null);
    expect(ctx?.tenant?.access).toBe("suspended");
    await expect(listUsers(ctx!)).rejects.toMatchObject({ status: 403 });
    await expect(login({ email: T.admin.email, password: PW }, { ip: null, userAgent: null })).rejects.toMatchObject({ status: 403 });
  });

  it("login: wrong password is rejected and locks after 5 attempts", async () => {
    const T = await makeTenant((await makePlan()).id);
    for (let i = 0; i < 5; i++) {
      await expect(login({ email: T.admin.email, password: "wrong-pass1" }, { ip: null, userAgent: null })).rejects.toMatchObject({ status: 401 });
    }
    await expect(login({ email: T.admin.email, password: PW }, { ip: null, userAgent: null })).rejects.toMatchObject({ status: 429 });
  });

  it("provisioning creates subscription, main branch, 10 roles and an admin", async () => {
    const owner = await makePlatformAdmin();
    const plan = await makePlan();
    const t = await createTenant(owner, {
      name: "New Clinic", slug: `new-${Date.now()}`, type: "DENTAL_CENTER", planId: plan.id,
      admin: { fullName: "New Admin", email: `new-${Date.now()}@t.test`, password: PW },
    });
    const full = await withPlatform((tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: t.id }, include: { roles: true, branches: true, users: true, subscriptions: true } }),
    );
    expect(full.roles.length).toBe(10);
    expect(full.branches.filter((b) => b.isMain).length).toBe(1);
    expect(full.users.length).toBe(1);
    expect(full.subscriptions.length).toBe(1);
  });
});

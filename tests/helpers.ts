import { hashPassword } from "@/server/auth";
import { loadContext, type Ctx } from "@/server/context";
import { withPlatform } from "@/server/db";
import { provisionTenant } from "@/server/services/platform";
import { OPTIONAL_MODULES } from "@/lib/permissions";

export const PW = "Test@12345";

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function makePlan(overrides: { maxUsers?: number; maxBranches?: number; features?: string[] } = {}) {
  return withPlatform((tx) =>
    tx.plan.create({
      data: {
        code: `p-${uniq()}`, nameAr: "خطة", nameEn: "Plan", trialDays: 0,
        maxUsers: overrides.maxUsers ?? 50, maxBranches: overrides.maxBranches ?? 10,
        features: overrides.features ?? [...OPTIONAL_MODULES],
      },
    }),
  );
}

/** Creates a tenant + admin and returns admin ctx and ids. */
export async function makeTenant(planId: string) {
  const u = uniq();
  const tenant = await withPlatform((tx) =>
    provisionTenant(tx, {
      name: `Tenant ${u}`, slug: `t-${u}`, type: "MEDICAL_CLINIC", planId, startTrial: false,
      admin: { fullName: "Admin", email: `admin-${u}@t.test`, password: PW },
    }, null),
  );
  const admin = await withPlatform((tx) => tx.user.findFirstOrThrow({ where: { tenantId: tenant.id } }));
  const ctx = (await loadContext(admin.id, null))!;
  return { tenant, admin, ctx, u };
}

export async function makeUserWithRole(tenantId: string, roleKey: string): Promise<Ctx> {
  const u = uniq();
  const user = await withPlatform(async (tx) => {
    const role = await tx.role.findFirstOrThrow({ where: { tenantId, key: roleKey } });
    return tx.user.create({
      data: { tenantId, email: `${roleKey}-${u}@t.test`, fullName: roleKey, passwordHash: await hashPassword(PW), roleId: role.id },
    });
  });
  return (await loadContext(user.id, null))!;
}

export async function makePlatformAdmin(): Promise<Ctx> {
  const u = uniq();
  const user = await withPlatform(async (tx) =>
    tx.user.create({ data: { email: `owner-${u}@t.test`, fullName: "Owner", isPlatformAdmin: true, passwordHash: await hashPassword(PW) } }),
  );
  return (await loadContext(user.id, null))!;
}

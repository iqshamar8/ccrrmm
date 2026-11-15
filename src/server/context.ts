/**
 * Request context: who is calling, which tenant, what they may do.
 * Resolved fresh from the DB on every request — a disabled user, a suspended
 * tenant or an expired subscription takes effect immediately.
 */
import { CORE_MODULES, moduleOfPermission } from "@/lib/permissions";
import { withPlatform } from "./db";
import { forbidden, unauthorized, AppError } from "./errors";

export type TenantAccess = "ok" | "expired" | "suspended";

export type Ctx = {
  user: {
    id: string;
    email: string;
    fullName: string;
    isPlatformAdmin: boolean;
    locale: string;
    allBranches: boolean;
    branchIds: string[];
    roleKey: string | null;
    roleName: string | null;
  };
  tenant: null | {
    id: string;
    name: string;
    slug: string;
    type: string;
    status: string;
    primaryColor: string;
    logoUrl: string | null;
    baseCurrency: string;
    access: TenantAccess;
    plan: null | { code: string; nameAr: string; nameEn: string; maxUsers: number; maxBranches: number; storageMb: number };
    subscription: null | { status: string; endsAt: Date | null; trialEndsAt: Date | null };
  };
  permissions: Set<string>;
  features: Set<string>;
  ip: string | null;
  userAgent: string | null;
};

export async function loadContext(
  userId: string,
  sessionVersion: number | null,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<Ctx | null> {
  // Identity resolution is a platform concern: we don't know the tenant yet.
  const user = await withPlatform((tx) =>
    tx.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        branchAccess: { select: { branchId: true } },
        tenant: {
          include: {
            subscriptions: { orderBy: { createdAt: "desc" }, take: 1, include: { plan: true } },
          },
        },
      },
    }),
  );
  if (!user || user.status !== "ACTIVE") return null;
  if (sessionVersion !== null && user.sessionVersion !== sessionVersion) return null;

  const base = {
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  };
  const userInfo = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isPlatformAdmin: user.isPlatformAdmin,
    locale: user.locale,
    allBranches: user.allBranches,
    branchIds: user.branchAccess.map((b) => b.branchId),
    roleKey: user.role?.key ?? null,
    roleName: user.role ? user.role.nameAr : null,
  };

  if (user.isPlatformAdmin) {
    return { ...base, user: userInfo, tenant: null, permissions: new Set(), features: new Set() };
  }
  const t = user.tenant;
  if (!t) return null;

  const sub = t.subscriptions[0] ?? null;
  const now = Date.now();
  let access: TenantAccess = "ok";
  if (t.status === "SUSPENDED" || t.status === "CANCELLED") access = "suspended";
  else if (!sub || ["CANCELLED", "EXPIRED", "PAUSED"].includes(sub.status)) access = "expired";
  else if (sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt.getTime() < now) access = "expired";
  // PAST_DUE keeps access during the grace period; the lifecycle cron moves it to EXPIRED afterwards.
  else if (sub.status !== "PAST_DUE" && sub.endsAt && sub.endsAt.getTime() < now) access = "expired";

  const features = new Set<string>([...CORE_MODULES, ...(sub?.plan.features ?? [])]);
  // Effective permission = granted by role AND module enabled by plan.
  const permissions = new Set((user.role?.permissions ?? []).filter((p) => features.has(moduleOfPermission(p))));

  return {
    ...base,
    user: userInfo,
    permissions,
    features,
    tenant: {
      id: t.id,
      name: t.name,
      slug: t.slug,
      type: t.type,
      status: t.status,
      primaryColor: t.primaryColor,
      logoUrl: t.logoUrl,
      baseCurrency: t.baseCurrency,
      access,
      plan: sub
        ? {
            code: sub.plan.code,
            nameAr: sub.plan.nameAr,
            nameEn: sub.plan.nameEn,
            maxUsers: sub.plan.maxUsers,
            maxBranches: sub.plan.maxBranches,
            storageMb: sub.plan.storageMb,
          }
        : null,
      subscription: sub ? { status: sub.status, endsAt: sub.endsAt, trialEndsAt: sub.trialEndsAt } : null,
    },
  };
}

// --------------------------------------------------------------- guards ----

export function can(ctx: Ctx, perm: string) {
  return !!ctx.tenant && ctx.tenant.access === "ok" && ctx.permissions.has(perm);
}

/** Returns the tenant id or throws. Every tenant service starts with this. */
export function requireTenant(ctx: Ctx, perm?: string): string {
  if (!ctx.tenant) throw forbidden("This action requires an organization account");
  if (ctx.tenant.access === "suspended") throw new AppError(403, "TENANT_SUSPENDED", "Organization is suspended");
  if (ctx.tenant.access === "expired") throw new AppError(402, "SUBSCRIPTION_EXPIRED", "Subscription has expired");
  if (perm && !ctx.permissions.has(perm)) throw forbidden();
  return ctx.tenant.id;
}

export function requirePlatform(ctx: Ctx | null): Ctx {
  if (!ctx) throw unauthorized();
  if (!ctx.user.isPlatformAdmin) throw forbidden("Platform owner only");
  return ctx;
}

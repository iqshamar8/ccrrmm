/**
 * Super-admin services: tenants, plans, platform statistics.
 * Every exported function starts with requirePlatform(ctx).
 * Uses withPlatform (BYPASSRLS) because it operates across tenants.
 */
import { z } from "zod";
import { brandingForAudit, colourField, logoField } from "@/lib/branding";
import { Prisma } from "@prisma/client";
import { DEFAULT_ROLES, OPTIONAL_MODULES } from "@/lib/permissions";
import { hashPassword, passwordProblem } from "../auth";
import { audit } from "../audit";
import { type Ctx, requirePlatform } from "../context";
import { type Tx, withPlatform } from "../db";
import { badRequest, conflict, notFound } from "../errors";

const tenantTypes = [
  "MEDICAL_CLINIC", "BEAUTY_LASER_CENTER", "DENTAL_CENTER", "DERMATOLOGY_CENTER",
  "HOSPITAL", "MEDICAL_SERVICES_COMPANY", "CLINIC_MANAGEMENT_COMPANY", "MULTI_BRANCH_ORG",
] as const;

const slug = z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Only a-z, 0-9 and dashes");
const currency = z.string().trim().toUpperCase().length(3);
const optStr = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
  type: z.enum(tenantTypes),
  planId: z.string().uuid(),
  billingCycle: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
  startTrial: z.boolean().default(true),
  baseCurrency: currency.default("USD"),
  timezone: z.string().trim().max(60).default("Asia/Baghdad"),
  contactEmail: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal("").transform(() => null)),
  contactPhone: optStr(40),
  address: optStr(300),
  mainBranchName: z.string().trim().min(2).max(120).default("الفرع الرئيسي"),
  admin: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(128),
  }),
});
export type CreateTenantInput = z.input<typeof createTenantSchema>;

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  type: z.enum(tenantTypes).optional(),
  status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]).optional(),
  baseCurrency: currency.optional(),
  timezone: z.string().trim().max(60).optional(),
  contactEmail: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal("").transform(() => null)),
  contactPhone: optStr(40),
  address: optStr(300),
  logoUrl: logoField,
  primaryColor: colourField.optional(),
  accentColor: colourField.optional(),
});

export const changePlanSchema = z.object({
  planId: z.string().uuid(),
  billingCycle: z.enum(["MONTHLY", "YEARLY"]),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED"]).default("ACTIVE"),
  /** ISO date; default = now + 1 cycle */
  endsAt: z.coerce.date().optional().nullable(),
});

export const planSchema = z.object({
  code: z.string().trim().toLowerCase().min(2).max(30).regex(/^[a-z0-9_-]+$/),
  nameAr: z.string().trim().min(2).max(80),
  nameEn: z.string().trim().min(2).max(80),
  description: optStr(500),
  priceMonthly: z.coerce.number().min(0).max(1e9),
  priceYearly: z.coerce.number().min(0).max(1e9),
  currency: currency.default("USD"),
  trialDays: z.coerce.number().int().min(0).max(365),
  maxUsers: z.coerce.number().int().min(1).max(100000),
  maxBranches: z.coerce.number().int().min(1).max(10000),
  storageMb: z.coerce.number().int().min(100).max(10_000_000),
  features: z.array(z.string()).refine((f) => f.every((k) => OPTIONAL_MODULES.includes(k)), "Unknown module"),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

// --------------------------------------------------------------- tenants ----

const addCycle = (d: Date, cycle: "MONTHLY" | "YEARLY") => {
  const n = new Date(d);
  if (cycle === "MONTHLY") n.setMonth(n.getMonth() + 1);
  else n.setFullYear(n.getFullYear() + 1);
  return n;
};

/**
 * Creates a tenant with everything it needs to work on day one:
 * subscription, main branch, the 10 default roles, and an admin user.
 * Runs in one transaction — all or nothing.
 */
export async function provisionTenant(tx: Tx, raw: CreateTenantInput, actor: Ctx | null) {
  const input = createTenantSchema.parse(raw);
  const pwIssue = passwordProblem(input.admin.password);
  if (pwIssue) throw badRequest(pwIssue);

  const plan = await tx.plan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.isActive) throw badRequest("Plan not found or inactive");
  if (await tx.tenant.findUnique({ where: { slug: input.slug } })) throw conflict("Slug is already taken");
  if (await tx.user.findUnique({ where: { email: input.admin.email } })) throw conflict("Admin email is already registered");

  const now = new Date();
  const trial = input.startTrial && plan.trialDays > 0;
  const tenant = await tx.tenant.create({
    data: {
      name: input.name,
      slug: input.slug,
      type: input.type,
      status: trial ? "TRIAL" : "ACTIVE",
      baseCurrency: input.baseCurrency,
      timezone: input.timezone,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone,
      address: input.address,
    },
  });

  await tx.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      planId: plan.id,
      billingCycle: input.billingCycle,
      status: trial ? "TRIALING" : "ACTIVE",
      startsAt: now,
      trialEndsAt: trial ? new Date(now.getTime() + plan.trialDays * 86400000) : null,
      endsAt: trial ? null : addCycle(now, input.billingCycle),
    },
  });

  const branch = await tx.branch.create({
    data: { tenantId: tenant.id, name: input.mainBranchName, code: "MAIN", isMain: true },
  });

  await tx.role.createMany({
    data: DEFAULT_ROLES.map((r) => ({
      tenantId: tenant.id, key: r.key, name: r.name, nameAr: r.nameAr, permissions: r.permissions, isSystem: true,
    })),
  });
  const adminRole = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "tenant_admin" } } });

  const admin = await tx.user.create({
    data: {
      tenantId: tenant.id,
      email: input.admin.email,
      fullName: input.admin.fullName,
      passwordHash: await hashPassword(input.admin.password),
      roleId: adminRole.id,
      allBranches: true,
      branchAccess: { create: [{ tenantId: tenant.id, branchId: branch.id }] },
    },
  });

  await audit(tx, actor, {
    tenantId: tenant.id, action: "tenant.create", entity: "Tenant", entityId: tenant.id,
    after: { ...tenant, plan: plan.code, adminEmail: admin.email },
  });
  return tenant;
}

export async function createTenant(ctx: Ctx | null, raw: unknown) {
  const actor = requirePlatform(ctx);
  return withPlatform((tx) => provisionTenant(tx, raw as CreateTenantInput, actor));
}

export async function listTenants(ctx: Ctx | null, q?: { search?: string; status?: string }) {
  requirePlatform(ctx);
  const where: Prisma.TenantWhereInput = {};
  if (q?.search) {
    where.OR = [
      { name: { contains: q.search, mode: "insensitive" } },
      { slug: { contains: q.search, mode: "insensitive" } },
      { contactEmail: { contains: q.search, mode: "insensitive" } },
    ];
  }
  if (q?.status && ["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"].includes(q.status)) where.status = q.status as never;
  return withPlatform(async (tx) => {
    const rows = await tx.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        _count: { select: { users: true, branches: true } },
        subscriptions: { orderBy: { createdAt: "desc" }, take: 1, include: { plan: { select: { id: true, code: true, nameAr: true, nameEn: true } } } },
      },
    });
    return rows.map(({ subscriptions, _count, ...t }) => ({
      ...t, users: _count.users, branches: _count.branches, subscription: subscriptions[0] ?? null,
    }));
  });
}

export async function getTenant(ctx: Ctx | null, id: string) {
  requirePlatform(ctx);
  return withPlatform(async (tx) => {
    const t = await tx.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, branches: true, roles: true } },
        subscriptions: { orderBy: { createdAt: "desc" }, include: { plan: true } },
        branches: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!t) throw notFound("Tenant not found");
    return t;
  });
}

export async function updateTenant(ctx: Ctx | null, id: string, raw: unknown) {
  const actor = requirePlatform(ctx);
  const data = updateTenantSchema.parse(raw);
  return withPlatform(async (tx) => {
    const before = await tx.tenant.findUnique({ where: { id } });
    if (!before) throw notFound("Tenant not found");
    const after = await tx.tenant.update({ where: { id }, data });
    // Suspending / cancelling kills every active session of that tenant.
    if (data.status && data.status !== before.status && ["SUSPENDED", "CANCELLED"].includes(data.status)) {
      await tx.user.updateMany({ where: { tenantId: id }, data: { sessionVersion: { increment: 1 } } });
    }
    await audit(tx, actor, {
      tenantId: id, action: data.status && data.status !== before.status ? `tenant.status.${data.status.toLowerCase()}` : "tenant.update",
      entity: "Tenant", entityId: id, before: brandingForAudit(before), after: brandingForAudit(after),
    });
    return after;
  });
}

export async function changeTenantPlan(ctx: Ctx | null, tenantId: string, raw: unknown) {
  const actor = requirePlatform(ctx);
  const input = changePlanSchema.parse(raw);
  return withPlatform(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw notFound("Tenant not found");
    const plan = await tx.plan.findUnique({ where: { id: input.planId } });
    if (!plan) throw badRequest("Plan not found");
    const prev = await tx.tenantSubscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    const now = new Date();
    // Close previous subscription; keep it as history.
    if (prev && !["CANCELLED", "EXPIRED"].includes(prev.status)) {
      await tx.tenantSubscription.update({ where: { id: prev.id }, data: { status: "CANCELLED", cancelledAt: now } });
    }
    const sub = await tx.tenantSubscription.create({
      data: {
        tenantId, planId: plan.id, billingCycle: input.billingCycle, status: input.status, startsAt: now,
        endsAt: input.endsAt ?? addCycle(now, input.billingCycle),
      },
    });
    if (input.status === "ACTIVE" && tenant.status === "TRIAL") {
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } });
    }
    await audit(tx, actor, { tenantId, action: "tenant.plan.change", entity: "TenantSubscription", entityId: sub.id, before: prev, after: { ...sub, plan: plan.code } });
    return sub;
  });
}

// ----------------------------------------------------------------- plans ----

export async function listPlans(ctx: Ctx | null) {
  requirePlatform(ctx);
  return withPlatform(async (tx) => {
    const plans = await tx.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const counts = await tx.tenantSubscription.groupBy({
      by: ["planId"], where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } }, _count: true,
    });
    return plans.map((p) => ({ ...p, activeSubscriptions: counts.find((c) => c.planId === p.id)?._count ?? 0 }));
  });
}

export async function createPlan(ctx: Ctx | null, raw: unknown) {
  const actor = requirePlatform(ctx);
  const data = planSchema.parse(raw);
  return withPlatform(async (tx) => {
    if (await tx.plan.findUnique({ where: { code: data.code } })) throw conflict("Plan code already exists");
    const plan = await tx.plan.create({ data });
    await audit(tx, actor, { tenantId: null, action: "plan.create", entity: "Plan", entityId: plan.id, after: plan });
    return plan;
  });
}

export async function updatePlan(ctx: Ctx | null, id: string, raw: unknown) {
  const actor = requirePlatform(ctx);
  const data = planSchema.partial().parse(raw);
  return withPlatform(async (tx) => {
    const before = await tx.plan.findUnique({ where: { id } });
    if (!before) throw notFound("Plan not found");
    if (data.code && data.code !== before.code && (await tx.plan.findUnique({ where: { code: data.code } }))) {
      throw conflict("Plan code already exists");
    }
    const after = await tx.plan.update({ where: { id }, data });
    await audit(tx, actor, { tenantId: null, action: "plan.update", entity: "Plan", entityId: id, before, after });
    return after;
  });
}

// ----------------------------------------------------------------- stats ----

export async function platformStats(ctx: Ctx | null) {
  requirePlatform(ctx);
  return withPlatform(async (tx) => {
    const [byStatus, users, branches, activeSubs, recent] = await Promise.all([
      tx.tenant.groupBy({ by: ["status"], _count: true }),
      tx.user.count({ where: { isPlatformAdmin: false } }),
      tx.branch.count(),
      tx.tenantSubscription.findMany({
        where: { status: "ACTIVE" }, include: { plan: { select: { priceMonthly: true, priceYearly: true, currency: true } } },
      }),
      tx.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { tenant: { select: { name: true } } } }),
    ]);
    // Monthly recurring revenue (USD-equivalent assumed same currency for Phase 1)
    const mrr = activeSubs.reduce(
      (s, x) => s + (x.billingCycle === "MONTHLY" ? Number(x.plan.priceMonthly) : Number(x.plan.priceYearly) / 12), 0,
    );
    const soon = Date.now() + 14 * 86400000;
    const expiringSoon = activeSubs.filter((s) => s.endsAt && s.endsAt.getTime() < soon).length;
    const status = Object.fromEntries(byStatus.map((b) => [b.status, b._count]));
    return {
      tenants: byStatus.reduce((s, b) => s + b._count, 0),
      status, users, branches, mrr: Math.round(mrr * 100) / 100, activeSubscriptions: activeSubs.length, expiringSoon,
      recent: recent.map((r) => ({ ...r, id: r.id.toString() })),
    };
  });
}

export async function platformAudit(ctx: Ctx | null, q: { tenantId?: string; take?: number }) {
  requirePlatform(ctx);
  return withPlatform(async (tx) => {
    const rows = await tx.auditLog.findMany({
      where: q.tenantId ? { tenantId: q.tenantId } : {},
      orderBy: { createdAt: "desc" },
      take: Math.min(q.take ?? 100, 500),
      include: { tenant: { select: { name: true } } },
    });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  });
}

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { withTenant } from "../db";
import { notFound } from "../errors";
import { brandingForAudit, colourField, logoField } from "@/lib/branding";

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  logoUrl: logoField,
  primaryColor: colourField,
  accentColor: colourField,
  timezone: z.string().trim().max(60),
  defaultLocale: z.enum(["ar", "en"]),
  contactEmail: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal("").transform(() => null)),
  contactPhone: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  address: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
}).partial();

export async function getOrganization(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "settings.view");
  return withTenant(tenantId, async (tx) => {
    const t = await tx.tenant.findFirst({ where: { id: tenantId } });
    if (!t) throw notFound();
    const sub = await tx.tenantSubscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { plan: true } });
    return { ...t, subscription: sub };
  });
}

export async function updateOrganization(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "settings.update");
  const data = orgSettingsSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.tenant.findFirst({ where: { id: tenantId } });
    if (!before) throw notFound();
    // crm_app has column-level UPDATE grants only on these fields (see 0002_rls)
    const after = await tx.tenant.update({ where: { id: tenantId }, data });
    await audit(tx, ctx, { action: "organization.update", entity: "Tenant", entityId: tenantId, before: brandingForAudit(before), after: brandingForAudit(after) });
    return after;
  });
}

export async function listAudit(ctx: Ctx, q: { entity?: string; action?: string; userId?: string; cursor?: string; take?: number } = {}) {
  const tenantId = requireTenant(ctx, "audit.view");
  const where: Prisma.AuditLogWhereInput = { tenantId };
  if (q.entity) where.entity = q.entity;
  if (q.action) where.action = { startsWith: q.action };
  if (q.userId) where.userId = q.userId;
  if (q.cursor && /^\d+$/.test(q.cursor)) where.id = { lt: BigInt(q.cursor) };
  const take = Math.min(Math.max(q.take ?? 50, 1), 200);
  const rows = await withTenant(tenantId, (tx) => tx.auditLog.findMany({ where, orderBy: { id: "desc" }, take }));
  return {
    items: rows.map((r) => ({ ...r, id: r.id.toString() })),
    nextCursor: rows.length === take ? rows[rows.length - 1].id.toString() : null,
  };
}

/** Phase-1 tenant dashboard summary. Business KPIs arrive with Phase 2 modules. */
export async function tenantOverview(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "dashboard.view");
  return withTenant(tenantId, async (tx) => {
    const [users, activeUsers, branches, roles, recent] = await Promise.all([
      tx.user.count({ where: { tenantId } }),
      tx.user.count({ where: { tenantId, status: "ACTIVE" } }),
      tx.branch.count({ where: { tenantId } }),
      tx.role.count({ where: { tenantId } }),
      ctx.permissions.has("audit.view")
        ? tx.auditLog.findMany({ where: { tenantId }, orderBy: { id: "desc" }, take: 8 })
        : Promise.resolve([]),
    ]);
    return { users, activeUsers, branches, roles, recent: recent.map((r) => ({ ...r, id: r.id.toString() })) };
  });
}

/**
 * In-app notifications for staff (the bell). Always available — they are part
 * of the core product, unlike client messaging which needs the
 * "notifications" plan module.
 */
import { z } from "zod";
import type { Ctx } from "../context";
import { type Tx, withTenant } from "../db";

type Note = { type: string; title: string; body?: string | null; link?: string | null; dedupeKey?: string | null };

/** Notify specific users (inactive / other-tenant ids are ignored). */
export async function notifyUsers(tx: Tx, tenantId: string, userIds: (string | null | undefined)[], n: Note) {
  const ids = [...new Set(userIds.filter(Boolean) as string[])];
  if (!ids.length) return 0;
  const users = await tx.user.findMany({ where: { tenantId, id: { in: ids }, status: "ACTIVE" }, select: { id: true } });
  if (!users.length) return 0;
  const r = await tx.notification.createMany({
    data: users.map((u) => ({ tenantId, userId: u.id, type: n.type, title: n.title.slice(0, 200), body: n.body?.slice(0, 1000) ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })),
    skipDuplicates: true,
  });
  return r.count;
}

/** Notify every active user whose role grants `permission` (tenant admins always included). */
export async function notifyPermission(tx: Tx, tenantId: string, permission: string, n: Note, opts: { branchId?: string | null } = {}) {
  const users = await tx.user.findMany({
    where: { tenantId, status: "ACTIVE", OR: [{ role: { permissions: { has: permission } } }, { role: { key: "tenant_admin" } }] },
    select: { id: true, allBranches: true, branchAccess: { select: { branchId: true } } },
  });
  const targets = users.filter((u) => !opts.branchId || u.allBranches || u.branchAccess.some((b) => b.branchId === opts.branchId) || u.branchAccess.length === 0);
  return notifyUsers(tx, tenantId, targets.map((u) => u.id), n);
}

// ------------------------------------------------------------------ API ----

export async function listMyNotifications(ctx: Ctx, q: { unread?: boolean; limit?: number } = {}) {
  if (!ctx.tenant) return { items: [], unread: 0 };
  const tenantId = ctx.tenant.id;
  return withTenant(tenantId, async (tx) => {
    const where = { tenantId, userId: ctx.user.id };
    const [items, unread] = await Promise.all([
      tx.notification.findMany({ where: { ...where, ...(q.unread ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: Math.min(q.limit ?? 30, 200) }),
      tx.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items, unread };
  });
}

export async function markNotificationsRead(ctx: Ctx, raw: unknown) {
  if (!ctx.tenant) return { updated: 0 };
  const tenantId = ctx.tenant.id;
  const d = z.object({ ids: z.array(z.string().uuid()).max(500).optional(), all: z.boolean().optional() }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const r = await tx.notification.updateMany({
      where: { tenantId, userId: ctx.user.id, readAt: null, ...(d.all ? {} : { id: { in: d.ids ?? [] } }) },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  });
}

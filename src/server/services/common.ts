import { z } from "zod";
import type { Ctx } from "../context";
import type { Tx } from "../db";
import { AppError, forbidden } from "../errors";

/** Atomically increments a per-tenant counter and returns the new value. */
export async function nextCounter(tx: Tx, tenantId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "TenantCounter" ("tenantId", "key", "value") VALUES (${tenantId}::uuid, ${key}, 1)
    ON CONFLICT ("tenantId", "key") DO UPDATE SET "value" = "TenantCounter"."value" + 1
    RETURNING "value"`;
  return rows[0].value;
}

/** Digits only; "00964..." -> "964...". Used for duplicate detection. */
export function normalizePhone(p: string) {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return d;
}
/** Last 9 digits match "0770 123 4567" with "+964 770 123 4567". */
export const phoneKey = (normalized: string) => normalized.slice(-9);

export function seesAllBranches(ctx: Ctx) {
  return ctx.user.allBranches || ctx.permissions.has("branches.view_all");
}

/** Prisma where-fragment restricting branch-owned records to the caller's branches. */
export function recordBranchScope(ctx: Ctx): { branchId?: { in: string[] } } {
  return seesAllBranches(ctx) ? {} : { branchId: { in: ctx.user.branchIds } };
}

export function assertBranchAccess(ctx: Ctx, branchId: string) {
  if (!seesAllBranches(ctx) && !ctx.user.branchIds.includes(branchId)) throw forbidden("You don't have access to this branch");
}

/** Default branch for new records: the user's first branch, else the main one. */
export async function defaultBranchId(tx: Tx, ctx: Ctx, tenantId: string) {
  if (ctx.user.branchIds[0]) return ctx.user.branchIds[0];
  const main = await tx.branch.findFirst({ where: { tenantId, isMain: true } });
  return main!.id;
}

export const optText = (max = 2000) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
export const uuidOpt = z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)).transform((v) => v ?? null);

export const toNum = (d: unknown) => (d === null || d === undefined ? null : Number(d));

/** Live client visible to the caller (tenant + branch scope), or 404/400. */
export async function requireClient(tx: Tx, ctx: Ctx, tenantId: string, clientId: string, status = 404) {
  const c = await tx.client.findFirst({ where: { id: clientId, tenantId, deletedAt: null, ...recordBranchScope(ctx) } });
  if (!c) throw new AppError(status, status === 404 ? "NOT_FOUND" : "BAD_REQUEST", "Client not found");
  return c;
}

/** Active staff member of the tenant (optionally must work in branchId). */
export async function requireStaff(tx: Tx, tenantId: string, userId: string, branchId?: string) {
  const u = await tx.user.findFirst({ where: { id: userId, tenantId, status: "ACTIVE" }, include: { branchAccess: true } });
  if (!u) throw new AppError(400, "BAD_REQUEST", "Staff member not found");
  if (branchId && !u.allBranches && !u.branchAccess.some((b) => b.branchId === branchId)) {
    throw new AppError(400, "BAD_REQUEST", `${u.fullName} doesn't work in this branch`);
  }
  return u;
}

/** Today as a DATE (UTC midnight), for @db.Date comparisons. */
export function todayDate() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export const addDaysUTC = (d: Date, n: number) => new Date(+d + n * 86400000);

/** Whole calendar days from `from` to `to` (not elapsed-ms rounding, which over-counts by one). */
export function calendarDaysBetween(from: Date, to: Date) {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86400000);
}

/** Clinical free text is shown only to users with medical.view_data. */
export const canSeeClinical = (ctx: Ctx) => ctx.permissions.has("medical.view_data");

export const ACTIVE_APPT = ["SCHEDULED", "CONFIRMED", "CHECKED_IN"] as const;

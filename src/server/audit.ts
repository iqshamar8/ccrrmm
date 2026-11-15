import { Prisma } from "@prisma/client";
import type { Ctx } from "./context";
import type { Tx } from "./db";

const SECRET_KEYS = new Set(["passwordHash", "password", "sessionVersion", "failedLogins", "lockedUntil", "accessTokenEnc", "appSecretEnc", "accessToken", "appSecret", "verifyToken"]);

/** JSON-safe copy without secrets (Decimal/BigInt/Date -> string). */
export function scrub(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (SECRET_KEYS.has(k) ? undefined : typeof val === "bigint" ? val.toString() : val)),
  );
}

export type AuditEntry = {
  action: string; // e.g. "user.create"
  entity: string; // e.g. "User"
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** override tenant (platform actions that concern a specific tenant) */
  tenantId?: string | null;
};

/**
 * Write an audit row inside the SAME transaction as the change, so a change
 * and its audit record commit or roll back together.
 */
export async function audit(tx: Tx, ctx: Ctx | null, e: AuditEntry) {
  await tx.auditLog.create({
    data: {
      tenantId: e.tenantId !== undefined ? e.tenantId : (ctx?.tenant?.id ?? null),
      userId: ctx?.user.id ?? null,
      userEmail: ctx?.user.email ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      before: scrub(e.before),
      after: scrub(e.after),
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent?.slice(0, 300) ?? null,
    },
  });
}

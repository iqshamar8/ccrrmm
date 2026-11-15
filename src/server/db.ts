/**
 * Database access — the ONLY place PrismaClients are created.
 *
 *  withTenant(tenantId, fn)  -> role crm_app (RLS enforced) inside a transaction
 *                               that sets app.tenant_id. Use for ALL tenant work.
 *  withPlatform(fn)          -> role crm_platform (BYPASSRLS). Use ONLY for
 *                               super-admin operations and identity lookup.
 *
 * Even inside withTenant, services still filter by tenantId explicitly
 * (defense in depth: app layer + database layer).
 */
import { Prisma, PrismaClient } from "@prisma/client";

export type Tx = Prisma.TransactionClient;

const useTest = process.env.MEDCRM_DB === "test";
const APP_URL = useTest ? process.env.TEST_DATABASE_URL_APP : process.env.DATABASE_URL_APP;
const PLATFORM_URL = useTest ? process.env.TEST_DATABASE_URL_PLATFORM : process.env.DATABASE_URL_PLATFORM;

type Clients = { app: PrismaClient; platform: PrismaClient };
const g = globalThis as unknown as { __medcrm?: Clients };

function clients(): Clients {
  if (!g.__medcrm) {
    if (!APP_URL || !PLATFORM_URL) throw new Error("DATABASE_URL_APP / DATABASE_URL_PLATFORM are not configured");
    g.__medcrm = {
      app: new PrismaClient({ datasourceUrl: APP_URL }),
      platform: new PrismaClient({ datasourceUrl: PLATFORM_URL }),
    };
  }
  return g.__medcrm;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isUuid(tenantId)) throw new Error("withTenant: invalid tenant id");
  return clients().app.$transaction(
    async (tx) => {
      // `true` = setting is LOCAL to this transaction; it can never leak to
      // another request that later reuses the pooled connection.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    { timeout: 15000 },
  );
}

export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>, opts: { timeout?: number } = {}): Promise<T> {
  return clients().platform.$transaction(fn, { timeout: opts.timeout ?? 30000, maxWait: 10000 });
}

/** For tests/scripts only: raw app client WITHOUT tenant context. */
export function rawAppClient() {
  return clients().app;
}

export async function disconnectAll() {
  if (g.__medcrm) {
    await Promise.all([g.__medcrm.app.$disconnect(), g.__medcrm.platform.$disconnect()]);
    g.__medcrm = undefined;
  }
}

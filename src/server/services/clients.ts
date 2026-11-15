/**
 * Clients / patients (CRM). Branch-scoped: users without all-branch access
 * only see clients of their branches. Deletion is soft (medical history must
 * survive); duplicates are blocked by phone at app level AND by a partial
 * unique index in PostgreSQL.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { AppError, badRequest, notFound } from "../errors";
import {
  assertBranchAccess, defaultBranchId, nextCounter, normalizePhone, optText, phoneKey, recordBranchScope, uuidOpt,
} from "./common";

export const CLIENT_SOURCES = ["walk_in", "phone", "instagram", "facebook", "tiktok", "snapchat", "google", "website", "whatsapp", "referral", "influencer", "corporate", "other"] as const;

const clientBase = {
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30).refine((p) => normalizePhone(p).length >= 6, "Invalid phone number"),
  email: z.string().trim().toLowerCase().email().max(160).optional().nullable().or(z.literal("").transform(() => null)),
  gender: z.enum(["MALE", "FEMALE"]).optional().nullable().or(z.literal("").transform(() => null)),
  birthDate: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)),
  address: optText(300),
  source: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  sourceDetail: optText(200),
  status: z.enum(["LEAD", "ACTIVE", "INACTIVE", "BLOCKED"]).default("ACTIVE"),
  category: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]).transform((t) => [...new Set(t)]),
  notes: optText(4000),
  branchId: uuidOpt,
  ownerId: uuidOpt,
  // Phase 6: attribution & consent
  influencerId: uuidOpt,
  campaignId: uuidOpt,
  marketingOptOut: z.boolean().optional(),
};
export const createClientSchema = z.object(clientBase);
export const updateClientSchema = z.object(clientBase).partial();

const listSelect = {
  id: true, code: true, fullName: true, phone: true, email: true, gender: true, status: true, source: true, category: true,
  tags: true, createdAt: true, lastVisitAt: true, branchId: true,
  branch: { select: { name: true } }, owner: { select: { id: true, fullName: true } },
} satisfies Prisma.ClientSelect;

function liveClient(ctx: Ctx, tenantId: string, id: string): Prisma.ClientWhereInput {
  return { id, tenantId, deletedAt: null, ...recordBranchScope(ctx) };
}

async function findDuplicate(tx: Tx, tenantId: string, phoneNormalized: string, excludeId?: string) {
  return tx.client.findFirst({
    where: { tenantId, deletedAt: null, phoneNormalized: { endsWith: phoneKey(phoneNormalized) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, code: true, fullName: true, phone: true },
  });
}

function duplicateError(d: { id: string; code: string; fullName: string }) {
  return new AppError(409, "DUPLICATE_CLIENT", `A client with this phone already exists: ${d.fullName} (${d.code})`, { clientId: d.id });
}

async function checkRefs(tx: Tx, ctx: Ctx, tenantId: string, branchId: string | null | undefined, ownerId: string | null | undefined) {
  if (branchId) {
    if (!(await tx.branch.findFirst({ where: { id: branchId, tenantId } }))) throw badRequest("Branch not found");
    assertBranchAccess(ctx, branchId);
  }
  if (ownerId && !(await tx.user.findFirst({ where: { id: ownerId, tenantId } }))) throw badRequest("Responsible staff not found");
}

export type ClientQuery = {
  search?: string; status?: string; source?: string; tag?: string; branchId?: string; category?: string; ownerId?: string;
  page?: number; pageSize?: number; sort?: "recent" | "name" | "lastVisit";
};

export function buildClientWhere(ctx: Ctx, tenantId: string, q: ClientQuery): Prisma.ClientWhereInput {
  const where: Prisma.ClientWhereInput = { tenantId, deletedAt: null, ...recordBranchScope(ctx) };
  const s = q.search?.trim();
  if (s) {
    const digits = normalizePhone(s);
    where.OR = [
      { fullName: { contains: s, mode: "insensitive" } },
      { code: { equals: s.toUpperCase() } },
      { email: { contains: s, mode: "insensitive" } },
      ...(digits.length >= 3 ? [{ phoneNormalized: { contains: digits.replace(/^0+/, "") } }] : []),
    ];
  }
  if (q.status && ["LEAD", "ACTIVE", "INACTIVE", "BLOCKED"].includes(q.status)) where.status = q.status as never;
  if (q.source) where.source = q.source;
  if (q.category) where.category = q.category;
  if (q.tag) where.tags = { has: q.tag };
  if (q.ownerId) where.ownerId = q.ownerId;
  if (q.branchId) where.AND = [{ branchId: q.branchId }];
  return where;
}

export async function listClients(ctx: Ctx, q: ClientQuery = {}) {
  const tenantId = requireTenant(ctx, "clients.view");
  const pageSize = Math.min(Math.max(q.pageSize ?? 25, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const where = buildClientWhere(ctx, tenantId, q);
  const orderBy: Prisma.ClientOrderByWithRelationInput =
    q.sort === "name" ? { fullName: "asc" } : q.sort === "lastVisit" ? { lastVisitAt: { sort: "desc", nulls: "last" } } : { createdAt: "desc" };
  return withTenant(tenantId, async (tx) => {
    const [items, total] = await Promise.all([
      tx.client.findMany({ where, select: listSelect, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      tx.client.count({ where }),
    ]);
    return { items, total, page, pageSize };
  });
}

/** Lightweight lookup for booking forms / POS. */
export async function quickSearchClients(ctx: Ctx, search: string) {
  const tenantId = requireTenant(ctx, "clients.view");
  if (search.trim().length < 2) return [];
  return withTenant(tenantId, (tx) =>
    tx.client.findMany({
      where: buildClientWhere(ctx, tenantId, { search }),
      select: { id: true, code: true, fullName: true, phone: true, branchId: true, status: true },
      take: 10, orderBy: { lastVisitAt: { sort: "desc", nulls: "last" } },
    }),
  );
}

export async function getClient(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "clients.view");
  return withTenant(tenantId, async (tx) => {
    const c = await tx.client.findFirst({
      where: liveClient(ctx, tenantId, id),
      include: { branch: { select: { id: true, name: true } }, owner: { select: { id: true, fullName: true } } },
    });
    if (!c) throw notFound("Client not found");
    const [byStatus, nextAppt] = await Promise.all([
      tx.appointment.groupBy({ by: ["status"], where: { tenantId, clientId: id }, _count: true }),
      tx.appointment.findFirst({
        where: { tenantId, clientId: id, startsAt: { gte: new Date() }, status: { in: ["SCHEDULED", "CONFIRMED"] } },
        orderBy: { startsAt: "asc" }, include: { service: { select: { name: true } }, staff: { select: { fullName: true } } },
      }),
    ]);
    const counts = Object.fromEntries(byStatus.map((b) => [b.status, b._count]));
    return { ...c, stats: { completed: counts.COMPLETED ?? 0, cancelled: counts.CANCELLED ?? 0, noShow: counts.NO_SHOW ?? 0, total: byStatus.reduce((s, b) => s + b._count, 0) }, nextAppointment: nextAppt };
  });
}

export async function createClient(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "clients.create");
  const input = createClientSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await checkRefs(tx, ctx, tenantId, input.branchId, input.ownerId);
    const phoneNormalized = normalizePhone(input.phone);
    const dup = await findDuplicate(tx, tenantId, phoneNormalized);
    if (dup) throw duplicateError(dup);
    const code = `C-${String(await nextCounter(tx, tenantId, "client")).padStart(6, "0")}`;
    const c = await tx.client.create({
      data: {
        ...input, tenantId, code, phoneNormalized,
        branchId: input.branchId ?? (await defaultBranchId(tx, ctx, tenantId)),
        createdById: ctx.user.id,
        interactions: { create: { tenantId, type: "SYSTEM", content: input.status === "LEAD" ? "lead.created" : "client.created", userId: ctx.user.id } },
      },
      select: listSelect,
    });
    await audit(tx, ctx, { action: "client.create", entity: "Client", entityId: c.id, after: c });
    return c;
  });
}

export async function updateClient(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "clients.update");
  const input = updateClientSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.client.findFirst({ where: liveClient(ctx, tenantId, id) });
    if (!before) throw notFound("Client not found");
    await checkRefs(tx, ctx, tenantId, input.branchId, input.ownerId);
    const { branchId: newBranch, ...rest } = input;
    const data: Prisma.ClientUncheckedUpdateInput = { ...rest, ...(newBranch ? { branchId: newBranch } : {}) };
    if (input.phone) {
      data.phoneNormalized = normalizePhone(input.phone);
      const dup = await findDuplicate(tx, tenantId, data.phoneNormalized as string, id);
      if (dup) throw duplicateError(dup);
    }
    const converting = before.status === "LEAD" && input.status && input.status !== "LEAD";
    if (converting) data.convertedAt = new Date();
    const after = await tx.client.update({ where: { id }, data, select: listSelect });
    if (converting) await tx.clientInteraction.create({ data: { tenantId, clientId: id, type: "SYSTEM", content: "lead.converted", userId: ctx.user.id } });
    if (input.branchId && input.branchId !== before.branchId) {
      await tx.clientInteraction.create({ data: { tenantId, clientId: id, type: "SYSTEM", content: `client.branch_transfer:${after.branch.name}`, userId: ctx.user.id } });
    }
    await audit(tx, ctx, { action: converting ? "client.convert" : "client.update", entity: "Client", entityId: id, before, after });
    return after;
  });
}

export async function deleteClient(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "clients.delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.client.findFirst({ where: liveClient(ctx, tenantId, id) });
    if (!before) throw notFound("Client not found");
    // Soft delete keeps medical & visit history for legal retention.
    await tx.client.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.appointment.updateMany({
      where: { tenantId, clientId: id, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gte: new Date() } },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "client deleted" },
    });
    await audit(tx, ctx, { action: "client.delete", entity: "Client", entityId: id, before });
    return { ok: true };
  });
}

// --------------------------------------------------------- interactions ----

export const interactionSchema = z.object({
  type: z.enum(["NOTE", "CALL", "WHATSAPP", "EMAIL", "VISIT"]),
  content: z.string().trim().min(1).max(4000),
});

export async function listInteractions(ctx: Ctx, clientId: string) {
  const tenantId = requireTenant(ctx, "clients.view");
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.client.findFirst({ where: liveClient(ctx, tenantId, clientId), select: { id: true } }))) throw notFound("Client not found");
    return tx.clientInteraction.findMany({
      where: { tenantId, clientId }, orderBy: { createdAt: "desc" }, take: 200,
      include: { user: { select: { fullName: true } } },
    });
  });
}

export async function addInteraction(ctx: Ctx, clientId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "clients.update");
  const input = interactionSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.client.findFirst({ where: liveClient(ctx, tenantId, clientId), select: { id: true } }))) throw notFound("Client not found");
    return tx.clientInteraction.create({ data: { ...input, tenantId, clientId, userId: ctx.user.id }, include: { user: { select: { fullName: true } } } });
  });
}

// --------------------------------------------------------------- tags ----

export async function listTags(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "clients.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<{ tag: string; n: bigint }[]>`
      SELECT t AS tag, COUNT(*) AS n FROM "Client", unnest("tags") AS t
      WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL GROUP BY t ORDER BY n DESC LIMIT 100`;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.n) }));
  });
}

// ------------------------------------------------------ import / export ----

export async function importClients(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "clients.create");
  const rows = z.array(z.record(z.unknown())).min(1).max(2000).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const fallbackBranch = await defaultBranchId(tx, ctx, tenantId);
    const result = { created: 0, skipped: [] as { row: number; reason: string }[] };
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const parsed = createClientSchema.safeParse({
        ...r, tags: typeof r.tags === "string" ? r.tags.split(/[;|,]/).map((t) => t.trim()).filter(Boolean) : r.tags ?? [],
        branchId: null, ownerId: null,
      });
      if (!parsed.success) {
        result.skipped.push({ row: i + 2, reason: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
        continue;
      }
      const phoneNormalized = normalizePhone(parsed.data.phone);
      const key = phoneKey(phoneNormalized);
      if (seen.has(key) || (await findDuplicate(tx, tenantId, phoneNormalized))) {
        result.skipped.push({ row: i + 2, reason: "duplicate phone" });
        continue;
      }
      seen.add(key);
      const code = `C-${String(await nextCounter(tx, tenantId, "client")).padStart(6, "0")}`;
      await tx.client.create({
        data: { ...parsed.data, tenantId, code, phoneNormalized, branchId: fallbackBranch, ownerId: null, createdById: ctx.user.id,
          interactions: { create: { tenantId, type: "SYSTEM", content: "client.imported", userId: ctx.user.id } } },
      });
      result.created++;
    }
    await audit(tx, ctx, { action: "client.import", entity: "Client", after: { created: result.created, skipped: result.skipped.length } });
    return result;
  });
}

export async function exportClients(ctx: Ctx, q: ClientQuery) {
  const tenantId = requireTenant(ctx, "clients.export");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.client.findMany({
      where: buildClientWhere(ctx, tenantId, q), take: 50000, orderBy: { createdAt: "asc" },
      include: { branch: { select: { name: true } }, owner: { select: { fullName: true } } },
    });
    await audit(tx, ctx, { action: "client.export", entity: "Client", after: { count: rows.length, filter: q } });
    return rows;
  });
}

// ---------------------------------------------------------------- merge ----

/** Moves everything from `sourceId` into `targetId`, then soft-deletes the source. */
export async function mergeClients(ctx: Ctx, targetId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "clients.merge");
  const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(raw);
  if (sourceId === targetId) throw badRequest("Cannot merge a client into itself");
  return withTenant(tenantId, async (tx) => {
    const [target, source] = await Promise.all([
      tx.client.findFirst({ where: liveClient(ctx, tenantId, targetId), include: { medicalRecord: true } }),
      tx.client.findFirst({ where: liveClient(ctx, tenantId, sourceId), include: { medicalRecord: true } }),
    ]);
    if (!target || !source) throw notFound("Client not found");

    const move = { where: { tenantId, clientId: sourceId }, data: { clientId: targetId } };
    const [appts, inter, entries, files, wait] = await Promise.all([
      tx.appointment.updateMany(move), tx.clientInteraction.updateMany(move), tx.medicalEntry.updateMany(move),
      tx.fileObject.updateMany(move), tx.waitlistEntry.updateMany(move),
    ]);
    // Medical profile: keep target's, append source's non-empty fields.
    if (source.medicalRecord) {
      const s = source.medicalRecord;
      if (!target.medicalRecord) {
        await tx.medicalRecord.update({ where: { clientId: sourceId }, data: { clientId: targetId } });
      } else {
        const t = target.medicalRecord;
        const join = (a: string | null, b: string | null) => (b && b !== a ? [a, b].filter(Boolean).join("\n— ") : a);
        await tx.medicalRecord.update({
          where: { clientId: targetId },
          data: {
            allergies: join(t.allergies, s.allergies), currentMedications: join(t.currentMedications, s.currentMedications),
            chronicConditions: join(t.chronicConditions, s.chronicConditions), pastSurgeries: join(t.pastSurgeries, s.pastSurgeries),
            medicalHistory: join(t.medicalHistory, s.medicalHistory), familyHistory: join(t.familyHistory, s.familyHistory),
            notes: join(t.notes, s.notes), bloodType: t.bloodType ?? s.bloodType,
          },
        });
        await tx.medicalRecord.delete({ where: { clientId: sourceId } });
      }
    }
    await tx.client.update({
      where: { id: targetId },
      data: {
        tags: [...new Set([...target.tags, ...source.tags])],
        email: target.email ?? source.email, birthDate: target.birthDate ?? source.birthDate, gender: target.gender ?? source.gender,
        address: target.address ?? source.address,
        notes: [target.notes, source.notes].filter(Boolean).join("\n") || null,
        lastVisitAt: [target.lastVisitAt, source.lastVisitAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null,
      },
    });
    await tx.client.update({ where: { id: sourceId }, data: { deletedAt: new Date(), notes: `merged into ${target.code}` } });
    await tx.clientInteraction.create({ data: { tenantId, clientId: targetId, type: "SYSTEM", content: `client.merged:${source.code}`, userId: ctx.user.id } });
    const moved = { appointments: appts.count, interactions: inter.count, medicalEntries: entries.count, files: files.count, waitlist: wait.count };
    await audit(tx, ctx, { action: "client.merge", entity: "Client", entityId: targetId, before: { source: source.code }, after: moved });
    return { ok: true, moved };
  });
}

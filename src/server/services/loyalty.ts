/** Loyalty points: ledger (earn/redeem/adjust/reverse), tiers, balances. */
import { z } from "zod";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { recordBranchScope, requireClient } from "./common";
import { D } from "./money";
import { settingsTx } from "./settings";

export async function balanceOf(tx: Tx, tenantId: string, clientId: string) {
  const [bal, life] = await Promise.all([
    tx.loyaltyTransaction.aggregate({ where: { tenantId, clientId }, _sum: { points: true } }),
    tx.loyaltyTransaction.aggregate({ where: { tenantId, clientId, type: { in: ["EARN"] } }, _sum: { points: true } }),
  ]);
  return { balance: bal._sum.points ?? 0, lifetime: life._sum.points ?? 0 };
}

export async function tierFor(tx: Tx, tenantId: string, lifetime: number) {
  const tiers = await tx.loyaltyTier.findMany({ where: { tenantId }, orderBy: { minPoints: "desc" } });
  return tiers.find((t) => lifetime >= t.minPoints) ?? null;
}

/** Earn points for a paid invoice (called from billing). */
export async function earnForInvoice(tx: Tx, tenantId: string, inv: { id: string; clientId: string | null; total: { toString(): string } }, userId: string) {
  if (!inv.clientId) return 0;
  const s = await settingsTx(tx, tenantId);
  if (!s.loyaltyEnabled || D(s.pointsPerUnit).isZero()) return 0;
  if (await tx.loyaltyTransaction.findFirst({ where: { tenantId, invoiceId: inv.id, type: "EARN" } })) return 0; // idempotent
  const { lifetime } = await balanceOf(tx, tenantId, inv.clientId);
  const tier = await tierFor(tx, tenantId, lifetime);
  const points = D(inv.total.toString()).times(s.pointsPerUnit).times(tier?.multiplier ?? 1).floor().toNumber();
  if (points <= 0) return 0;
  await tx.loyaltyTransaction.create({ data: { tenantId, clientId: inv.clientId, type: "EARN", points, invoiceId: inv.id, createdById: userId, note: tier ? `tier:${tier.name}` : null } });
  return points;
}

/** Points → money for redemption, with all checks. */
export async function redemptionValue(tx: Tx, tenantId: string, clientId: string | null, points: number) {
  if (!points) return D(0);
  if (!clientId) throw badRequest("Select a client to redeem points");
  const s = await settingsTx(tx, tenantId);
  if (!s.loyaltyEnabled || D(s.pointValue).isZero()) throw conflict("Loyalty redemption is not enabled");
  if (points < s.minRedeemPoints) throw conflict(`Minimum redemption is ${s.minRedeemPoints} points`);
  const { balance } = await balanceOf(tx, tenantId, clientId);
  if (points > balance) throw conflict(`Client has only ${balance} points`);
  return D(points).times(s.pointValue);
}

/** Reverse part (ratio 0..1) of what an invoice earned / give back what it redeemed. */
export async function reverseForInvoice(tx: Tx, tenantId: string, invoiceId: string, ratio: number, opts: { restoreRedeemed: boolean }, userId: string) {
  const txns = await tx.loyaltyTransaction.findMany({ where: { tenantId, invoiceId } });
  const earned = txns.filter((t) => t.type === "EARN").reduce((s, t) => s + t.points, 0);
  const reversedEarn = txns.filter((t) => t.type === "REVERSE" && t.points < 0).reduce((s, t) => s - t.points, 0);
  const clientId = txns[0]?.clientId;
  if (!clientId) return;
  const take = Math.min(earned - reversedEarn, Math.round(earned * ratio));
  if (take > 0) await tx.loyaltyTransaction.create({ data: { tenantId, clientId, type: "REVERSE", points: -take, invoiceId, createdById: userId, note: "refund/cancel" } });
  if (opts.restoreRedeemed) {
    const redeemed = -txns.filter((t) => t.type === "REDEEM").reduce((s, t) => s + t.points, 0);
    const restored = txns.filter((t) => t.type === "REVERSE" && t.points > 0).reduce((s, t) => s + t.points, 0);
    if (redeemed - restored > 0) await tx.loyaltyTransaction.create({ data: { tenantId, clientId, type: "REVERSE", points: redeemed - restored, invoiceId, createdById: userId, note: "redeemed points returned" } });
  }
}

// ------------------------------------------------------------------ API ----

export async function clientLoyalty(ctx: Ctx, clientId: string) {
  const tenantId = requireTenant(ctx, "loyalty.view");
  return withTenant(tenantId, async (tx) => {
    await requireClient(tx, ctx, tenantId, clientId);
    const b = await balanceOf(tx, tenantId, clientId);
    const tier = await tierFor(tx, tenantId, b.lifetime);
    const s = await settingsTx(tx, tenantId);
    const history = await tx.loyaltyTransaction.findMany({ where: { tenantId, clientId }, orderBy: { createdAt: "desc" }, take: 200 });
    return { ...b, tier, value: D(b.balance).times(s.pointValue), minRedeemPoints: s.minRedeemPoints, pointValue: s.pointValue, history };
  });
}

export async function adjustPoints(ctx: Ctx, clientId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "loyalty.update");
  const d = z.object({ points: z.coerce.number().int().refine((n) => n !== 0, "Points can't be 0").refine((n) => Math.abs(n) <= 1e7), note: z.string().trim().min(2).max(300) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    await requireClient(tx, ctx, tenantId, clientId);
    if (d.points < 0) {
      const { balance } = await balanceOf(tx, tenantId, clientId);
      if (balance + d.points < 0) throw conflict("Balance can't go negative");
    }
    const t = await tx.loyaltyTransaction.create({ data: { tenantId, clientId, type: "ADJUST", points: d.points, note: d.note, createdById: ctx.user.id } });
    await audit(tx, ctx, { action: "loyalty.adjust", entity: "LoyaltyTransaction", entityId: t.id, after: t });
    return t;
  });
}

/** Top clients by balance, with tier. */
export async function loyaltyOverview(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "loyalty.view");
  return withTenant(tenantId, async (tx) => {
    const scope = recordBranchScope(ctx);
    const rows = await tx.$queryRaw<{ clientId: string; balance: bigint; lifetime: bigint }[]>`
      SELECT "clientId", SUM(points) AS balance, SUM(points) FILTER (WHERE type = 'EARN') AS lifetime
      FROM "LoyaltyTransaction" WHERE "tenantId" = ${tenantId}::uuid GROUP BY "clientId" ORDER BY balance DESC LIMIT 300`;
    const clients = await tx.client.findMany({ where: { tenantId, id: { in: rows.map((r) => r.clientId) }, deletedAt: null, ...scope }, select: { id: true, code: true, fullName: true, phone: true } });
    const tiers = await tx.loyaltyTier.findMany({ where: { tenantId }, orderBy: { minPoints: "desc" } });
    const totals = rows.reduce((a, r) => ({ outstanding: a.outstanding + Number(r.balance), issued: a.issued + Number(r.lifetime ?? 0) }), { outstanding: 0, issued: 0 });
    return {
      totals,
      clients: rows.map((r) => {
        const c = clients.find((x) => x.id === r.clientId);
        if (!c) return null;
        const lifetime = Number(r.lifetime ?? 0);
        return { ...c, balance: Number(r.balance), lifetime, tier: tiers.find((t) => lifetime >= t.minPoints) ?? null };
      }).filter(Boolean),
    };
  });
}

export const tierSchema = z.object({
  name: z.string().trim().min(2).max(60), nameEn: z.string().trim().max(60).optional().nullable().transform((v) => v || null),
  minPoints: z.coerce.number().int().min(0), multiplier: z.coerce.number().min(0.1).max(10),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable().or(z.literal("").transform(() => null)),
});

export async function listTiers(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "loyalty.view");
  return withTenant(tenantId, (tx) => tx.loyaltyTier.findMany({ where: { tenantId }, orderBy: { minPoints: "asc" } }));
}
export async function saveTier(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "loyalty.update" : "loyalty.create");
  const d = tierSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (id && !(await tx.loyaltyTier.findFirst({ where: { id, tenantId } }))) throw notFound("Tier not found");
    const t = id ? await tx.loyaltyTier.update({ where: { id }, data: d }) : await tx.loyaltyTier.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "loyalty.tier.update" : "loyalty.tier.create", entity: "LoyaltyTier", entityId: t.id, after: t });
    return t;
  });
}
export async function deleteTier(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "loyalty.delete");
  return withTenant(tenantId, async (tx) => {
    const t = await tx.loyaltyTier.findFirst({ where: { id, tenantId } });
    if (!t) throw notFound("Tier not found");
    await tx.loyaltyTier.delete({ where: { id } });
    await audit(tx, ctx, { action: "loyalty.tier.delete", entity: "LoyaltyTier", entityId: id, before: t });
    return { ok: true };
  });
}

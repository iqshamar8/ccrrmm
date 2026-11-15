/**
 * Marketing: audiences (segments), campaigns with attribution & ROI, offers,
 * influencers with referral commissions, and follow-up worklists.
 *
 * Campaign attribution: a recipient converts when they book an appointment or
 * get an invoice within `attributionDays` of the send; revenue = their
 * non-cancelled invoices in that window. ROI = (revenue − budget) / budget.
 * Influencer commission: invoices of a referred client within the
 * influencer's attributionDays (from the client joining), or any invoice using
 * the influencer's coupon — earned when the invoice is fully PAID, reversed
 * pro-rata on refunds, voided on cancellation; paying posts Dr Marketing / Cr cash.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { cashAccountFor, cr, dr, postEntry } from "./accounting";
import { ACTIVE_APPT, nextCounter, optText, recordBranchScope, uuidOpt } from "./common";
import { dispatchQueued, queueMessage } from "./messaging";
import { applyRate, D, r2, sum, ZERO } from "./money";

const DAY = 86400000;
const uuids = z.array(z.string().uuid()).max(500).default([]);

// ------------------------------------------------------------- segments ----

export const filterSchema = z.object({
  statuses: z.array(z.enum(["LEAD", "ACTIVE", "INACTIVE"])).max(3).default(["ACTIVE"]),
  sources: z.array(z.string().max(40)).max(30).default([]),
  tags: z.array(z.string().max(40)).max(30).default([]),
  categories: z.array(z.string().max(40)).max(10).default([]),
  gender: z.enum(["MALE", "FEMALE"]).optional().nullable().or(z.literal("").transform(() => null)),
  branchIds: uuids,
  ageMin: z.coerce.number().int().min(0).max(120).optional().nullable(),
  ageMax: z.coerce.number().int().min(0).max(120).optional().nullable(),
  /** inactive: no visit for at least N days (or never visited and joined N days ago) */
  lastVisitOlderThanDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  visitedWithinDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  /** completed at least one of these services */
  serviceIds: uuids,
  minSpend: z.coerce.number().min(0).optional().nullable(),
  birthdayThisMonth: z.boolean().default(false),
  incompleteProgram: z.boolean().default(false),
  subscriptionExpiringDays: z.coerce.number().int().min(1).max(365).optional().nullable(),
  influencerId: uuidOpt.optional(),
  corporateOnly: z.boolean().default(false),
}).partial().transform((f) => ({ statuses: ["ACTIVE"] as ("LEAD" | "ACTIVE" | "INACTIVE")[], sources: [] as string[], tags: [] as string[], categories: [] as string[], branchIds: [] as string[], serviceIds: [] as string[], ...f }));
export type Filter = z.infer<typeof filterSchema>;

/** Prisma where for a client audience. Marketing audiences never include opted-out or deleted clients. */
export async function audienceWhere(tx: Tx, ctx: Ctx, tenantId: string, f: Filter): Promise<Prisma.ClientWhereInput> {
  const now = new Date();
  const and: Prisma.ClientWhereInput[] = [{ tenantId, deletedAt: null, marketingOptOut: false, status: { in: f.statuses?.length ? f.statuses : ["ACTIVE"] } }];
  const scope = recordBranchScope(ctx);
  if (scope.branchId) and.push(scope);
  if (f.branchIds?.length) and.push({ branchId: { in: f.branchIds } });
  if (f.sources?.length) and.push({ source: { in: f.sources } });
  if (f.tags?.length) and.push({ tags: { hasSome: f.tags } });
  if (f.categories?.length) and.push({ category: { in: f.categories } });
  if (f.gender) and.push({ gender: f.gender });
  if (f.ageMin) and.push({ birthDate: { lte: new Date(now.getFullYear() - f.ageMin, now.getMonth(), now.getDate()) } });
  if (f.ageMax) and.push({ birthDate: { gt: new Date(now.getFullYear() - f.ageMax - 1, now.getMonth(), now.getDate()) } });
  if (f.lastVisitOlderThanDays) {
    const t = new Date(+now - f.lastVisitOlderThanDays * DAY);
    and.push({ OR: [{ lastVisitAt: { lt: t } }, { lastVisitAt: null, createdAt: { lt: t } }] });
  }
  if (f.visitedWithinDays) and.push({ lastVisitAt: { gte: new Date(+now - f.visitedWithinDays * DAY) } });
  if (f.serviceIds?.length) and.push({ appointments: { some: { serviceId: { in: f.serviceIds }, status: "COMPLETED" } } });
  if (f.influencerId) and.push({ influencerId: f.influencerId });
  if (f.corporateOnly) and.push({ corporate: { some: {} } });
  if (f.incompleteProgram) and.push({ programs: { some: { status: { in: ["ACTIVE", "PAUSED"] } } } });
  if (f.subscriptionExpiringDays) and.push({ subscriptions: { some: { status: "ACTIVE", endDate: { gte: now, lte: new Date(+now + f.subscriptionExpiringDays * DAY) } } } });
  if (f.birthdayThisMonth) {
    const ids = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Client" WHERE "tenantId" = ${tenantId}::uuid AND "birthDate" IS NOT NULL AND EXTRACT(MONTH FROM "birthDate") = ${now.getMonth() + 1}`;
    and.push({ id: { in: ids.map((x) => x.id) } });
  }
  if (f.minSpend) {
    const rows = await tx.invoice.groupBy({ by: ["clientId"], where: { tenantId, clientId: { not: null }, status: { notIn: ["DRAFT", "CANCELLED"] } }, _sum: { paidTotal: true }, having: { paidTotal: { _sum: { gte: f.minSpend } } } });
    and.push({ id: { in: rows.map((r) => r.clientId!) } });
  }
  return { AND: and };
}

export async function previewAudience(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "marketing.view");
  const f = filterSchema.parse(raw ?? {});
  return withTenant(tenantId, async (tx) => {
    const where = await audienceWhere(tx, ctx, tenantId, f);
    const [count, sample] = await Promise.all([
      tx.client.count({ where }),
      tx.client.findMany({ where, take: 15, orderBy: { lastVisitAt: { sort: "desc", nulls: "last" } }, select: { id: true, code: true, fullName: true, phone: true, lastVisitAt: true, source: true } }),
    ]);
    return { count, sample };
  });
}

const segmentSchema = z.object({ name: z.string().trim().min(2).max(120), description: optText(500), filter: filterSchema });

export async function listSegments(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "marketing.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.segment.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { campaigns: true } } } });
    const out = [];
    for (const s of rows) out.push({ ...s, size: await tx.client.count({ where: await audienceWhere(tx, ctx, tenantId, filterSchema.parse(s.filter)) }) });
    return out;
  });
}

export async function saveSegment(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "marketing.update" : "marketing.create");
  const d = segmentSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (id && !(await tx.segment.findFirst({ where: { id, tenantId } }))) throw notFound("Segment not found");
    const data = { name: d.name, description: d.description, filter: d.filter as Prisma.InputJsonValue };
    const s = id ? await tx.segment.update({ where: { id }, data }) : await tx.segment.create({ data: { ...data, tenantId, createdById: ctx.user.id } });
    await audit(tx, ctx, { action: id ? "segment.update" : "segment.create", entity: "Segment", entityId: s.id, after: s });
    return s;
  });
}

export async function deleteSegment(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "marketing.delete");
  return withTenant(tenantId, async (tx) => {
    const s = await tx.segment.findFirst({ where: { id, tenantId } });
    if (!s) throw notFound("Segment not found");
    await tx.segment.delete({ where: { id } });
    await audit(tx, ctx, { action: "segment.delete", entity: "Segment", entityId: id, before: s });
    return { ok: true };
  });
}

// ------------------------------------------------------------ campaigns ----

export const OBJECTIVES = ["PROMOTION", "REACTIVATION", "REMINDER", "AWARENESS", "EVENT"] as const;
export const campaignSchema = z.object({
  name: z.string().trim().min(2).max(160), objective: z.enum(OBJECTIVES).default("PROMOTION"),
  segmentId: uuidOpt, filter: filterSchema.optional(),
  templateId: uuidOpt, body: optText(1024), couponId: uuidOpt, offerId: uuidOpt,
  budget: z.coerce.number().min(0).max(1e12).default(0), attributionDays: z.coerce.number().int().min(1).max(365).default(30), notes: optText(1000),
});

type Stats = { recipients: number; sent: number; delivered: number; read: number; failed: number; queued: number; converted: number; bookings: number; revenue: Prisma.Decimal; newClients: number; redemptions: number; roi: number | null };

async function campaignStats(tx: Tx, tenantId: string, c: { id: string; sentAt: Date | null; attributionDays: number; couponId: string | null; budget: Prisma.Decimal }): Promise<Stats> {
  const st = await tx.message.groupBy({ by: ["status"], where: { tenantId, campaignId: c.id }, _count: true });
  const n = (s: string[]) => st.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count, 0);
  const out: Stats = { recipients: n(["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED"]), sent: n(["SENT", "DELIVERED", "READ"]), delivered: n(["DELIVERED", "READ"]), read: n(["READ"]), failed: n(["FAILED"]), queued: n(["QUEUED", "SENDING"]), converted: 0, bookings: 0, revenue: ZERO, newClients: 0, redemptions: 0, roi: null };
  out.newClients = await tx.client.count({ where: { tenantId, campaignId: c.id, deletedAt: null } });
  if (c.sentAt) {
    const win = { gte: c.sentAt, lt: new Date(+c.sentAt + c.attributionDays * DAY) };
    const recips = (await tx.message.findMany({ where: { tenantId, campaignId: c.id, status: { in: ["SENT", "DELIVERED", "READ"] }, clientId: { not: null } }, select: { clientId: true } })).map((m) => m.clientId!);
    const ids = [...new Set(recips)];
    if (ids.length) {
      const [appts, invs] = await Promise.all([
        tx.appointment.findMany({ where: { tenantId, clientId: { in: ids }, createdAt: win, status: { notIn: ["CANCELLED"] } }, select: { clientId: true } }),
        tx.invoice.findMany({ where: { tenantId, clientId: { in: ids }, issuedAt: win, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { clientId: true, total: true, refundedTotal: true } }),
      ]);
      out.bookings = appts.length;
      out.converted = new Set([...appts.map((a) => a.clientId), ...invs.map((i) => i.clientId)]).size;
      out.revenue = r2(sum(invs.map((i) => D(i.total).minus(i.refundedTotal))));
    }
    if (c.couponId) out.redemptions = await tx.couponRedemption.count({ where: { tenantId, couponId: c.couponId, createdAt: win } });
  }
  out.roi = c.sentAt && c.sentAt <= new Date() && D(c.budget).greaterThan(0) ? Math.round(out.revenue.minus(c.budget).dividedBy(c.budget).toNumber() * 1000) / 10 : null;
  return out;
}

export async function listCampaigns(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "marketing.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.campaign.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 200, include: { segment: { select: { name: true } }, coupon: { select: { code: true } } } });
    const out = [];
    for (const c of rows) out.push({ ...c, stats: await campaignStats(tx, tenantId, c) });
    return out;
  });
}

export async function getCampaign(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "marketing.view");
  return withTenant(tenantId, async (tx) => {
    const c = await tx.campaign.findFirst({ where: { id, tenantId }, include: { segment: true, template: true, coupon: { select: { id: true, code: true, name: true } }, offer: { select: { id: true, title: true } } } });
    if (!c) throw notFound("Campaign not found");
    const recipients = await tx.message.findMany({ where: { tenantId, campaignId: id }, orderBy: { createdAt: "desc" }, take: 200, include: { client: { select: { id: true, fullName: true, code: true } } } });
    return { ...c, stats: await campaignStats(tx, tenantId, c), recipients };
  });
}

export async function saveCampaign(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "marketing.update" : "marketing.create");
  const d = campaignSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = id ? await tx.campaign.findFirst({ where: { id, tenantId } }) : null;
    if (id && !before) throw notFound("Campaign not found");
    if (before && before.status !== "DRAFT") {
      // After launch only budget / notes / attribution can change (results depend on what was sent).
      const c = await tx.campaign.update({ where: { id: id! }, data: { budget: d.budget, notes: d.notes, attributionDays: d.attributionDays, name: d.name } });
      await audit(tx, ctx, { action: "campaign.update", entity: "Campaign", entityId: c.id, before, after: c });
      return c;
    }
    let filter = d.filter ?? null;
    if (d.segmentId) {
      const s = await tx.segment.findFirst({ where: { id: d.segmentId, tenantId } });
      if (!s) throw badRequest("Segment not found");
      filter = filterSchema.parse(s.filter);
    }
    const data = {
      name: d.name, objective: d.objective, segmentId: d.segmentId, filter: (filter ?? {}) as Prisma.InputJsonValue, templateId: d.templateId, body: d.body,
      couponId: d.couponId, offerId: d.offerId, budget: d.budget, attributionDays: d.attributionDays, notes: d.notes,
    };
    const c = id ? await tx.campaign.update({ where: { id }, data })
      : await tx.campaign.create({ data: { ...data, tenantId, code: `CMP-${String(await nextCounter(tx, tenantId, "campaign")).padStart(4, "0")}`, createdById: ctx.user.id } });
    await audit(tx, ctx, { action: id ? "campaign.update" : "campaign.create", entity: "Campaign", entityId: c.id, before, after: c });
    return c;
  });
}

/** Resolves the audience and queues one message per recipient (now or at scheduledAt). */
export async function launchCampaign(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "marketing.update");
  const { scheduledAt } = z.object({ scheduledAt: z.coerce.date().optional().nullable() }).parse(raw ?? {});
  if (!ctx.features.has("notifications")) throw badRequest("Sending needs the Notifications module in your plan");
  const res = await withTenant(tenantId, async (tx) => {
    const c = await tx.campaign.findFirst({ where: { id, tenantId }, include: { coupon: true, offer: true } });
    if (!c) throw notFound("Campaign not found");
    if (c.status !== "DRAFT") throw conflict("Campaign was already launched");
    if (!c.templateId && !c.body) throw badRequest("Write the message or choose a template first");
    const where = await audienceWhere(tx, ctx, tenantId, filterSchema.parse(c.filter ?? {}));
    const clients = await tx.client.findMany({ where, take: 20000 });
    if (!clients.length) throw badRequest("The audience is empty");
    const when = scheduledAt && scheduledAt > new Date() ? scheduledAt : new Date();
    const category = c.objective === "REACTIVATION" ? "REACTIVATION" : c.objective === "REMINDER" ? "CUSTOM" : "PROMOTION";
    let queued = 0;
    for (const cl of clients) {
      const m = await queueMessage(tx, tenantId, {
        category, client: cl, templateId: c.templateId, body: c.body, campaignId: c.id, scheduledFor: when, createdById: ctx.user.id, dedupeKey: `camp:${c.id}:${cl.id}`,
        vars: { coupon_code: c.coupon?.code ?? "", offer: c.offer?.title ?? c.name, message: c.body ?? "" },
      });
      if (m) queued++;
    }
    const after = await tx.campaign.update({ where: { id }, data: { status: when > new Date() ? "SCHEDULED" : "SENDING", scheduledAt: when, sentAt: when, recipients: queued } });
    await audit(tx, ctx, { action: "campaign.launch", entity: "Campaign", entityId: id, after: { recipients: queued, scheduledAt: when } });
    return { campaign: after, queued, immediate: when <= new Date() };
  });
  const dispatch = res.immediate ? await dispatchQueued(tenantId, new Date(), 200) : null;
  return { ...res, dispatch };
}

export async function cancelCampaign(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "marketing.update");
  return withTenant(tenantId, async (tx) => {
    const c = await tx.campaign.findFirst({ where: { id, tenantId } });
    if (!c) throw notFound("Campaign not found");
    if (!["DRAFT", "SCHEDULED", "SENDING"].includes(c.status)) throw conflict("Campaign is already finished");
    const r = await tx.message.updateMany({ where: { tenantId, campaignId: id, status: "QUEUED" }, data: { status: "CANCELLED", error: "Campaign cancelled" } });
    const after = await tx.campaign.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, { action: "campaign.cancel", entity: "Campaign", entityId: id, after: { cancelledMessages: r.count } });
    return after;
  });
}

// --------------------------------------------------------------- offers ----

export const offerSchema = z.object({
  title: z.string().trim().min(2).max(160), description: optText(2000), startsAt: z.coerce.date(), endsAt: z.coerce.date(),
  couponId: uuidOpt, serviceIds: uuids, price: z.coerce.number().min(0).optional().nullable(), originalPrice: z.coerce.number().min(0).optional().nullable(), isActive: z.boolean().default(true),
}).refine((o) => o.endsAt >= o.startsAt, { message: "End must be after start", path: ["endsAt"] });

export async function listOffers(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "marketing.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.offer.findMany({ where: { tenantId }, orderBy: [{ isActive: "desc" }, { endsAt: "desc" }], include: { coupon: { select: { code: true, _count: { select: { redemptions: true } } } }, _count: { select: { campaigns: true } } } });
    const svc = await tx.service.findMany({ where: { tenantId, id: { in: rows.flatMap((r) => r.serviceIds) } }, select: { id: true, name: true } });
    return rows.map((o) => ({ ...o, services: svc.filter((s) => o.serviceIds.includes(s.id)) }));
  });
}

export async function saveOffer(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "marketing.update" : "marketing.create");
  const d = offerSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (id && !(await tx.offer.findFirst({ where: { id, tenantId } }))) throw notFound("Offer not found");
    if (d.serviceIds.length && (await tx.service.count({ where: { tenantId, id: { in: d.serviceIds } } })) !== d.serviceIds.length) throw badRequest("Service not found");
    const o = id ? await tx.offer.update({ where: { id }, data: d }) : await tx.offer.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "offer.update" : "offer.create", entity: "Offer", entityId: o.id, after: o });
    return o;
  });
}

// ---------------------------------------------------------- influencers ----

export const influencerSchema = z.object({
  name: z.string().trim().min(2).max(120), handle: optText(80), platform: z.enum(["instagram", "tiktok", "snapchat", "youtube", "facebook", "other"]).optional().nullable(),
  phone: optText(40), email: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  commissionType: z.enum(["NONE", "PERCENT", "FIXED"]).default("PERCENT"), commissionValue: z.coerce.number().min(0).max(1e9).default(0),
  attributionDays: z.coerce.number().int().min(1).max(3650).default(90), notes: optText(1000), isActive: z.boolean().default(true),
}).refine((i) => i.commissionType !== "PERCENT" || i.commissionValue <= 100, { message: "Percent must be ≤ 100", path: ["commissionValue"] });

export async function listInfluencers(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "marketing.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.influencer.findMany({ where: { tenantId }, orderBy: { name: "asc" }, include: { coupons: { select: { id: true, code: true } }, _count: { select: { clients: true } } } });
    const [conv, comm, rev] = await Promise.all([
      tx.client.groupBy({ by: ["influencerId"], where: { tenantId, influencerId: { not: null }, status: "ACTIVE", deletedAt: null }, _count: true }),
      tx.influencerCommission.groupBy({ by: ["influencerId", "status"], where: { tenantId }, _sum: { amount: true } }),
      tx.$queryRaw<{ influencerId: string; revenue: Prisma.Decimal; invoices: bigint }[]>`
        SELECT c."influencerId", SUM(i.total - i."refundedTotal") AS revenue, COUNT(i.id) AS invoices
        FROM "Invoice" i JOIN "Client" c ON c.id = i."clientId"
        WHERE i."tenantId" = ${tenantId}::uuid AND c."influencerId" IS NOT NULL AND i.status NOT IN ('DRAFT','CANCELLED') GROUP BY 1`,
    ]);
    return rows.map((x) => {
      const s = (st: string) => D(comm.find((c) => c.influencerId === x.id && c.status === st)?._sum.amount ?? 0);
      const r = rev.find((v) => v.influencerId === x.id);
      return { ...x, stats: { referred: x._count.clients, converted: conv.find((c) => c.influencerId === x.id)?._count ?? 0, invoices: Number(r?.invoices ?? 0), revenue: D(r?.revenue ?? 0), pending: s("PENDING"), approved: s("APPROVED"), paid: s("PAID") } };
    });
  });
}

export async function getInfluencer(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "marketing.view");
  return withTenant(tenantId, async (tx) => {
    const x = await tx.influencer.findFirst({ where: { id, tenantId }, include: { coupons: { select: { id: true, code: true, name: true } } } });
    if (!x) throw notFound("Influencer not found");
    const [clients, commissions] = await Promise.all([
      tx.client.findMany({ where: { tenantId, influencerId: id, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 300, select: { id: true, code: true, fullName: true, phone: true, status: true, createdAt: true, lastVisitAt: true } }),
      tx.influencerCommission.findMany({ where: { tenantId, influencerId: id }, orderBy: { earnedAt: "desc" }, take: 500 }),
    ]);
    const invoices = await tx.invoice.findMany({ where: { tenantId, id: { in: commissions.map((c) => c.invoiceId!).filter(Boolean) } }, select: { id: true, code: true } });
    return { ...x, clients, commissions: commissions.map((c) => ({ ...c, invoice: invoices.find((i) => i.id === c.invoiceId) ?? null })) };
  });
}

export async function saveInfluencer(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "marketing.update" : "marketing.create");
  const d = influencerSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (id && !(await tx.influencer.findFirst({ where: { id, tenantId } }))) throw notFound("Influencer not found");
    const x = id ? await tx.influencer.update({ where: { id }, data: d }) : await tx.influencer.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "influencer.update" : "influencer.create", entity: "Influencer", entityId: x.id, after: x });
    return x;
  });
}

/** Link coupons to an influencer (their personal codes). */
export async function setInfluencerCoupons(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "marketing.update");
  const { couponIds } = z.object({ couponIds: uuids }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.influencer.findFirst({ where: { id, tenantId } }))) throw notFound("Influencer not found");
    await tx.coupon.updateMany({ where: { tenantId, influencerId: id, id: { notIn: couponIds } }, data: { influencerId: null } });
    if (couponIds.length) await tx.coupon.updateMany({ where: { tenantId, id: { in: couponIds } }, data: { influencerId: id } });
    await audit(tx, ctx, { action: "influencer.coupons", entity: "Influencer", entityId: id, after: { couponIds } });
    return { ok: true };
  });
}

/** On a fully paid invoice: referral (client within window) and/or coupon commission — one per influencer. */
export async function influencerForInvoice(tx: Tx, tenantId: string, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { client: { include: { influencer: true } }, coupon: { include: { influencer: true } } } });
  const base = D(inv.total).minus(inv.taxTotal);
  if (base.lessThanOrEqualTo(0)) return 0;
  const cands: { inf: NonNullable<typeof inv.coupon>["influencer"]; source: string }[] = [];
  const ref = inv.client?.influencer;
  if (ref?.isActive && inv.client && +(inv.issuedAt ?? new Date()) - +inv.client.createdAt <= ref.attributionDays * DAY) cands.push({ inf: ref, source: "REFERRAL" });
  const cp = inv.coupon?.influencer;
  if (cp?.isActive && !cands.some((c) => c.inf!.id === cp.id)) cands.push({ inf: cp, source: "COUPON" });
  let n = 0;
  for (const { inf, source } of cands) {
    if (!inf || inf.commissionType === "NONE") continue;
    const amount = applyRate(inf.commissionType, inf.commissionValue, base, 1);
    if (amount.lessThanOrEqualTo(0)) continue;
    if (await tx.influencerCommission.findFirst({ where: { tenantId, influencerId: inf.id, invoiceId, amount: { gt: 0 } } })) continue;
    await tx.influencerCommission.create({ data: { tenantId, influencerId: inf.id, invoiceId, clientId: inv.clientId, source, baseAmount: base, amount, earnedAt: new Date() } });
    n++;
  }
  return n;
}

export async function reverseInfluencerForInvoice(tx: Tx, tenantId: string, invoiceId: string, ratio: number) {
  const rows = await tx.influencerCommission.findMany({ where: { tenantId, invoiceId, amount: { gt: 0 }, status: { not: "VOID" } } });
  for (const e of rows) {
    if (ratio >= 0.9999 && e.status !== "PAID") { await tx.influencerCommission.update({ where: { id: e.id }, data: { status: "VOID", note: "invoice fully refunded" } }); continue; }
    const amount = r2(D(e.amount).times(ratio)).negated();
    if (!amount.isZero()) await tx.influencerCommission.create({ data: { tenantId, influencerId: e.influencerId, invoiceId, clientId: e.clientId, source: e.source, baseAmount: e.baseAmount, amount, note: `refund reversal (${Math.round(ratio * 100)}%)` } });
  }
}

export async function voidInfluencerForInvoice(tx: Tx, tenantId: string, invoiceId: string) {
  await tx.influencerCommission.updateMany({ where: { tenantId, invoiceId, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "VOID", note: "invoice cancelled" } });
}

/** APPROVE / VOID selected entries, or PAY approved ones from a cash box (posts Dr Marketing / Cr cash). */
export async function influencerCommissionAction(ctx: Ctx, influencerId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "marketing.update");
  const d = z.object({ action: z.enum(["APPROVE", "VOID", "PAY"]), ids: z.array(z.string().uuid()).max(1000).default([]), cashAccountId: uuidOpt, note: optText(200) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const inf = await tx.influencer.findFirst({ where: { id: influencerId, tenantId } });
    if (!inf) throw notFound("Influencer not found");
    if (d.action !== "PAY") {
      const r = await tx.influencerCommission.updateMany({
        where: { tenantId, influencerId, id: { in: d.ids }, status: { in: d.action === "APPROVE" ? ["PENDING"] : ["PENDING", "APPROVED"] } },
        data: d.action === "APPROVE" ? { status: "APPROVED" } : { status: "VOID", note: d.note ?? "voided" },
      });
      await audit(tx, ctx, { action: `influencer.commission.${d.action.toLowerCase()}`, entity: "Influencer", entityId: influencerId, after: { count: r.count } });
      return { updated: r.count };
    }
    if (!ctx.permissions.has("finance.view_data")) throw forbidden("Paying commissions needs access to financial data");
    // Paying settles every approved entry (negative reversals net off).
    const rows = await tx.influencerCommission.findMany({ where: { tenantId, influencerId, status: "APPROVED", ...(d.ids.length ? { id: { in: d.ids } } : {}) } });
    const total = r2(sum(rows.map((r) => D(r.amount))));
    if (total.lessThanOrEqualTo(0)) throw badRequest("Nothing approved to pay");
    const cash = await cashAccountFor(tx, tenantId, { cashAccountId: d.cashAccountId, method: "CASH" });
    const entry = await postEntry(tx, tenantId, {
      date: new Date(), description: `عمولة مؤثر: ${inf.name}`, source: "INFLUENCER", sourceId: inf.id, branchId: cash.branchId, userId: ctx.user.id,
      lines: [dr({ key: "MARKETING", amount: total, description: inf.name }), cr({ accountId: cash.accountId, amount: total })],
    });
    const now = new Date();
    await tx.influencerCommission.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "PAID", paidAt: now, journalEntryId: entry?.id ?? null } });
    await audit(tx, ctx, { action: "influencer.commission.pay", entity: "Influencer", entityId: influencerId, after: { total, entries: rows.length, journal: entry?.code } });
    return { paid: total, entries: rows.length, journal: entry?.code ?? null };
  });
}

export async function addInfluencerAdjustment(ctx: Ctx, influencerId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "marketing.update");
  const d = z.object({ amount: z.coerce.number().refine((n) => n !== 0), note: z.string().trim().min(2).max(200) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.influencer.findFirst({ where: { id: influencerId, tenantId } }))) throw notFound("Influencer not found");
    const e = await tx.influencerCommission.create({ data: { tenantId, influencerId, source: "ADJUSTMENT", baseAmount: 0, amount: d.amount, note: d.note, status: "APPROVED" } });
    await audit(tx, ctx, { action: "influencer.commission.adjust", entity: "InfluencerCommission", entityId: e.id, after: e });
    return e;
  });
}

// ----------------------------------------------------------- follow-ups ----

export const FOLLOWUP_KINDS = ["inactive", "programs", "subscriptions", "leads", "birthdays"] as const;

/** Worklists for the team: who to call / message today. */
export async function followUps(ctx: Ctx, kind: (typeof FOLLOWUP_KINDS)[number], q: { days?: number } = {}) {
  const tenantId = requireTenant(ctx, "clients.view");
  return withTenant(tenantId, async (tx) => {
    const now = new Date();
    const scope = recordBranchScope(ctx);
    const base: Prisma.ClientWhereInput = { tenantId, deletedAt: null, ...scope };
    const lastContact = async (ids: string[]) => {
      const rows = await tx.clientInteraction.groupBy({ by: ["clientId"], where: { tenantId, clientId: { in: ids }, type: { in: ["CALL", "WHATSAPP", "EMAIL", "NOTE"] } }, _max: { createdAt: true } });
      return new Map(rows.map((r) => [r.clientId, r._max.createdAt]));
    };
    const sel = { id: true, code: true, fullName: true, phone: true, lastVisitAt: true, createdAt: true, source: true, marketingOptOut: true } as const;
    if (kind === "inactive") {
      const days = q.days ?? 90;
      const t = new Date(+now - days * DAY);
      const rows = await tx.client.findMany({ where: { ...base, status: "ACTIVE", OR: [{ lastVisitAt: { lt: t } }, { lastVisitAt: null, createdAt: { lt: t } }], appointments: { none: { status: { in: [...ACTIVE_APPT] }, startsAt: { gt: now } } } }, orderBy: { lastVisitAt: { sort: "asc", nulls: "first" } }, take: 300, select: sel });
      const lc = await lastContact(rows.map((r) => r.id));
      return rows.map((r) => ({ ...r, detail: r.lastVisitAt ? Math.floor((+now - +r.lastVisitAt) / DAY) : null, lastContactAt: lc.get(r.id) ?? null }));
    }
    if (kind === "programs") {
      const progs = await tx.clientProgram.findMany({
        where: { tenantId, status: { in: ["ACTIVE", "PAUSED"] }, client: base },
        include: { client: { select: sel }, items: { include: { _count: { select: { sessions: true } }, appointments: { where: { status: { in: [...ACTIVE_APPT] } }, select: { id: true } } } }, sessions: { orderBy: { performedAt: "desc" }, take: 1 } },
        take: 500,
      });
      const rows = progs.map((p) => ({ p, remaining: p.items.reduce((a, i) => a + Math.max(0, i.sessionsTotal - i._count.sessions), 0), booked: p.items.some((i) => i.appointments.length), last: p.sessions[0]?.performedAt ?? null }))
        .filter((x) => x.remaining > 0 && !x.booked).sort((a, b) => +(a.last ?? a.p.startDate) - +(b.last ?? b.p.startDate));
      const lc = await lastContact(rows.map((r) => r.p.clientId));
      return rows.slice(0, 300).map((x) => ({ ...x.p.client, detail: `${x.p.name} · ${x.remaining}`, programId: x.p.id, status: x.p.status, lastSessionAt: x.last, lastContactAt: lc.get(x.p.clientId) ?? null }));
    }
    if (kind === "subscriptions") {
      const days = q.days ?? 14;
      const subs = await tx.clientSubscription.findMany({ where: { tenantId, status: "ACTIVE", endDate: { lte: new Date(+now + days * DAY) }, client: base }, include: { client: { select: sel } }, orderBy: { endDate: "asc" }, take: 300 });
      const lc = await lastContact(subs.map((s) => s.clientId));
      return subs.map((s) => ({ ...s.client, detail: s.name, endDate: s.endDate, subscriptionId: s.id, lastContactAt: lc.get(s.clientId) ?? null }));
    }
    if (kind === "leads") {
      const days = q.days ?? 3;
      const rows = await tx.client.findMany({ where: { ...base, status: "LEAD", createdAt: { lt: new Date(+now - days * DAY) } }, orderBy: { createdAt: "asc" }, take: 300, select: sel });
      const lc = await lastContact(rows.map((r) => r.id));
      return rows.map((r) => ({ ...r, detail: Math.floor((+now - +r.createdAt) / DAY), lastContactAt: lc.get(r.id) ?? null }));
    }
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Client" WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL AND "birthDate" IS NOT NULL
        AND to_char("birthDate", 'MM-DD') BETWEEN to_char(now(), 'MM-DD') AND to_char(now() + interval '7 days', 'MM-DD') LIMIT 300`;
    const rows = await tx.client.findMany({ where: { ...base, id: { in: ids.map((x) => x.id) } }, select: { ...sel, birthDate: true } });
    return rows.map((r) => ({ ...r, detail: r.birthDate, lastContactAt: null }));
  });
}

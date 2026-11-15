/**
 * Corporate contracts: companies, their discount agreements, and the clients
 * (employees / family) who benefit. The discount is applied automatically when
 * an eligible member is invoiced (see billing.build).
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { optText, todayDate } from "./common";
import { D, min, r2, sum } from "./money";

export const companySchema = z.object({
  name: z.string().trim().min(2).max(160), contactName: optText(120), phone: optText(40),
  email: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  address: optText(300), taxNo: optText(60), notes: optText(1000), isActive: z.boolean().default(true),
});
export const agreementSchema = z.object({
  name: z.string().trim().min(2).max(160), startDate: z.coerce.date(), endDate: z.coerce.date(),
  discountPercent: z.coerce.number().positive().max(100), allServices: z.boolean().default(true), serviceIds: z.array(z.string().uuid()).max(500).default([]),
  memberTypes: z.array(z.enum(["EMPLOYEE", "FAMILY"])).min(1).default(["EMPLOYEE"]), allowCoupons: z.boolean().default(false), isActive: z.boolean().default(true), notes: optText(1000),
}).refine((a) => a.endDate >= a.startDate, { message: "End date must be after start", path: ["endDate"] })
  .refine((a) => a.allServices || a.serviceIds.length > 0, { message: "Select covered services", path: ["serviceIds"] });

export async function listCompanies(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "corporate.view");
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.corporateAccount.findMany({ where: { tenantId }, orderBy: { name: "asc" }, include: { _count: { select: { members: true } }, agreements: { orderBy: { endDate: "desc" } } } });
    const usage = await tx.$queryRaw<{ corporateId: string; invoices: bigint; discount: Prisma.Decimal; revenue: Prisma.Decimal }[]>`
      SELECT a."corporateId", COUNT(i.id) AS invoices, SUM(i."corporateDiscount") AS discount, SUM(i.total) AS revenue
      FROM "Invoice" i JOIN "CorporateAgreement" a ON a.id = i."corporateAgreementId"
      WHERE i."tenantId" = ${tenantId}::uuid AND i.status NOT IN ('DRAFT','CANCELLED') GROUP BY a."corporateId"`;
    const today = todayDate();
    return rows.map((c) => {
      const u = usage.find((x) => x.corporateId === c.id);
      return { ...c, activeAgreement: c.agreements.find((a) => a.isActive && a.startDate <= today && a.endDate >= today) ?? null, usage: { invoices: Number(u?.invoices ?? 0), discount: D(u?.discount ?? 0), revenue: D(u?.revenue ?? 0) } };
    });
  });
}

export async function getCompany(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "corporate.view");
  return withTenant(tenantId, async (tx) => {
    const c = await tx.corporateAccount.findFirst({
      where: { id, tenantId },
      include: { agreements: { orderBy: { startDate: "desc" } }, members: { include: { client: { select: { id: true, code: true, fullName: true, phone: true } } }, orderBy: { createdAt: "desc" } } },
    });
    if (!c) throw notFound("Company not found");
    const invoices = await tx.invoice.findMany({
      where: { tenantId, corporateAgreementId: { in: c.agreements.map((a) => a.id) }, status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: { id: true, code: true, issuedAt: true, total: true, corporateDiscount: true, corporateAgreementId: true, client: { select: { fullName: true } } }, orderBy: { issuedAt: "desc" }, take: 300,
    });
    const byAgreement = c.agreements.map((a) => { const inv = invoices.filter((i) => i.corporateAgreementId === a.id); return { agreementId: a.id, invoices: inv.length, discount: sum(inv.map((i) => D(i.corporateDiscount))), revenue: sum(inv.map((i) => D(i.total))) }; });
    return { ...c, invoices, byAgreement };
  });
}

export async function saveCompany(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "corporate.update" : "corporate.create");
  const d = companySchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (id && !(await tx.corporateAccount.findFirst({ where: { id, tenantId } }))) throw notFound("Company not found");
    const c = id ? await tx.corporateAccount.update({ where: { id }, data: d }) : await tx.corporateAccount.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "corporate.update" : "corporate.create", entity: "CorporateAccount", entityId: c.id, after: c });
    return c;
  });
}

export async function saveAgreement(ctx: Ctx, companyId: string, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "corporate.update" : "corporate.create");
  const d = agreementSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.corporateAccount.findFirst({ where: { id: companyId, tenantId } }))) throw notFound("Company not found");
    if (d.serviceIds.length && (await tx.service.count({ where: { tenantId, id: { in: d.serviceIds } } })) !== new Set(d.serviceIds).size) throw badRequest("Service not found");
    // Only one active agreement per company may overlap a given date.
    const overlap = await tx.corporateAgreement.findFirst({ where: { tenantId, corporateId: companyId, isActive: true, startDate: { lte: d.endDate }, endDate: { gte: d.startDate }, ...(id ? { id: { not: id } } : {}) } });
    if (overlap && d.isActive) throw conflict(`Overlaps the active agreement "${overlap.name}"`);
    const data = { ...d, serviceIds: d.allServices ? [] : d.serviceIds };
    const a = id ? await tx.corporateAgreement.update({ where: { id }, data }) : await tx.corporateAgreement.create({ data: { ...data, tenantId, corporateId: companyId } });
    await audit(tx, ctx, { action: id ? "corporate.agreement.update" : "corporate.agreement.create", entity: "CorporateAgreement", entityId: a.id, after: a });
    return a;
  });
}

export async function addMember(ctx: Ctx, companyId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "corporate.update");
  const d = z.object({ clientId: z.string().uuid(), memberType: z.enum(["EMPLOYEE", "FAMILY"]).default("EMPLOYEE"), employeeNo: optText(40), validUntil: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.corporateAccount.findFirst({ where: { id: companyId, tenantId } }))) throw notFound("Company not found");
    if (!(await tx.client.findFirst({ where: { id: d.clientId, tenantId, deletedAt: null } }))) throw badRequest("Client not found");
    const other = await tx.corporateMember.findFirst({ where: { tenantId, clientId: d.clientId, corporateId: { not: companyId } }, include: { corporate: { select: { name: true } } } });
    if (other) throw conflict(`Client already belongs to ${other.corporate.name}`);
    const m = await tx.corporateMember.upsert({ where: { corporateId_clientId: { corporateId: companyId, clientId: d.clientId } }, create: { ...d, tenantId, corporateId: companyId }, update: d });
    await tx.client.update({ where: { id: d.clientId }, data: { category: "CORPORATE" } });
    await audit(tx, ctx, { action: "corporate.member.add", entity: "CorporateMember", entityId: m.id, after: m });
    return m;
  });
}

export async function removeMember(ctx: Ctx, memberId: string) {
  const tenantId = requireTenant(ctx, "corporate.update");
  return withTenant(tenantId, async (tx) => {
    const m = await tx.corporateMember.findFirst({ where: { id: memberId, tenantId } });
    if (!m) throw notFound("Member not found");
    await tx.corporateMember.delete({ where: { id: memberId } });
    await audit(tx, ctx, { action: "corporate.member.remove", entity: "CorporateMember", entityId: memberId, before: m });
    return { ok: true };
  });
}

/** Corporate discount for an invoice being built (eligible lines × agreement %). */
export async function corporateDiscountFor(tx: Tx, tenantId: string, clientId: string | null, lines: { serviceId: string | null; lineTotal: Prisma.Decimal }[], at: Date) {
  if (!clientId) return null;
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const m = await tx.corporateMember.findFirst({ where: { tenantId, clientId, corporate: { isActive: true }, OR: [{ validUntil: null }, { validUntil: { gte: day } }] } });
  if (!m) return null;
  const a = await tx.corporateAgreement.findFirst({ where: { tenantId, corporateId: m.corporateId, isActive: true, startDate: { lte: day }, endDate: { gte: day }, memberTypes: { has: m.memberType } } });
  if (!a) return null;
  const base = sum(lines.filter((l) => a.allServices || (l.serviceId && a.serviceIds.includes(l.serviceId))).map((l) => l.lineTotal));
  if (base.isZero()) return null;
  const subtotal = sum(lines.map((l) => l.lineTotal));
  return { agreement: a, discount: r2(min(base.times(a.discountPercent).dividedBy(100), subtotal)) };
}

/**
 * Dashboard KPIs from live data (clients + appointments). Financial figures
 * (invoices, expenses, profit) arrive with the Phase 4/5 modules; until then
 * we show the value of completed services, only to users with finance access.
 * Buckets use the tenant's timezone.
 */
import { Prisma } from "@prisma/client";
import { type Ctx, requireTenant } from "../context";
import { withTenant } from "../db";
import { badRequest } from "../errors";
import { seesAllBranches } from "./common";

export type Granularity = "day" | "week" | "month" | "year";

export async function getDashboard(ctx: Ctx, q: { from: string; to: string; granularity?: string; branchId?: string }) {
  const tenantId = requireTenant(ctx, "dashboard.view");
  const from = new Date(q.from), to = new Date(q.to);
  if (isNaN(+from) || isNaN(+to) || to <= from) throw badRequest("Invalid date range");
  if (+to - +from > 6 * 366 * 86400000) throw badRequest("Range too large");
  const g: Granularity = (["day", "week", "month", "year"] as const).find((x) => x === q.granularity) ?? "day";
  const finance = ctx.permissions.has("finance.view_data");
  const canClients = ctx.permissions.has("clients.view");
  const canAppts = ctx.permissions.has("appointments.view");

  // Branch filter: explicit choice, else caller's branches (if restricted).
  let branchIds: string[] | null = seesAllBranches(ctx) ? null : ctx.user.branchIds;
  if (q.branchId) {
    if (branchIds && !branchIds.includes(q.branchId)) branchIds = [];
    else branchIds = [q.branchId];
  }
  const bSql = branchIds ? Prisma.sql`AND "branchId" = ANY(${branchIds}::uuid[])` : Prisma.empty;
  const bWhere = branchIds ? { branchId: { in: branchIds } } : {};

  return withTenant(tenantId, async (tx) => {
    const tz = (await tx.tenant.findFirst({ where: { id: tenantId }, select: { timezone: true } }))?.timezone ?? "UTC";
    const now = new Date();
    // "today" in the tenant's timezone
    const [{ s: dayStart, e: dayEnd }] = await tx.$queryRaw<{ s: Date; e: Date }[]>`
      SELECT (date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC' AS s,
             ((date_trunc('day', now() AT TIME ZONE ${tz}) + interval '1 day') AT TIME ZONE ${tz}) AT TIME ZONE 'UTC' AS e`;

    const live = { tenantId, deletedAt: null, ...bWhere };
    const inRange = { gte: from, lt: to };
    const [clientsTotal, newClients, leads, converted, apptStatus, today, upcoming] = await Promise.all([
      canClients ? tx.client.count({ where: { ...live, status: { not: "LEAD" } } }) : null,
      canClients ? tx.client.count({ where: { ...live, createdAt: inRange } }) : null,
      canClients ? tx.client.count({ where: { ...live, status: "LEAD" } }) : null,
      canClients ? tx.client.count({ where: { ...live, convertedAt: inRange } }) : null,
      canAppts ? tx.appointment.groupBy({ by: ["status"], where: { tenantId, ...bWhere, startsAt: inRange }, _count: true, _sum: { price: true } }) : [],
      canAppts ? tx.appointment.count({ where: { tenantId, ...bWhere, startsAt: { gte: dayStart, lt: dayEnd }, status: { notIn: ["CANCELLED"] } } }) : null,
      canAppts ? tx.appointment.count({ where: { tenantId, ...bWhere, startsAt: { gte: now }, status: { in: ["SCHEDULED", "CONFIRMED"] } } }) : null,
    ]);
    const st = Object.fromEntries(apptStatus.map((r) => [r.status, r]));

    const bucket = Prisma.raw(`'${g}'`);
    const series = canAppts || canClients
      ? await tx.$queryRaw<{ bucket: Date; completed: bigint; cancelled: bigint; booked: bigint; new_clients: bigint; value: Prisma.Decimal | null }[]>`
        WITH a AS (
          SELECT date_trunc(${bucket}, "startsAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) AS b,
                 COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
                 COUNT(*) FILTER (WHERE status IN ('CANCELLED','NO_SHOW')) AS cancelled,
                 COUNT(*) AS booked,
                 SUM(price) FILTER (WHERE status = 'COMPLETED') AS value
          FROM "Appointment" WHERE "tenantId" = ${tenantId}::uuid AND "startsAt" >= ${from} AND "startsAt" < ${to} ${bSql}
          GROUP BY 1),
        c AS (
          SELECT date_trunc(${bucket}, "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) AS b, COUNT(*) AS n
          FROM "Client" WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL AND "createdAt" >= ${from} AND "createdAt" < ${to} ${bSql}
          GROUP BY 1)
        SELECT COALESCE(a.b, c.b) AS bucket, COALESCE(a.completed,0) AS completed, COALESCE(a.cancelled,0) AS cancelled,
               COALESCE(a.booked,0) AS booked, COALESCE(c.n,0) AS new_clients, a.value
        FROM a FULL OUTER JOIN c ON a.b = c.b ORDER BY 1`
      : [];

    const top = (col: "serviceId" | "staffId") => tx.$queryRaw<{ id: string; name: string; n: bigint; value: Prisma.Decimal | null }[]>`
      SELECT x.id, x.name, COUNT(*) AS n, SUM(ap.price) AS value
      FROM "Appointment" ap JOIN ${Prisma.raw(col === "serviceId" ? `"Service" x ON x.id = ap."serviceId"` : `"User" x ON x.id = ap."staffId"`)}
      WHERE ap."tenantId" = ${tenantId}::uuid AND ap.status = 'COMPLETED' AND ap."startsAt" >= ${from} AND ap."startsAt" < ${to}
        ${branchIds ? Prisma.sql`AND ap."branchId" = ANY(${branchIds}::uuid[])` : Prisma.empty}
      GROUP BY x.id, ${Prisma.raw(col === "serviceId" ? "x.name" : `x."fullName"`)} ORDER BY n DESC LIMIT 5`;
    // "User" has fullName, not name — alias it.
    const [topServices, topStaffRaw] = canAppts
      ? await Promise.all([
          top("serviceId"),
          tx.$queryRaw<{ id: string; name: string; n: bigint; value: Prisma.Decimal | null }[]>`
            SELECT u.id, u."fullName" AS name, COUNT(*) AS n, SUM(ap.price) AS value
            FROM "Appointment" ap JOIN "User" u ON u.id = ap."staffId"
            WHERE ap."tenantId" = ${tenantId}::uuid AND ap.status = 'COMPLETED' AND ap."startsAt" >= ${from} AND ap."startsAt" < ${to}
              ${branchIds ? Prisma.sql`AND ap."branchId" = ANY(${branchIds}::uuid[])` : Prisma.empty}
            GROUP BY u.id, u."fullName" ORDER BY n DESC LIMIT 5`,
        ])
      : [[], []];

    const branches = canAppts && !branchIds
      ? await tx.$queryRaw<{ id: string; name: string; completed: bigint; booked: bigint; value: Prisma.Decimal | null }[]>`
          SELECT b.id, b.name, COUNT(ap.id) FILTER (WHERE ap.status = 'COMPLETED') AS completed, COUNT(ap.id) AS booked,
                 SUM(ap.price) FILTER (WHERE ap.status = 'COMPLETED') AS value
          FROM "Branch" b LEFT JOIN "Appointment" ap ON ap."branchId" = b.id AND ap."startsAt" >= ${from} AND ap."startsAt" < ${to}
          WHERE b."tenantId" = ${tenantId}::uuid GROUP BY b.id, b.name ORDER BY completed DESC`
      : [];

    // Phase 3 KPIs — each only for users who may see that module
    const p = ctx.permissions;
    const todayD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const in7 = new Date(+todayD + 7 * 86400000);
    const [subsActive, subsExpiring, subsExpired, subsSold, progActive, progCompleted, surgDone, surgUpcoming, revDone, revOverdue] = await Promise.all([
      p.has("subscriptions.view") ? tx.clientSubscription.count({ where: { tenantId, ...bWhere, status: "ACTIVE", endDate: { gte: todayD } } }) : null,
      p.has("subscriptions.view") ? tx.clientSubscription.count({ where: { tenantId, ...bWhere, status: "ACTIVE", endDate: { gte: todayD, lte: in7 } } }) : null,
      p.has("subscriptions.view") ? tx.clientSubscription.count({ where: { tenantId, ...bWhere, OR: [{ status: "EXPIRED" }, { status: "ACTIVE", endDate: { lt: todayD } }], endDate: { gte: from, lt: to } } }) : null,
      p.has("subscriptions.view") ? tx.clientSubscription.aggregate({ where: { tenantId, ...bWhere, createdAt: inRange }, _count: true, _sum: { price: true } }) : null,
      p.has("programs.view") ? tx.clientProgram.count({ where: { tenantId, ...bWhere, status: "ACTIVE" } }) : null,
      p.has("programs.view") ? tx.clientProgram.count({ where: { tenantId, ...bWhere, status: "COMPLETED", completedAt: inRange } }) : null,
      p.has("surgeries.view") ? tx.surgery.aggregate({ where: { tenantId, ...bWhere, status: "COMPLETED", scheduledAt: inRange }, _count: true, _sum: { price: true } }) : null,
      p.has("surgeries.view") ? tx.surgery.count({ where: { tenantId, ...bWhere, status: { in: ["PLANNED", "CONFIRMED"] }, scheduledAt: { gte: now } } }) : null,
      p.has("reviews.view") ? tx.medicalReview.count({ where: { tenantId, ...bWhere, status: "COMPLETED", scheduledAt: inRange } }) : null,
      p.has("reviews.view") ? tx.medicalReview.count({ where: { tenantId, ...bWhere, status: "SCHEDULED", scheduledAt: { lt: now } } }) : null,
    ]);

    // Phase 4: real money — collections (payments − refunds), sales issued, receivables. Finance only.
    const invBranch = branchIds ? { invoice: { branchId: { in: branchIds } } } : {};
    const [collected, refunded, issued, outstanding, revSeries] = finance
      ? await Promise.all([
          tx.payment.aggregate({ where: { tenantId, kind: "PAYMENT", paidAt: inRange, ...invBranch }, _sum: { amount: true } }),
          tx.payment.aggregate({ where: { tenantId, kind: "REFUND", paidAt: inRange, ...invBranch }, _sum: { amount: true } }),
          tx.invoice.aggregate({ where: { tenantId, ...bWhere, issuedAt: inRange, status: { notIn: ["DRAFT", "CANCELLED"] } }, _sum: { total: true }, _count: true }),
          tx.invoice.findMany({ where: { tenantId, ...bWhere, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { total: true, paidTotal: true, dueDate: true, installments: { select: { dueDate: true, amount: true }, orderBy: { seq: "asc" } } } }),
          tx.$queryRaw<{ bucket: Date; amount: Prisma.Decimal }[]>`
            SELECT date_trunc(${bucket}, p."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) AS bucket,
                   SUM(CASE WHEN p.kind = 'PAYMENT' THEN p.amount ELSE -p.amount END) AS amount
            FROM "Payment" p JOIN "Invoice" i ON i.id = p."invoiceId"
            WHERE p."tenantId" = ${tenantId}::uuid AND p."paidAt" >= ${from} AND p."paidAt" < ${to}
              ${branchIds ? Prisma.sql`AND i."branchId" = ANY(${branchIds}::uuid[])` : Prisma.empty}
            GROUP BY 1 ORDER BY 1`,
        ])
      : [null, null, null, [], []];
    // Phase 5: profit from the ledger (accrual: revenue − expenses incl. materials, payroll, vouchers).
    const ledger = finance && ctx.features.has("accounting")
      ? await tx.$queryRaw<{ type: string; d: Prisma.Decimal; c: Prisma.Decimal }[]>`
          SELECT a.type::text AS type, SUM(l.debit) AS d, SUM(l.credit) AS c
          FROM "JournalLine" l JOIN "Account" a ON a.id = l."accountId" JOIN "JournalEntry" e ON e.id = l."entryId"
          WHERE l."tenantId" = ${tenantId}::uuid AND a.type IN ('REVENUE', 'EXPENSE') AND e.date >= ${from} AND e.date < ${to}
            ${branchIds ? Prisma.sql`AND l."branchId" = ANY(${branchIds}::uuid[])` : Prisma.empty}
          GROUP BY 1`
      : null;
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // Same rule as the receivables report: an invoice is overdue when its first unpaid installment (or its due date) has passed.
    type Out = { total: Prisma.Decimal; paidTotal: Prisma.Decimal; dueDate: Date | null; installments: { dueDate: Date; amount: Prisma.Decimal }[] };
    const recv = (outstanding as Out[]).reduce((a, r) => {
      const b = Number(r.total) - Number(r.paidTotal);
      let left = Number(r.paidTotal), due = r.dueDate;
      for (const x of r.installments) { const p = Math.min(left, Number(x.amount)); left -= p; if (Number(x.amount) > p) { due = x.dueDate; break; } }
      return { total: a.total + b, overdue: a.overdue + (due && due < todayUTC ? b : 0), count: a.count + 1 };
    }, { total: 0, overdue: 0, count: 0 });

    const v = (x: Prisma.Decimal | null | undefined) => (finance ? Number(x ?? 0) : null);
    return {
      granularity: g, timezone: tz, finance,
      kpis: {
        clientsTotal, newClients, leads, converted,
        appointmentsToday: today, upcoming,
        completed: canAppts ? st.COMPLETED?._count ?? 0 : null,
        cancelled: canAppts ? st.CANCELLED?._count ?? 0 : null,
        noShow: canAppts ? st.NO_SHOW?._count ?? 0 : null,
        completedValue: canAppts ? v(st.COMPLETED?._sum.price) : null,
      },
      money: finance ? {
        revenue: Number(collected?._sum.amount ?? 0) - Number(refunded?._sum.amount ?? 0),
        refunds: Number(refunded?._sum.amount ?? 0),
        sales: Number(issued?._sum.total ?? 0), invoices: issued?._count ?? 0,
        receivables: Math.round(recv.total * 100) / 100, overdue: Math.round(recv.overdue * 100) / 100, unpaidInvoices: recv.count,
        series: (revSeries as { bucket: Date; amount: Prisma.Decimal }[]).map((r) => ({ bucket: r.bucket, amount: Number(r.amount) })),
        profit: ledger ? (() => {
          const rev = ledger.filter((r) => r.type === "REVENUE").reduce((a, r) => a + Number(r.c) - Number(r.d), 0);
          const exp = ledger.filter((r) => r.type === "EXPENSE").reduce((a, r) => a + Number(r.d) - Number(r.c), 0);
          return { revenue: Math.round(rev * 100) / 100, expenses: Math.round(exp * 100) / 100, net: Math.round((rev - exp) * 100) / 100 };
        })() : null,
      } : null,
      phase3: {
        subscriptions: subsActive === null ? null : { active: subsActive, expiringIn7: subsExpiring, expired: subsExpired, sold: subsSold!._count, soldValue: v(subsSold!._sum.price) },
        programs: progActive === null ? null : { active: progActive, completed: progCompleted },
        surgeries: surgDone === null ? null : { completed: surgDone._count, value: v(surgDone._sum.price), upcoming: surgUpcoming },
        reviews: revDone === null ? null : { completed: revDone, overdue: revOverdue },
      },
      series: series.map((r) => ({
        bucket: r.bucket, completed: Number(r.completed), cancelled: Number(r.cancelled), booked: Number(r.booked),
        newClients: Number(r.new_clients), value: v(r.value),
      })),
      topServices: topServices.map((r) => ({ id: r.id, name: r.name, count: Number(r.n), value: v(r.value) })),
      topStaff: topStaffRaw.map((r) => ({ id: r.id, name: r.name, count: Number(r.n), value: v(r.value) })),
      branches: branches.map((r) => ({ id: r.id, name: r.name, completed: Number(r.completed), booked: Number(r.booked), value: v(r.value) })),
    };
  });
}

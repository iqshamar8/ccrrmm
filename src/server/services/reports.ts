/**
 * Reports centre. Every report is a definition (permissions, plan module,
 * columns) + a query; the same result feeds the screen, Excel and CSV export
 * and the print/PDF view. Money columns are dropped for users without
 * finance.view_data; branch-restricted users only see their branches.
 */
import { Prisma } from "@prisma/client";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, forbidden, notFound } from "../errors";
import { seesAllBranches } from "./common";

export type ColType = "text" | "number" | "money" | "percent" | "date";
export type Col = { key: string; ar: string; en: string; type?: ColType };
type Row = Record<string, unknown>;
export type Summary = { ar: string; en: string; value: number | string | null; type?: ColType };
export type ReportResult = { columns: Col[]; rows: Row[]; totals?: Row | null; summary?: Summary[]; chart?: { label: string; values: string[]; kind?: "bar" | "line" } };
export type Q = { from: Date; to: Date; branchIds: string[] | null; days: number; tz: string; bucket: "day" | "month"; lang: "ar" | "en" };
const L2 = (q: Q, ar: string, en: string) => (q.lang === "en" ? en : ar);
type Def = { key: string; group: string; ar: string; en: string; perms: string[]; feature?: string; days?: { ar: string; en: string; def: number }; range?: boolean; run: (tx: Tx, tenantId: string, q: Q, ctx: Ctx) => Promise<ReportResult> };

export const GROUPS: Record<string, [string, string]> = {
  clients: ["العملاء", "Clients"], staff: ["الموظفون", "Staff"], services: ["الخدمات", "Services"], surgeries: ["العمليات الجراحية", "Surgeries"],
  reviews: ["المراجعات الطبية", "Medical reviews"], inventory: ["المخازن", "Inventory"], finance: ["المالية", "Finance"], extra: ["إحصائيات إضافية", "More statistics"], compare: ["المقارنات", "Comparisons"],
};

const N = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const bIn = (col: string, ids: string[] | null) => (ids ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${ids}::uuid[])` : Prisma.empty);
const bWhere = (ids: string[] | null) => (ids ? { branchId: { in: ids } } : {});
const sumRows = (rows: Row[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((a, r) => a + N(r[k]), 0))]));
const bucketSql = (col: string, q: Q) => Prisma.sql`to_char(date_trunc(${q.bucket}, ${Prisma.raw(col)} AT TIME ZONE 'UTC' AT TIME ZONE ${q.tz}), ${q.bucket === "month" ? "YYYY-MM" : "YYYY-MM-DD"})`;
const c = (key: string, ar: string, en: string, type: ColType = "number"): Col => ({ key, ar, en, type });
const t = (key: string, ar: string, en: string): Col => ({ key, ar, en, type: "text" });

const OUT_AR: Record<string, string> = { PENDING: "بدون نتيجة بعد", IMPROVED: "تحسّن", RESOLVED: "شُفي", STABLE: "مستقر", WORSE: "تراجع" };
const OUT_EN: Record<string, string> = { PENDING: "No outcome yet", IMPROVED: "Improved", RESOLVED: "Resolved", STABLE: "Stable", WORSE: "Worse" };

// ------------------------------------------------------------ definitions ----

const DEFS: Def[] = [
  // ---------------------------------------------------------------- clients
  { key: "clients-overview", group: "clients", ar: "نمو العملاء والنشاط", en: "Client growth & activity", perms: ["clients.view"], range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ b: string; created: bigint; leads: bigint; converted: bigint; visiting: bigint }[]>`
        WITH c AS (SELECT ${bucketSql(`"createdAt"`, q)} b, COUNT(*) FILTER (WHERE status <> 'LEAD') created, COUNT(*) FILTER (WHERE status = 'LEAD' OR "convertedAt" IS NOT NULL) leads
                   FROM "Client" WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL AND "createdAt" >= ${q.from} AND "createdAt" < ${q.to} ${bIn(`"branchId"`, q.branchIds)} GROUP BY 1),
             v AS (SELECT ${bucketSql(`"convertedAt"`, q)} b, COUNT(*) converted FROM "Client" WHERE "tenantId" = ${tenantId}::uuid AND "convertedAt" >= ${q.from} AND "convertedAt" < ${q.to} ${bIn(`"branchId"`, q.branchIds)} GROUP BY 1),
             a AS (SELECT ${bucketSql(`"startsAt"`, q)} b, COUNT(DISTINCT "clientId") visiting FROM "Appointment" WHERE "tenantId" = ${tenantId}::uuid AND status = 'COMPLETED' AND "startsAt" >= ${q.from} AND "startsAt" < ${q.to} ${bIn(`"branchId"`, q.branchIds)} GROUP BY 1)
        SELECT b, COALESCE(c.created,0) created, COALESCE(c.leads,0) leads, COALESCE(v.converted,0) converted, COALESCE(a.visiting,0) visiting
        FROM c FULL JOIN v USING (b) FULL JOIN a USING (b) ORDER BY b`;
      const since90 = new Date(Date.now() - 90 * 86400000);
      const base = { tenantId, deletedAt: null, ...bWhere(q.branchIds) };
      const [total, leads, active, inactive] = await Promise.all([
        tx.client.count({ where: { ...base, status: { not: "LEAD" } } }), tx.client.count({ where: { ...base, status: "LEAD" } }),
        tx.client.count({ where: { ...base, status: "ACTIVE", lastVisitAt: { gte: since90 } } }),
        tx.client.count({ where: { ...base, status: { in: ["ACTIVE", "INACTIVE"] }, OR: [{ lastVisitAt: { lt: since90 } }, { lastVisitAt: null }] } }),
      ]);
      const out = rows.map((r) => ({ bucket: r.b, created: N(r.created), leads: N(r.leads), converted: N(r.converted), visiting: N(r.visiting) }));
      return {
        columns: [t("bucket", "الفترة", "Period"), c("created", "عملاء جدد", "New clients"), c("leads", "عملاء محتملون جدد", "New leads"), c("converted", "تحويل من محتمل", "Leads converted"), c("visiting", "عملاء زاروا", "Visiting clients")],
        rows: out, totals: { bucket: "", ...sumRows(out, ["created", "leads", "converted"]) },
        summary: [{ ar: "إجمالي العملاء", en: "Total clients", value: total }, { ar: "نشطون (زيارة خلال 90 يوماً)", en: "Active (visit in 90 days)", value: active }, { ar: "غير نشطين", en: "Inactive", value: inactive }, { ar: "عملاء محتملون حالياً", en: "Open leads", value: leads }],
        chart: { label: "bucket", values: ["created", "visiting"], kind: "line" },
      };
    } },
  { key: "clients-sources", group: "clients", ar: "مصادر العملاء", en: "Client sources", perms: ["clients.view"], range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ source: string; total: bigint; converted: bigint; leads: bigint; revenue: Prisma.Decimal | null }[]>`
        SELECT COALESCE(c.source, 'unknown') source, COUNT(*) total, COUNT(*) FILTER (WHERE c.status = 'ACTIVE') converted, COUNT(*) FILTER (WHERE c.status = 'LEAD') leads,
               (SELECT SUM(i.total - i."refundedTotal") FROM "Invoice" i WHERE i."clientId" = ANY(array_agg(c.id)) AND i.status NOT IN ('DRAFT','CANCELLED')) revenue
        FROM "Client" c WHERE c."tenantId" = ${tenantId}::uuid AND c."deletedAt" IS NULL AND c."createdAt" >= ${q.from} AND c."createdAt" < ${q.to} ${bIn(`c."branchId"`, q.branchIds)}
        GROUP BY 1 ORDER BY 2 DESC`;
      const out = rows.map((r) => ({ source: r.source, total: N(r.total), leads: N(r.leads), converted: N(r.converted), rate: pct(N(r.converted), N(r.total)), revenue: r2(N(r.revenue)), avg: N(r.converted) ? r2(N(r.revenue) / N(r.converted)) : 0 }));
      return {
        columns: [t("source", "المصدر", "Source"), c("total", "العملاء", "Clients"), c("leads", "ما زالوا محتملين", "Still leads"), c("converted", "تحولوا لعملاء", "Converted"), c("rate", "نسبة التحويل", "Conversion", "percent"), c("revenue", "الإيرادات", "Revenue", "money"), c("avg", "متوسط الإيراد للعميل", "Revenue / client", "money")],
        rows: out, totals: { source: "", ...sumRows(out, ["total", "leads", "converted", "revenue"]) }, chart: { label: "source", values: ["total"] },
      };
    } },
  { key: "clients-inactive", group: "clients", ar: "العملاء غير النشطين", en: "Inactive clients", perms: ["clients.view"], days: { ar: "بدون زيارة منذ (يوم)", en: "No visit for (days)", def: 90 },
    run: async (tx, tenantId, q) => {
      const t0 = new Date(Date.now() - q.days * 86400000);
      const rows = await tx.client.findMany({ where: { tenantId, deletedAt: null, status: "ACTIVE", ...bWhere(q.branchIds), OR: [{ lastVisitAt: { lt: t0 } }, { lastVisitAt: null, createdAt: { lt: t0 } }] }, orderBy: { lastVisitAt: { sort: "asc", nulls: "first" } }, take: 2000, select: { id: true, code: true, fullName: true, phone: true, source: true, lastVisitAt: true, branch: { select: { name: true } } } });
      const spend = await tx.invoice.groupBy({ by: ["clientId"], where: { tenantId, clientId: { in: rows.map((r) => r.id) }, status: { notIn: ["DRAFT", "CANCELLED"] } }, _sum: { paidTotal: true }, _count: true });
      return {
        columns: [t("code", "الرمز", "Code"), t("name", "العميل", "Client"), t("phone", "الهاتف", "Phone"), t("branch", "الفرع", "Branch"), t("source", "المصدر", "Source"), c("lastVisit", "آخر زيارة", "Last visit", "date"), c("days", "أيام منذ الزيارة", "Days since"), c("invoices", "الفواتير", "Invoices"), c("spent", "إجمالي المدفوع", "Total paid", "money")],
        rows: rows.map((r) => { const s = spend.find((x) => x.clientId === r.id); return { id: r.id, code: r.code, name: r.fullName, phone: r.phone, branch: r.branch.name, source: r.source, lastVisit: r.lastVisitAt, days: r.lastVisitAt ? Math.floor((Date.now() - +r.lastVisitAt) / 86400000) : null, invoices: s?._count ?? 0, spent: N(s?._sum.paidTotal) }; }),
        summary: [{ ar: "عدد العملاء", en: "Clients", value: rows.length }],
      };
    } },
  { key: "leads-funnel", group: "clients", ar: "تحويل العملاء المحتملين", en: "Lead conversion", perms: ["clients.view"], range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ source: string; total: bigint; contacted: bigint; converted: bigint; days: number | null }[]>`
        SELECT COALESCE(c.source,'unknown') source, COUNT(*) total,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ClientInteraction" x WHERE x."clientId" = c.id AND x.type IN ('CALL','WHATSAPP','EMAIL','NOTE'))) contacted,
               COUNT(*) FILTER (WHERE c."convertedAt" IS NOT NULL) converted,
               AVG(EXTRACT(EPOCH FROM (c."convertedAt" - c."createdAt")) / 86400) FILTER (WHERE c."convertedAt" IS NOT NULL)::float days
        FROM "Client" c WHERE c."tenantId" = ${tenantId}::uuid AND c."deletedAt" IS NULL AND (c.status = 'LEAD' OR c."convertedAt" IS NOT NULL)
          AND c."createdAt" >= ${q.from} AND c."createdAt" < ${q.to} ${bIn(`c."branchId"`, q.branchIds)} GROUP BY 1 ORDER BY 2 DESC`;
      const out = rows.map((r) => ({ source: r.source, total: N(r.total), contacted: N(r.contacted), converted: N(r.converted), rate: pct(N(r.converted), N(r.total)), days: r.days === null ? null : r2(r.days) }));
      const tot = sumRows(out, ["total", "contacted", "converted"]);
      return {
        columns: [t("source", "المصدر", "Source"), c("total", "محتملون", "Leads"), c("contacted", "تم التواصل", "Contacted"), c("converted", "تحولوا", "Converted"), c("rate", "نسبة التحويل", "Conversion", "percent"), c("days", "متوسط أيام التحويل", "Avg days to convert")],
        rows: out, totals: { source: "", ...tot, rate: pct(N(tot.converted), N(tot.total)) }, chart: { label: "source", values: ["total", "converted"] },
      };
    } },
  // ------------------------------------------------------------------ staff
  { key: "staff-performance", group: "staff", ar: "أداء الموظفين", en: "Staff performance", perms: ["appointments.view"], range: true,
    run: async (tx, tenantId, q, ctx) => {
      const users = await tx.user.findMany({ where: { tenantId, status: "ACTIVE", ...(q.branchIds ? { OR: [{ allBranches: true }, { branchAccess: { some: { branchId: { in: q.branchIds } } } }] } : {}) }, select: { id: true, fullName: true, jobTitle: true } });
      const ids = users.map((u) => u.id);
      const range = { gte: q.from, lt: q.to };
      const hr = ctx.features.has("hr") && ctx.permissions.has("hr.view");
      const [visits, sales, comm, att, rating] = await Promise.all([
        tx.appointment.groupBy({ by: ["staffId"], where: { tenantId, staffId: { in: ids }, status: "COMPLETED", startsAt: range, ...bWhere(q.branchIds) }, _count: true, _sum: { price: true } }),
        tx.invoice.groupBy({ by: ["salesStaffId"], where: { tenantId, salesStaffId: { in: ids }, issuedAt: range, status: { notIn: ["DRAFT", "CANCELLED"] }, ...bWhere(q.branchIds) }, _count: true, _sum: { total: true } }),
        ctx.features.has("commissions") ? tx.commissionEntry.groupBy({ by: ["userId"], where: { tenantId, userId: { in: ids }, earnedAt: range, status: { not: "VOID" } }, _sum: { amount: true } }) : Promise.resolve([]),
        hr ? tx.attendanceRecord.groupBy({ by: ["userId", "status"], where: { tenantId, userId: { in: ids }, date: range }, _count: true }) : Promise.resolve([]),
        hr ? tx.employeeEvaluation.groupBy({ by: ["userId"], where: { tenantId, userId: { in: ids } }, _avg: { rating: true } }) : Promise.resolve([]),
      ]);
      const rows = users.map((u) => {
        const a = (st: string) => (att as { userId: string; status: string; _count: number }[]).find((x) => x.userId === u.id && x.status === st)?._count ?? 0;
        return {
          name: u.fullName, job: u.jobTitle, visits: visits.find((v) => v.staffId === u.id)?._count ?? 0, visitValue: N(visits.find((v) => v.staffId === u.id)?._sum.price),
          invoices: sales.find((s) => s.salesStaffId === u.id)?._count ?? 0, sales: N(sales.find((s) => s.salesStaffId === u.id)?._sum.total),
          commissions: N((comm as { userId: string; _sum: { amount: unknown } }[]).find((x) => x.userId === u.id)?._sum.amount),
          present: a("PRESENT"), late: a("LATE"), absent: a("ABSENT"), rating: r2(N((rating as { userId: string; _avg: { rating: number | null } }[]).find((x) => x.userId === u.id)?._avg.rating)),
        };
      }).filter((r) => r.visits || r.invoices || r.commissions || r.present || r.late || r.absent).sort((a, b) => b.visits - a.visits || b.sales - a.sales);
      const cols = [t("name", "الموظف", "Staff"), t("job", "الوظيفة", "Job"), c("visits", "خدمات منفذة", "Services done"), c("visitValue", "قيمة الخدمات", "Services value", "money"), c("invoices", "مبيعات (فواتير)", "Sales (invoices)"), c("sales", "قيمة المبيعات", "Sales value", "money")];
      if (ctx.features.has("commissions")) cols.push(c("commissions", "العمولات", "Commissions", "money"));
      if (hr) cols.push(c("present", "حضور", "Present"), c("late", "تأخير", "Late"), c("absent", "غياب", "Absent"), c("rating", "التقييم", "Rating"));
      return { columns: cols, rows, totals: { name: "", ...sumRows(rows, ["visits", "visitValue", "invoices", "sales", "commissions", "present", "late", "absent"]) }, chart: { label: "name", values: ["visits"] } };
    } },
  // --------------------------------------------------------------- services
  { key: "services-performance", group: "services", ar: "الخدمات: الطلب والإيراد والهامش", en: "Services: demand, revenue & margin", perms: ["services.view"], range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ id: string; name: string; kind: string; count: bigint; revenue: Prisma.Decimal | null; materials: Prisma.Decimal | null; stdcost: Prisma.Decimal | null }[]>`
        SELECT s.id, s.name, s.kind::text kind,
          (SELECT COUNT(*) FROM "Appointment" a WHERE a."serviceId" = s.id AND a.status = 'COMPLETED' AND a."startsAt" >= ${q.from} AND a."startsAt" < ${q.to} ${bIn(`a."branchId"`, q.branchIds)}) count,
          (SELECT SUM(l."lineTotal" * CASE WHEN i.subtotal > 0 THEN 1 - (i."discountAmount" + i."couponDiscount" + i."loyaltyDiscount" + i."corporateDiscount") / i.subtotal ELSE 0 END)
             FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId" WHERE l."serviceId" = s.id AND NOT l.voided AND i.status NOT IN ('DRAFT','CANCELLED') AND i."issuedAt" >= ${q.from} AND i."issuedAt" < ${q.to} ${bIn(`i."branchId"`, q.branchIds)}) revenue,
          (SELECT -SUM(m."totalCost") FROM "StockMovement" m JOIN "StockDocument" d ON d.id = m."documentId" JOIN "Appointment" a ON a.id = d."appointmentId"
             WHERE a."serviceId" = s.id AND d.type = 'CONSUMPTION' AND d.date >= ${q.from} AND d.date < ${q.to} ${bIn(`a."branchId"`, q.branchIds)}) materials,
          s.cost stdcost
        FROM "Service" s WHERE s."tenantId" = ${tenantId}::uuid ORDER BY 4 DESC, 5 DESC NULLS LAST`;
      const out = rows.filter((r) => N(r.count) || N(r.revenue)).map((r) => {
        const cost = r.materials !== null ? N(r.materials) : N(r.stdcost) * N(r.count);
        const rev = r2(N(r.revenue));
        return { name: r.name, kind: r.kind, count: N(r.count), revenue: rev, cost: r2(cost), costBasis: r.materials !== null ? "stock" : "standard", margin: r2(rev - cost), marginPct: pct(rev - cost, rev) };
      });
      const tot = sumRows(out, ["count", "revenue", "cost", "margin"]);
      return {
        columns: [t("name", "الخدمة", "Service"), t("kind", "النوع", "Type"), c("count", "مرات التنفيذ", "Times done"), c("revenue", "الإيراد (صافي)", "Revenue (net)", "money"), c("cost", "تكلفة المواد", "Materials cost", "money"), t("costBasis", "أساس التكلفة", "Cost basis"), c("margin", "هامش الربح", "Margin", "money"), c("marginPct", "الهامش %", "Margin %", "percent")],
        rows: out, totals: { name: "", ...tot, marginPct: pct(N(tot.margin), N(tot.revenue)) }, chart: { label: "name", values: ["count"] },
      };
    } },
  // -------------------------------------------------------------- surgeries
  { key: "surgeries-types", group: "surgeries", ar: "العمليات حسب النوع", en: "Surgeries by type", perms: ["surgeries.view"], feature: "surgeries", range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ type: string; total: bigint; completed: bigint; cancelled: bigint; upcoming: bigint; revenue: Prisma.Decimal | null; compl: bigint }[]>`
        SELECT "surgeryType" type, COUNT(*) total, COUNT(*) FILTER (WHERE status = 'COMPLETED') completed, COUNT(*) FILTER (WHERE status = 'CANCELLED') cancelled,
               COUNT(*) FILTER (WHERE status IN ('PLANNED','CONFIRMED','POSTPONED')) upcoming, SUM(price) FILTER (WHERE status = 'COMPLETED') revenue,
               COUNT(*) FILTER (WHERE complications IS NOT NULL AND complications <> '') compl
        FROM "Surgery" WHERE "tenantId" = ${tenantId}::uuid AND "scheduledAt" >= ${q.from} AND "scheduledAt" < ${q.to} ${bIn(`"branchId"`, q.branchIds)} GROUP BY 1 ORDER BY 2 DESC`;
      const out = rows.map((r) => ({ type: r.type, total: N(r.total), completed: N(r.completed), upcoming: N(r.upcoming), cancelled: N(r.cancelled), revenue: r2(N(r.revenue)), avg: N(r.completed) ? r2(N(r.revenue) / N(r.completed)) : 0, complications: N(r.compl) }));
      return {
        columns: [t("type", "نوع العملية", "Surgery type"), c("total", "الإجمالي", "Total"), c("completed", "منفذة", "Completed"), c("upcoming", "قادمة", "Upcoming"), c("cancelled", "ملغاة", "Cancelled"), c("revenue", "الإيرادات", "Revenue", "money"), c("avg", "متوسط السعر", "Avg price", "money"), c("complications", "مضاعفات مسجلة", "Complications")],
        rows: out, totals: { type: "", ...sumRows(out, ["total", "completed", "upcoming", "cancelled", "revenue", "complications"]) }, chart: { label: "type", values: ["completed"] },
      };
    } },
  { key: "surgeries-surgeons", group: "surgeries", ar: "أداء الأطباء الجراحين", en: "Surgeon performance", perms: ["surgeries.view"], feature: "surgeries", range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ name: string | null; total: bigint; completed: bigint; revenue: Prisma.Decimal | null; mins: number | null; reviews: bigint }[]>`
        SELECT u."fullName" name, COUNT(*) total, COUNT(*) FILTER (WHERE s.status = 'COMPLETED') completed, SUM(s.price) FILTER (WHERE s.status = 'COMPLETED') revenue,
               AVG(EXTRACT(EPOCH FROM (s."completedAt" - s."startedAt")) / 60) FILTER (WHERE s."completedAt" IS NOT NULL AND s."startedAt" IS NOT NULL)::float mins,
               (SELECT COUNT(*) FROM "MedicalReview" r WHERE r."surgeryId" = ANY(array_agg(s.id)) AND r.status = 'COMPLETED') reviews
        FROM "Surgery" s LEFT JOIN "User" u ON u.id = s."surgeonId"
        WHERE s."tenantId" = ${tenantId}::uuid AND s."scheduledAt" >= ${q.from} AND s."scheduledAt" < ${q.to} ${bIn(`s."branchId"`, q.branchIds)} GROUP BY 1 ORDER BY 3 DESC`;
      const out = rows.map((r) => ({ name: r.name ?? "—", total: N(r.total), completed: N(r.completed), revenue: r2(N(r.revenue)), mins: r.mins === null ? null : Math.round(r.mins), reviews: N(r.reviews) }));
      return { columns: [t("name", "الجرّاح", "Surgeon"), c("total", "العمليات", "Surgeries"), c("completed", "منفذة", "Completed"), c("revenue", "الإيرادات", "Revenue", "money"), c("mins", "متوسط المدة (دقيقة)", "Avg duration (min)"), c("reviews", "مراجعات ما بعد العملية", "Post-op reviews")], rows: out, totals: { name: "", ...sumRows(out, ["total", "completed", "revenue", "reviews"]) }, chart: { label: "name", values: ["completed"] } };
    } },
  // ---------------------------------------------------------------- reviews
  { key: "reviews-doctors", group: "reviews", ar: "المراجعات حسب الطبيب", en: "Reviews by doctor", perms: ["reviews.view"], feature: "reviews", range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ name: string | null; total: bigint; completed: bigint; missed: bigint; cancelled: bigint; scheduled: bigint }[]>`
        SELECT u."fullName" name, COUNT(*) total, COUNT(*) FILTER (WHERE r.status = 'COMPLETED') completed, COUNT(*) FILTER (WHERE r.status = 'MISSED') missed,
               COUNT(*) FILTER (WHERE r.status = 'CANCELLED') cancelled, COUNT(*) FILTER (WHERE r.status = 'SCHEDULED') scheduled
        FROM "MedicalReview" r LEFT JOIN "User" u ON u.id = r."doctorId"
        WHERE r."tenantId" = ${tenantId}::uuid AND r."scheduledAt" >= ${q.from} AND r."scheduledAt" < ${q.to} ${bIn(`r."branchId"`, q.branchIds)} GROUP BY 1 ORDER BY 2 DESC`;
      const out = rows.map((r) => ({ name: r.name ?? "—", total: N(r.total), completed: N(r.completed), scheduled: N(r.scheduled), missed: N(r.missed), cancelled: N(r.cancelled), rate: pct(N(r.completed), N(r.total) - N(r.scheduled)) }));
      return { columns: [t("name", "الطبيب", "Doctor"), c("total", "المراجعات", "Reviews"), c("completed", "مكتملة", "Completed"), c("scheduled", "مجدولة", "Scheduled"), c("missed", "فائتة", "Missed"), c("cancelled", "ملغاة", "Cancelled"), c("rate", "نسبة الإنجاز", "Completion", "percent")], rows: out, totals: { name: "", ...sumRows(out, ["total", "completed", "scheduled", "missed", "cancelled"]) }, chart: { label: "name", values: ["completed", "missed"] } };
    } },
  { key: "reviews-reasons", group: "reviews", ar: "أسباب المراجعة ونتائج المتابعة", en: "Review reasons & outcomes", perms: ["reviews.view"], feature: "reviews", range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ reason: string; outcome: string | null; n: bigint }[]>`
        SELECT "reasonType" reason, outcome, COUNT(*) n FROM "MedicalReview"
        WHERE "tenantId" = ${tenantId}::uuid AND "scheduledAt" >= ${q.from} AND "scheduledAt" < ${q.to} ${bIn(`"branchId"`, q.branchIds)} GROUP BY 1, 2`;
      const outcomes = [...new Set(rows.map((r) => r.outcome ?? "PENDING"))];
      const reasons = [...new Set(rows.map((r) => r.reason))];
      const out = reasons.map((rs) => {
        const row: Row = { reason: rs, total: rows.filter((r) => r.reason === rs).reduce((a, r) => a + N(r.n), 0) };
        for (const o of outcomes) row[`o_${o}`] = N(rows.find((r) => r.reason === rs && (r.outcome ?? "PENDING") === o)?.n);
        return row;
      }).sort((a, b) => N(b.total) - N(a.total));
      return { columns: [t("reason", "سبب المراجعة", "Reason"), c("total", "العدد", "Count"), ...outcomes.map((o) => c(`o_${o}`, OUT_AR[o] ?? o, OUT_EN[o] ?? o))], rows: out, totals: { reason: "", ...sumRows(out, ["total", ...outcomes.map((o) => `o_${o}`)]) }, chart: { label: "reason", values: ["total"] } };
    } },
  // -------------------------------------------------------------- inventory
  { key: "inventory-movements", group: "inventory", ar: "حركة المواد", en: "Stock movements", perms: ["inventory.view"], feature: "inventory", range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ type: string; docs: bigint; qin: Prisma.Decimal | null; qout: Prisma.Decimal | null; vin: Prisma.Decimal | null; vout: Prisma.Decimal | null }[]>`
        SELECT d.type::text type, COUNT(DISTINCT d.id) docs, SUM(m.quantity) FILTER (WHERE m.quantity > 0) qin, -SUM(m.quantity) FILTER (WHERE m.quantity < 0) qout,
               SUM(m."totalCost") FILTER (WHERE m.quantity > 0) vin, -SUM(m."totalCost") FILTER (WHERE m.quantity < 0) vout
        FROM "StockDocument" d JOIN "StockMovement" m ON m."documentId" = d.id JOIN "Warehouse" w ON w.id = m."warehouseId"
        WHERE d."tenantId" = ${tenantId}::uuid AND d.date >= ${q.from} AND d.date < ${q.to} ${bIn(`w."branchId"`, q.branchIds)} GROUP BY 1 ORDER BY 2 DESC`;
      const LBL: Record<string, string> = q.lang === "en" ? { RECEIPT: "Receipt", ISSUE: "Issue", TRANSFER: "Transfer", WASTE: "Waste", ADJUSTMENT: "Count adjustment", SALE: "Sale", CONSUMPTION: "Service use", RETURN: "Return" }
        : { RECEIPT: "استلام", ISSUE: "صرف", TRANSFER: "نقل", WASTE: "إتلاف", ADJUSTMENT: "تسوية جرد", SALE: "مبيعات", CONSUMPTION: "استهلاك خدمات", RETURN: "إرجاع" };
      const out = rows.map((r) => ({ type: LBL[r.type] ?? r.type, docs: N(r.docs), qin: r2(N(r.qin)), qout: r2(N(r.qout)), vin: r2(N(r.vin)), vout: r2(N(r.vout)) }));
      return { columns: [t("type", "نوع الحركة", "Movement"), c("docs", "المستندات", "Documents"), c("qin", "كمية واردة", "Qty in"), c("qout", "كمية صادرة", "Qty out"), c("vin", "قيمة واردة", "Value in", "money"), c("vout", "قيمة صادرة", "Value out", "money")], rows: out, totals: { type: "", ...sumRows(out, ["docs", "vin", "vout"]) }, chart: { label: "type", values: ["vin", "vout"] } };
    } },
  { key: "inventory-valuation", group: "inventory", ar: "قيمة المخزون حسب المخزن", en: "Stock value by warehouse", perms: ["inventory.view"], feature: "inventory",
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ name: string; branch: string; items: bigint; qty: Prisma.Decimal | null; value: Prisma.Decimal | null; expired: Prisma.Decimal | null }[]>`
        SELECT w.name, b.name branch, COUNT(DISTINCT l."itemId") FILTER (WHERE l.quantity > 0) items, SUM(l.quantity) qty, SUM(l.quantity * l."unitCost") value,
               SUM(l.quantity * l."unitCost") FILTER (WHERE l."expiryDate" < CURRENT_DATE) expired
        FROM "Warehouse" w JOIN "Branch" b ON b.id = w."branchId" LEFT JOIN "StockLot" l ON l."warehouseId" = w.id
        WHERE w."tenantId" = ${tenantId}::uuid ${bIn(`w."branchId"`, q.branchIds)} GROUP BY w.id, w.name, b.name ORDER BY 5 DESC NULLS LAST`;
      const out = rows.map((r) => ({ name: r.name, branch: r.branch, items: N(r.items), qty: r2(N(r.qty)), value: r2(N(r.value)), expired: r2(N(r.expired)) }));
      return { columns: [t("name", "المخزن", "Warehouse"), t("branch", "الفرع", "Branch"), c("items", "الأصناف", "Items"), c("qty", "الكمية", "Quantity"), c("value", "القيمة", "Value", "money"), c("expired", "قيمة المنتهي", "Expired value", "money")], rows: out, totals: { name: "", branch: "", ...sumRows(out, ["items", "value", "expired"]) }, chart: { label: "name", values: ["value"] } };
    } },
  { key: "inventory-shortages", group: "inventory", ar: "النواقص (تحت الحد الأدنى)", en: "Shortages (below minimum)", perms: ["inventory.view"], feature: "inventory",
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ name: string; unit: string; qty: Prisma.Decimal; min: Prisma.Decimal; cost: Prisma.Decimal }[]>`
        SELECT p.name, p.unit, COALESCE(SUM(l.quantity) FILTER (WHERE TRUE ${bIn(`w."branchId"`, q.branchIds)}), 0) qty, p."minStock" min, p.cost
        FROM "Product" p LEFT JOIN "StockLot" l ON l."itemId" = p.id LEFT JOIN "Warehouse" w ON w.id = l."warehouseId"
        WHERE p."tenantId" = ${tenantId}::uuid AND p."trackStock" AND p."isActive" GROUP BY p.id
        HAVING COALESCE(SUM(l.quantity) FILTER (WHERE TRUE ${bIn(`w."branchId"`, q.branchIds)}), 0) < p."minStock" ORDER BY p.name`;
      const out = rows.map((r) => ({ name: r.name, unit: r.unit, qty: r2(N(r.qty)), min: r2(N(r.min)), short: r2(N(r.min) - N(r.qty)), reorder: r2((N(r.min) - N(r.qty)) * N(r.cost)) }));
      return { columns: [t("name", "الصنف", "Item"), t("unit", "الوحدة", "Unit"), c("qty", "الرصيد", "On hand"), c("min", "الحد الأدنى", "Minimum"), c("short", "النقص", "Short by"), c("reorder", "تكلفة الاستكمال", "Reorder cost", "money")], rows: out, totals: { name: "", unit: "", ...sumRows(out, ["reorder"]) } };
    } },
  { key: "inventory-expired", group: "inventory", ar: "المواد المنتهية وقريبة الانتهاء", en: "Expired & expiring stock", perms: ["inventory.view"], feature: "inventory", days: { ar: "تنتهي خلال (يوم)", en: "Expiring within (days)", def: 30 },
    run: async (tx, tenantId, q) => {
      const lots = await tx.stockLot.findMany({ where: { tenantId, quantity: { gt: 0 }, expiryDate: { lte: new Date(Date.now() + q.days * 86400000) }, ...(q.branchIds ? { warehouseId: { in: (await tx.warehouse.findMany({ where: { tenantId, branchId: { in: q.branchIds } }, select: { id: true } })).map((w) => w.id) } } : {}) }, orderBy: { expiryDate: "asc" }, take: 2000 });
      const items = await tx.product.findMany({ where: { tenantId, id: { in: lots.map((l) => l.itemId) } }, select: { id: true, name: true, unit: true } });
      const whs = await tx.warehouse.findMany({ where: { tenantId }, select: { id: true, name: true } });
      const today = new Date();
      const out = lots.map((l) => ({ item: items.find((i) => i.id === l.itemId)?.name, warehouse: whs.find((w) => w.id === l.warehouseId)?.name, lot: l.lotNo, expiry: l.expiryDate, status: l.expiryDate! < today ? L2(q, "منتهي", "Expired") : L2(q, "قريب الانتهاء", "Expiring soon"), qty: N(l.quantity), value: r2(N(l.quantity) * N(l.unitCost)) }));
      return { columns: [t("item", "الصنف", "Item"), t("warehouse", "المخزن", "Warehouse"), t("lot", "التشغيلة", "Lot"), c("expiry", "الانتهاء", "Expiry", "date"), t("status", "الحالة", "Status"), c("qty", "الكمية", "Qty"), c("value", "القيمة", "Value", "money")], rows: out, totals: { item: "", ...sumRows(out, ["value"]) } };
    } },
  // ---------------------------------------------------------------- finance
  { key: "finance-monthly", group: "finance", ar: "الإيرادات والمصروفات والأرباح", en: "Revenue, expenses & profit", perms: ["finance.view_data"], range: true,
    run: async (tx, tenantId, q, ctx) => {
      const qm = { ...q, bucket: "month" as const };
      const [sales, cash, ledger] = await Promise.all([
        tx.$queryRaw<{ b: string; v: Prisma.Decimal }[]>`SELECT ${bucketSql(`"issuedAt"`, qm)} b, SUM(total) v FROM "Invoice" WHERE "tenantId" = ${tenantId}::uuid AND status NOT IN ('DRAFT','CANCELLED') AND "issuedAt" >= ${q.from} AND "issuedAt" < ${q.to} ${bIn(`"branchId"`, q.branchIds)} GROUP BY 1`,
        tx.$queryRaw<{ b: string; v: Prisma.Decimal }[]>`SELECT ${bucketSql(`p."paidAt"`, qm)} b, SUM(CASE WHEN p.kind = 'PAYMENT' THEN p.amount ELSE -p.amount END) v FROM "Payment" p JOIN "Invoice" i ON i.id = p."invoiceId" WHERE p."tenantId" = ${tenantId}::uuid AND p."paidAt" >= ${q.from} AND p."paidAt" < ${q.to} ${bIn(`i."branchId"`, q.branchIds)} GROUP BY 1`,
        ctx.features.has("accounting") || true ? tx.$queryRaw<{ b: string; type: string; v: Prisma.Decimal }[]>`
          SELECT ${bucketSql(`e.date`, qm)} b, a.type::text type, SUM(CASE WHEN a.type = 'REVENUE' THEN l.credit - l.debit ELSE l.debit - l.credit END) v
          FROM "JournalLine" l JOIN "Account" a ON a.id = l."accountId" JOIN "JournalEntry" e ON e.id = l."entryId"
          WHERE l."tenantId" = ${tenantId}::uuid AND a.type IN ('REVENUE','EXPENSE') AND e.date >= ${q.from} AND e.date < ${q.to} ${bIn(`l."branchId"`, q.branchIds)} GROUP BY 1, 2` : Promise.resolve([]),
      ]);
      const buckets = [...new Set([...sales, ...cash, ...ledger].map((r) => r.b))].sort();
      const out = buckets.map((b) => {
        const rev = N(ledger.find((r) => r.b === b && r.type === "REVENUE")?.v), exp = N(ledger.find((r) => r.b === b && r.type === "EXPENSE")?.v);
        return { bucket: b, sales: r2(N(sales.find((r) => r.b === b)?.v)), collected: r2(N(cash.find((r) => r.b === b)?.v)), revenue: r2(rev), expenses: r2(exp), profit: r2(rev - exp), margin: pct(rev - exp, rev) };
      });
      const tot = sumRows(out, ["sales", "collected", "revenue", "expenses", "profit"]);
      return {
        columns: [t("bucket", "الشهر", "Month"), c("sales", "المبيعات الصادرة", "Sales issued", "money"), c("collected", "المحصّل", "Collected", "money"), c("revenue", "الإيراد المستحق", "Revenue earned", "money"), c("expenses", "المصروفات", "Expenses", "money"), c("profit", "صافي الربح", "Net profit", "money"), c("margin", "الهامش", "Margin", "percent")],
        rows: out, totals: { bucket: "", ...tot, margin: pct(N(tot.profit), N(tot.revenue)) }, chart: { label: "bucket", values: ["revenue", "expenses", "profit"] },
        summary: [{ ar: "الإيراد", en: "Revenue", value: tot.revenue as number, type: "money" }, { ar: "المصروفات", en: "Expenses", value: tot.expenses as number, type: "money" }, { ar: "صافي الربح", en: "Net profit", value: tot.profit as number, type: "money" }],
      };
    } },
  { key: "receivables", group: "finance", ar: "الديون والمستحقات (أعمار الديون)", en: "Receivables aging", perms: ["finance.view_data", "invoices.view"],
    run: async (tx, tenantId, q) => {
      const invs = await tx.invoice.findMany({ where: { tenantId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, ...bWhere(q.branchIds) }, include: { client: { select: { code: true, fullName: true, phone: true } }, installments: { orderBy: { seq: "asc" } } } });
      const today = Date.now();
      const by = new Map<string, Row>();
      for (const i of invs) {
        const due = N(i.total) - N(i.paidTotal);
        let left = N(i.paidTotal), dd = i.dueDate ?? i.issuedAt;
        for (const x of i.installments) { const p = Math.min(left, N(x.amount)); left -= p; if (N(x.amount) > p) { dd = x.dueDate; break; } }
        const age = dd ? Math.floor((today - +dd) / 86400000) : 0;
        const k = i.clientId ?? "walk-in";
        const r = by.get(k) ?? { client: i.client?.fullName ?? "—", code: i.client?.code ?? "", phone: i.client?.phone ?? "", invoices: 0, total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
        r.invoices = N(r.invoices) + 1; r.total = r2(N(r.total) + due);
        const bucket = age <= 0 ? "current" : age <= 30 ? "d30" : age <= 60 ? "d60" : age <= 90 ? "d90" : "d90p";
        r[bucket] = r2(N(r[bucket]) + due);
        by.set(k, r);
      }
      const out = [...by.values()].sort((a, b) => N(b.total) - N(a.total));
      return {
        columns: [t("code", "الرمز", "Code"), t("client", "العميل", "Client"), t("phone", "الهاتف", "Phone"), c("invoices", "الفواتير", "Invoices"), c("total", "المستحق", "Due", "money"), c("current", "غير مستحق بعد", "Not yet due", "money"), c("d30", "1–30 يوم", "1–30 days", "money"), c("d60", "31–60", "31–60", "money"), c("d90", "61–90", "61–90", "money"), c("d90p", "+90", "90+", "money")],
        rows: out, totals: { code: "", client: "", phone: "", ...sumRows(out, ["invoices", "total", "current", "d30", "d60", "d90", "d90p"]) },
      };
    } },
  { key: "payments-methods", group: "finance", ar: "التحصيل حسب طريقة الدفع", en: "Collections by payment method", perms: ["finance.view_data"], range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.payment.groupBy({ by: ["method", "kind"], where: { tenantId, paidAt: { gte: q.from, lt: q.to }, ...(q.branchIds ? { invoice: { branchId: { in: q.branchIds } } } : {}) }, _count: true, _sum: { amount: true } });
      const methods = [...new Set(rows.map((r) => r.method))];
      const L: Record<string, string> = { CASH: L2(q, "نقداً", "Cash"), CARD: L2(q, "بطاقة", "Card"), TRANSFER: L2(q, "تحويل", "Transfer"), OTHER: L2(q, "أخرى", "Other") };
      const out = methods.map((m) => { const p = rows.find((r) => r.method === m && r.kind === "PAYMENT"), f = rows.find((r) => r.method === m && r.kind === "REFUND"); return { method: L[m] ?? m, count: p?._count ?? 0, amount: N(p?._sum.amount), refunds: N(f?._sum.amount), net: r2(N(p?._sum.amount) - N(f?._sum.amount)) }; });
      return { columns: [t("method", "الطريقة", "Method"), c("count", "الدفعات", "Payments"), c("amount", "المقبوض", "Received", "money"), c("refunds", "المسترد", "Refunded", "money"), c("net", "الصافي", "Net", "money")], rows: out, totals: { method: "", ...sumRows(out, ["count", "amount", "refunds", "net"]) }, chart: { label: "method", values: ["net"] } };
    } },
  // ------------------------------------------------------------------ extra
  { key: "subscriptions-stats", group: "extra", ar: "إحصائيات الاشتراكات", en: "Subscription statistics", perms: ["subscriptions.view"], feature: "subscriptions", range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ name: string; sold: bigint; revenue: Prisma.Decimal | null; active: bigint; expired: bigint; cancelled: bigint; renewals: bigint }[]>`
        SELECT name, COUNT(*) FILTER (WHERE "createdAt" >= ${q.from} AND "createdAt" < ${q.to}) sold, SUM(price) FILTER (WHERE "createdAt" >= ${q.from} AND "createdAt" < ${q.to}) revenue,
               COUNT(*) FILTER (WHERE status = 'ACTIVE') active, COUNT(*) FILTER (WHERE status = 'EXPIRED') expired, COUNT(*) FILTER (WHERE status = 'CANCELLED') cancelled,
               COUNT(*) FILTER (WHERE "renewedFromId" IS NOT NULL AND "createdAt" >= ${q.from} AND "createdAt" < ${q.to}) renewals
        FROM "ClientSubscription" WHERE "tenantId" = ${tenantId}::uuid ${bIn(`"branchId"`, q.branchIds)} GROUP BY 1 ORDER BY 2 DESC`;
      const out = rows.map((r) => ({ name: r.name, sold: N(r.sold), renewals: N(r.renewals), revenue: r2(N(r.revenue)), active: N(r.active), expired: N(r.expired), cancelled: N(r.cancelled), renewRate: pct(N(r.renewals), N(r.expired) + N(r.renewals)) }));
      return { columns: [t("name", "الاشتراك", "Subscription"), c("sold", "مبيعة بالفترة", "Sold in period"), c("renewals", "تجديدات", "Renewals"), c("revenue", "الإيراد", "Revenue", "money"), c("active", "سارية الآن", "Active now"), c("expired", "منتهية", "Expired"), c("cancelled", "ملغاة", "Cancelled"), c("renewRate", "نسبة التجديد", "Renewal rate", "percent")], rows: out, totals: { name: "", ...sumRows(out, ["sold", "renewals", "revenue", "active", "expired", "cancelled"]) }, chart: { label: "name", values: ["sold"] } };
    } },
  { key: "coupons-stats", group: "extra", ar: "إحصائيات الكوبونات", en: "Coupon statistics", perms: ["coupons.view"], feature: "coupons", range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ code: string; name: string; owner: string | null; inf: string | null; uses: bigint; discount: Prisma.Decimal | null; revenue: Prisma.Decimal | null; active: boolean }[]>`
        SELECT c.code, c.name, u."fullName" owner, f.name inf, c."isActive" active, COUNT(i.id) uses, SUM(i."couponDiscount") discount, SUM(i.total - i."refundedTotal") revenue
        FROM "Coupon" c LEFT JOIN "User" u ON u.id = c."ownerUserId" LEFT JOIN "Influencer" f ON f.id = c."influencerId"
        LEFT JOIN "Invoice" i ON i."couponId" = c.id AND i.status NOT IN ('DRAFT','CANCELLED') AND i."issuedAt" >= ${q.from} AND i."issuedAt" < ${q.to} ${bIn(`i."branchId"`, q.branchIds)}
        WHERE c."tenantId" = ${tenantId}::uuid GROUP BY c.id, u."fullName", f.name ORDER BY 6 DESC`;
      const out = rows.map((r) => ({ code: r.code, name: r.name, owner: r.inf ?? r.owner ?? "—", uses: N(r.uses), discount: r2(N(r.discount)), revenue: r2(N(r.revenue)), avg: N(r.uses) ? r2(N(r.revenue) / N(r.uses)) : 0, status: r.active ? "✓" : "✗" }));
      return { columns: [t("code", "الكود", "Code"), t("name", "الاسم", "Name"), t("owner", "المالك / المؤثر", "Owner / influencer"), c("uses", "الاستخدامات", "Uses"), c("discount", "الخصم الممنوح", "Discount given", "money"), c("revenue", "المبيعات", "Sales", "money"), c("avg", "متوسط الفاتورة", "Avg invoice", "money"), t("status", "فعّال", "Active")], rows: out, totals: { code: "", ...sumRows(out, ["uses", "discount", "revenue"]) }, chart: { label: "code", values: ["uses"] } };
    } },
  { key: "loyalty-stats", group: "extra", ar: "إحصائيات نقاط الولاء", en: "Loyalty statistics", perms: ["loyalty.view"], feature: "loyalty", range: true,
    run: async (tx, tenantId, q) => {
      const [byType, top, settings] = await Promise.all([
        tx.loyaltyTransaction.groupBy({ by: ["type"], where: { tenantId, createdAt: { gte: q.from, lt: q.to } }, _sum: { points: true }, _count: true }),
        tx.$queryRaw<{ id: string; code: string; name: string; balance: bigint; earned: bigint; redeemed: bigint }[]>`
          SELECT c.id, c.code, c."fullName" name, SUM(t.points) balance, SUM(t.points) FILTER (WHERE t.type = 'EARN' AND t."createdAt" >= ${q.from} AND t."createdAt" < ${q.to}) earned,
                 -SUM(t.points) FILTER (WHERE t.type = 'REDEEM' AND t."createdAt" >= ${q.from} AND t."createdAt" < ${q.to}) redeemed
          FROM "LoyaltyTransaction" t JOIN "Client" c ON c.id = t."clientId" WHERE t."tenantId" = ${tenantId}::uuid ${bIn(`c."branchId"`, q.branchIds)}
          GROUP BY c.id ORDER BY 4 DESC LIMIT 200`,
        tx.tenantSettings.findUnique({ where: { tenantId } }),
      ]);
      const pv = N(settings?.pointValue);
      const outstanding = top.reduce((a, r) => a + N(r.balance), 0);
      const g = (t0: string) => N(byType.find((x) => x.type === t0)?._sum.points);
      return {
        columns: [t("code", "الرمز", "Code"), t("name", "العميل", "Client"), c("earned", "نقاط مكتسبة بالفترة", "Earned in period"), c("redeemed", "نقاط مستبدلة بالفترة", "Redeemed in period"), c("balance", "الرصيد", "Balance"), c("value", "قيمة الرصيد", "Balance value", "money")],
        rows: top.map((r) => ({ code: r.code, name: r.name, earned: N(r.earned), redeemed: N(r.redeemed), balance: N(r.balance), value: r2(N(r.balance) * pv) })),
        summary: [{ ar: "نقاط مكتسبة", en: "Points earned", value: g("EARN") }, { ar: "نقاط مستبدلة", en: "Points redeemed", value: -g("REDEEM") }, { ar: "نقاط ملغاة/معكوسة", en: "Reversed", value: -g("REVERSE") }, { ar: "قيمة الأرصدة القائمة (أعلى 200)", en: "Outstanding value (top 200)", value: r2(outstanding * pv), type: "money" }],
      };
    } },
  { key: "influencers", group: "extra", ar: "أداء المؤثرين", en: "Influencer performance", perms: ["marketing.view"], feature: "marketing", range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.$queryRaw<{ name: string; platform: string | null; referred: bigint; converted: bigint; invoices: bigint; revenue: Prisma.Decimal | null; earned: Prisma.Decimal | null; paid: Prisma.Decimal | null }[]>`
        SELECT f.name, f.platform,
          (SELECT COUNT(*) FROM "Client" c WHERE c."influencerId" = f.id AND c."createdAt" >= ${q.from} AND c."createdAt" < ${q.to} ${bIn(`c."branchId"`, q.branchIds)}) referred,
          (SELECT COUNT(*) FROM "Client" c WHERE c."influencerId" = f.id AND c.status = 'ACTIVE' AND c."createdAt" >= ${q.from} AND c."createdAt" < ${q.to} ${bIn(`c."branchId"`, q.branchIds)}) converted,
          (SELECT COUNT(*) FROM "Invoice" i JOIN "Client" c ON c.id = i."clientId" WHERE c."influencerId" = f.id AND i.status NOT IN ('DRAFT','CANCELLED') AND i."issuedAt" >= ${q.from} AND i."issuedAt" < ${q.to} ${bIn(`i."branchId"`, q.branchIds)}) invoices,
          (SELECT SUM(i.total - i."refundedTotal") FROM "Invoice" i JOIN "Client" c ON c.id = i."clientId" WHERE c."influencerId" = f.id AND i.status NOT IN ('DRAFT','CANCELLED') AND i."issuedAt" >= ${q.from} AND i."issuedAt" < ${q.to} ${bIn(`i."branchId"`, q.branchIds)}) revenue,
          (SELECT SUM(amount) FROM "InfluencerCommission" x WHERE x."influencerId" = f.id AND x.status <> 'VOID' AND x."earnedAt" >= ${q.from} AND x."earnedAt" < ${q.to}) earned,
          (SELECT SUM(amount) FROM "InfluencerCommission" x WHERE x."influencerId" = f.id AND x.status = 'PAID' AND x."paidAt" >= ${q.from} AND x."paidAt" < ${q.to}) paid
        FROM "Influencer" f WHERE f."tenantId" = ${tenantId}::uuid ORDER BY 6 DESC NULLS LAST`;
      const out = rows.map((r) => ({ name: r.name, platform: r.platform, referred: N(r.referred), converted: N(r.converted), rate: pct(N(r.converted), N(r.referred)), invoices: N(r.invoices), revenue: r2(N(r.revenue)), earned: r2(N(r.earned)), paid: r2(N(r.paid)), roi: N(r.earned) ? r2(N(r.revenue) / N(r.earned)) : null }));
      return { columns: [t("name", "المؤثر", "Influencer"), t("platform", "المنصة", "Platform"), c("referred", "عملاء جدد", "Referred"), c("converted", "تحولوا", "Converted"), c("rate", "التحويل", "Conversion", "percent"), c("invoices", "الفواتير", "Invoices"), c("revenue", "المبيعات", "Sales", "money"), c("earned", "العمولة المستحقة", "Commission earned", "money"), c("paid", "المدفوع", "Paid", "money"), c("roi", "مبيعات لكل وحدة عمولة", "Sales per commission unit")], rows: out, totals: { name: "", platform: "", ...sumRows(out, ["referred", "converted", "invoices", "revenue", "earned", "paid"]) }, chart: { label: "name", values: ["revenue"] } };
    } },
  { key: "campaigns", group: "extra", ar: "أداء الحملات التسويقية", en: "Campaign performance", perms: ["marketing.view"], feature: "marketing", range: true,
    run: async (tx, tenantId, q) => {
      const camps = await tx.campaign.findMany({ where: { tenantId, sentAt: { gte: q.from, lt: q.to } }, orderBy: { sentAt: "desc" } });
      const out: Row[] = [];
      for (const cp of camps) {
        const st = await tx.message.groupBy({ by: ["status"], where: { tenantId, campaignId: cp.id }, _count: true });
        const n = (s: string[]) => st.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count, 0);
        const win = { gte: cp.sentAt!, lt: new Date(+cp.sentAt! + cp.attributionDays * 86400000) };
        const ids = [...new Set((await tx.message.findMany({ where: { tenantId, campaignId: cp.id, status: { in: ["SENT", "DELIVERED", "READ"] } }, select: { clientId: true } })).map((m) => m.clientId!).filter(Boolean))];
        const invs = ids.length ? await tx.invoice.findMany({ where: { tenantId, clientId: { in: ids }, issuedAt: win, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { clientId: true, total: true } }) : [];
        const rev = invs.reduce((a, i) => a + N(i.total), 0);
        out.push({ name: cp.name, code: cp.code, sent: n(["SENT", "DELIVERED", "READ"]), delivered: n(["DELIVERED", "READ"]), read: n(["READ"]), failed: n(["FAILED"]), converted: new Set(invs.map((i) => i.clientId)).size, revenue: r2(rev), budget: N(cp.budget), roi: N(cp.budget) ? pct(rev - N(cp.budget), N(cp.budget)) : null });
      }
      return { columns: [t("code", "الرمز", "Code"), t("name", "الحملة", "Campaign"), c("sent", "مرسلة", "Sent"), c("delivered", "مستلمة", "Delivered"), c("read", "مقروءة", "Read"), c("failed", "فاشلة", "Failed"), c("converted", "عملاء اشتروا", "Buyers"), c("revenue", "المبيعات", "Sales", "money"), c("budget", "الميزانية", "Budget", "money"), c("roi", "العائد ROI", "ROI", "percent")], rows: out, totals: { code: "", name: "", ...sumRows(out, ["sent", "delivered", "read", "failed", "converted", "revenue", "budget"]) }, chart: { label: "name", values: ["revenue"] } };
    } },
  { key: "messaging", group: "extra", ar: "الرسائل والإشعارات", en: "Messages & notifications", perms: ["notifications.view"], feature: "notifications", range: true,
    run: async (tx, tenantId, q) => {
      const rows = await tx.message.groupBy({ by: ["category", "status"], where: { tenantId, createdAt: { gte: q.from, lt: q.to } }, _count: true });
      const cats = [...new Set(rows.map((r) => r.category))];
      const out = cats.map((cat) => {
        const n = (s: string[]) => rows.filter((r) => r.category === cat && s.includes(r.status)).reduce((a, r) => a + r._count, 0);
        const total = n(["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED"]);
        return { category: cat, total, sent: n(["SENT", "DELIVERED", "READ"]), delivered: n(["DELIVERED", "READ"]), read: n(["READ"]), failed: n(["FAILED"]), cancelled: n(["CANCELLED"]), queued: n(["QUEUED", "SENDING"]), rate: pct(n(["DELIVERED", "READ"]), n(["SENT", "DELIVERED", "READ", "FAILED"])) };
      });
      return { columns: [t("category", "النوع", "Type"), c("total", "الإجمالي", "Total"), c("sent", "مرسلة", "Sent"), c("delivered", "مستلمة", "Delivered"), c("read", "مقروءة", "Read"), c("failed", "فاشلة", "Failed"), c("cancelled", "ملغاة", "Cancelled"), c("queued", "بالانتظار", "Queued"), c("rate", "نسبة الاستلام", "Delivery rate", "percent")], rows: out, totals: { category: "", ...sumRows(out, ["total", "sent", "delivered", "read", "failed", "cancelled", "queued"]) }, chart: { label: "category", values: ["delivered", "failed"] } };
    } },
  // -------------------------------------------------------------- compare
  { key: "branches-compare", group: "compare", ar: "مقارنة الفروع", en: "Branch comparison", perms: ["dashboard.view"], range: true,
    run: async (tx, tenantId, q, ctx) => {
      const branches = await tx.branch.findMany({ where: { tenantId, ...(q.branchIds ? { id: { in: q.branchIds } } : {}) }, orderBy: { createdAt: "asc" } });
      const range = { gte: q.from, lt: q.to };
      const [clients, appts, invs, ledger] = await Promise.all([
        tx.client.groupBy({ by: ["branchId"], where: { tenantId, createdAt: range, deletedAt: null, status: { not: "LEAD" } }, _count: true }),
        tx.appointment.groupBy({ by: ["branchId", "status"], where: { tenantId, startsAt: range }, _count: true }),
        tx.invoice.groupBy({ by: ["branchId"], where: { tenantId, issuedAt: range, status: { notIn: ["DRAFT", "CANCELLED"] } }, _count: true, _sum: { total: true, paidTotal: true } }),
        tx.$queryRaw<{ branchId: string; type: string; v: Prisma.Decimal }[]>`
          SELECT l."branchId", a.type::text type, SUM(CASE WHEN a.type = 'REVENUE' THEN l.credit - l.debit ELSE l.debit - l.credit END) v
          FROM "JournalLine" l JOIN "Account" a ON a.id = l."accountId" JOIN "JournalEntry" e ON e.id = l."entryId"
          WHERE l."tenantId" = ${tenantId}::uuid AND a.type IN ('REVENUE','EXPENSE') AND e.date >= ${q.from} AND e.date < ${q.to} AND l."branchId" IS NOT NULL GROUP BY 1, 2`,
      ]);
      const ap = (b: string, s: string) => appts.find((x) => x.branchId === b && x.status === s)?._count ?? 0;
      const rows = branches.map((b) => {
        const iv = invs.find((x) => x.branchId === b.id);
        const rev = N(ledger.find((x) => x.branchId === b.id && x.type === "REVENUE")?.v), exp = N(ledger.find((x) => x.branchId === b.id && x.type === "EXPENSE")?.v);
        const done = ap(b.id, "COMPLETED"), all = appts.filter((x) => x.branchId === b.id).reduce((a, x) => a + x._count, 0);
        return { name: b.name, newClients: clients.find((x) => x.branchId === b.id)?._count ?? 0, visits: done, cancelled: ap(b.id, "CANCELLED"), noShow: ap(b.id, "NO_SHOW"), attendance: pct(done, all - ap(b.id, "SCHEDULED") - ap(b.id, "CONFIRMED")), invoices: iv?._count ?? 0, sales: r2(N(iv?._sum.total)), avgTicket: iv?._count ? r2(N(iv._sum.total) / iv._count) : 0, expenses: r2(exp), profit: r2(rev - exp) };
      });
      const cols = [t("name", "الفرع", "Branch"), c("newClients", "عملاء جدد", "New clients"), c("visits", "زيارات منفذة", "Visits done"), c("cancelled", "إلغاءات", "Cancelled"), c("noShow", "عدم حضور", "No-shows"), c("attendance", "نسبة الالتزام", "Show rate", "percent"), c("invoices", "الفواتير", "Invoices"), c("sales", "المبيعات", "Sales", "money"), c("avgTicket", "متوسط الفاتورة", "Avg ticket", "money")];
      if (ctx.features.has("accounting")) cols.push(c("expenses", "المصروفات المباشرة", "Direct expenses", "money"), c("profit", "ربح الفرع", "Branch profit", "money"));
      return { columns: cols, rows, totals: { name: "", ...sumRows(rows, ["newClients", "visits", "cancelled", "noShow", "invoices", "sales", "expenses", "profit"]) }, chart: { label: "name", values: ["sales"] } };
    } },
  { key: "period-compare", group: "compare", ar: "مقارنة الفترات الزمنية", en: "Period comparison", perms: ["dashboard.view"], range: true,
    run: async (tx, tenantId, q, ctx) => {
      const len = +q.to - +q.from;
      const prev = { from: new Date(+q.from - len), to: q.from };
      const kpis = async (from: Date, to: Date) => {
        const range = { gte: from, lt: to };
        const [nc, ap, inv, pay, led] = await Promise.all([
          tx.client.count({ where: { tenantId, createdAt: range, deletedAt: null, status: { not: "LEAD" }, ...bWhere(q.branchIds) } }),
          tx.appointment.groupBy({ by: ["status"], where: { tenantId, startsAt: range, ...bWhere(q.branchIds) }, _count: true }),
          tx.invoice.aggregate({ where: { tenantId, issuedAt: range, status: { notIn: ["DRAFT", "CANCELLED"] }, ...bWhere(q.branchIds) }, _count: true, _sum: { total: true } }),
          tx.payment.groupBy({ by: ["kind"], where: { tenantId, paidAt: range, ...(q.branchIds ? { invoice: { branchId: { in: q.branchIds } } } : {}) }, _sum: { amount: true } }),
          tx.$queryRaw<{ type: string; v: Prisma.Decimal }[]>`
            SELECT a.type::text type, SUM(CASE WHEN a.type = 'REVENUE' THEN l.credit - l.debit ELSE l.debit - l.credit END) v
            FROM "JournalLine" l JOIN "Account" a ON a.id = l."accountId" JOIN "JournalEntry" e ON e.id = l."entryId"
            WHERE l."tenantId" = ${tenantId}::uuid AND a.type IN ('REVENUE','EXPENSE') AND e.date >= ${from} AND e.date < ${to} ${bIn(`l."branchId"`, q.branchIds)} GROUP BY 1`,
        ]);
        const s = (st: string) => ap.find((x) => x.status === st)?._count ?? 0;
        const rev = N(led.find((x) => x.type === "REVENUE")?.v), exp = N(led.find((x) => x.type === "EXPENSE")?.v);
        return {
          newClients: nc, visits: s("COMPLETED"), cancelled: s("CANCELLED"), noShow: s("NO_SHOW"), invoices: inv._count, sales: N(inv._sum.total),
          collected: N(pay.find((p) => p.kind === "PAYMENT")?._sum.amount) - N(pay.find((p) => p.kind === "REFUND")?._sum.amount),
          avgTicket: inv._count ? N(inv._sum.total) / inv._count : 0, revenue: rev, expenses: exp, profit: rev - exp,
        };
      };
      const [cur, old] = await Promise.all([kpis(q.from, q.to), kpis(prev.from, prev.to)]);
      const L: [keyof typeof cur, string, string, ColType][] = [
        ["newClients", "عملاء جدد", "New clients", "number"], ["visits", "زيارات منفذة", "Visits done", "number"], ["cancelled", "إلغاءات", "Cancellations", "number"], ["noShow", "عدم حضور", "No-shows", "number"],
        ["invoices", "الفواتير", "Invoices", "number"], ["sales", "المبيعات", "Sales", "money"], ["collected", "المحصّل", "Collected", "money"], ["avgTicket", "متوسط الفاتورة", "Avg ticket", "money"],
        ["revenue", "الإيراد المستحق", "Revenue earned", "money"], ["expenses", "المصروفات", "Expenses", "money"], ["profit", "صافي الربح", "Net profit", "money"],
      ];
      const finance = ctx.permissions.has("finance.view_data");
      const rows = L.filter((x) => finance || x[3] !== "money").map(([k, ar, en, ty]) => ({ kpi: L2(q, ar, en), kind: ty, current: r2(cur[k]), previous: r2(old[k]), change: r2(cur[k] - old[k]), changePct: old[k] ? r2(((cur[k] - old[k]) / Math.abs(old[k])) * 100) : null }));
      return {
        columns: [t("kpi", "المؤشر", "Indicator"), c("current", "الفترة الحالية", "This period"), c("previous", "الفترة السابقة", "Previous period"), c("change", "الفرق", "Change"), c("changePct", "التغير %", "Change %", "percent")],
        rows, summary: [{ ar: "الفترة السابقة من", en: "Previous period from", value: prev.from.toISOString().slice(0, 10), type: "text" }, { ar: "إلى", en: "to", value: new Date(+prev.to - 1).toISOString().slice(0, 10), type: "text" }],
      };
    } },
];

// ------------------------------------------------------------------- API ----

function allowed(ctx: Ctx, d: Def) {
  return ctx.permissions.has("reports.view") && d.perms.every((p) => ctx.permissions.has(p)) && (!d.feature || ctx.features.has(d.feature));
}

export function listReports(ctx: Ctx) {
  requireTenant(ctx, "reports.view");
  return DEFS.filter((d) => allowed(ctx, d)).map((d) => ({ key: d.key, group: d.group, ar: d.ar, en: d.en, range: !!d.range, days: d.days ?? null }));
}

export async function runReport(ctx: Ctx, key: string, raw: { from?: string | null; to?: string | null; branchId?: string | null; days?: string | null; lang?: string | null }) {
  const tenantId = requireTenant(ctx, "reports.view");
  const d = DEFS.find((x) => x.key === key);
  if (!d) throw notFound("Report not found");
  if (!allowed(ctx, d)) throw forbidden("You don't have access to this report");
  const to = raw.to ? new Date(raw.to) : new Date();
  const from = raw.from ? new Date(raw.from) : new Date(+to - 30 * 86400000);
  if (isNaN(+from) || isNaN(+to) || to <= from) throw badRequest("Invalid date range");
  if (+to - +from > 6 * 366 * 86400000) throw badRequest("Range too large");
  let branchIds: string[] | null = seesAllBranches(ctx) ? null : ctx.user.branchIds;
  if (raw.branchId) {
    if (branchIds && !branchIds.includes(raw.branchId)) throw forbidden("You don't have access to this branch");
    branchIds = [raw.branchId];
  }
  const days = Math.min(3650, Math.max(1, Number(raw.days) || d.days?.def || 30));
  const result = await withTenant(tenantId, async (tx) => {
    const tz = (await tx.tenant.findFirst({ where: { id: tenantId }, select: { timezone: true } }))?.timezone ?? "UTC";
    return d.run(tx, tenantId, { from, to, branchIds, days, tz, bucket: +to - +from > 62 * 86400000 ? "month" : "day", lang: raw.lang === "en" ? "en" : "ar" }, ctx);
  });
  // Hide money from users without finance.view_data.
  if (!ctx.permissions.has("finance.view_data")) {
    const money = new Set(result.columns.filter((x) => x.type === "money").map((x) => x.key));
    result.columns = result.columns.filter((x) => !money.has(x.key));
    const strip = (r: Row | null | undefined) => r && Object.fromEntries(Object.entries(r).filter(([k]) => !money.has(k)));
    result.rows = result.rows.map((r) => strip(r)!);
    result.totals = strip(result.totals) ?? null;
    result.summary = result.summary?.filter((s) => s.type !== "money");
    if (result.chart) result.chart.values = result.chart.values.filter((v) => !money.has(v));
  }
  return { key: d.key, title: { ar: d.ar, en: d.en }, group: d.group, from, to, days, branchIds, ...result };
}

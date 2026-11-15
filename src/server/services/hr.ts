/**
 * HR: employee profiles, weekly shifts, attendance (clock in/out, lateness),
 * leave requests & approvals, salary advances, monthly payroll (base +
 * allowances + approved commissions − advances − absences), performance.
 * Salary data is financial: visible with hr.view, never to other staff.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { optText } from "./common";
import { D, r2, sum, ZERO } from "./money";
import { notifyPermission } from "./notifications";
import { postAdvance, postPayrollApproved, postPayrollPaid } from "./accounting";

const LATE_GRACE_MIN = 10;
const money = z.coerce.number().min(0).max(1e10);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/** Calendar date + wall-clock minutes of `at` in the tenant's timezone. */
export function localParts(at: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(at).map((x) => [x.type, x.value]));
  const date = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  return { date, minutes: +p.hour * 60 + +p.minute, dow: date.getUTCDay() };
}
const toMin = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
const tzOf = async (tx: Tx, tenantId: string) => (await tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone;

async function staffOr400(tx: Tx, tenantId: string, userId: string) {
  const u = await tx.user.findFirst({ where: { id: userId, tenantId } });
  if (!u) throw badRequest("Staff member not found");
  return u;
}

// ------------------------------------------------------------- profiles ----

export const profileSchema = z.object({
  employeeNo: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  department: z.string().trim().max(80).optional().nullable().transform((v) => v || null),
  specialty: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  hireDate: z.coerce.date().optional().nullable().or(z.literal("").transform(() => null)),
  baseSalary: money.default(0), fixedAllowance: money.default(0), monthlyTarget: money.default(0),
  dailyHours: z.coerce.number().min(1).max(24).default(8),
  status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).default("ACTIVE"),
  emergencyContact: optText(200), notes: optText(1000),
});

export async function listEmployees(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "hr.view");
  return withTenant(tenantId, async (tx) => {
    const users = await tx.user.findMany({
      where: { tenantId }, orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true, phone: true, jobTitle: true, status: true, role: { select: { nameAr: true, name: true, key: true } },
        employee: true, shifts: { orderBy: { dayOfWeek: "asc" } }, branchAccess: { select: { branch: { select: { name: true } } } } },
    });
    return users;
  });
}

export async function saveProfile(ctx: Ctx, userId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "hr.update");
  const d = profileSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await staffOr400(tx, tenantId, userId);
    const before = await tx.employeeProfile.findUnique({ where: { userId } });
    const p = await tx.employeeProfile.upsert({ where: { userId }, create: { ...d, userId, tenantId }, update: d });
    await audit(tx, ctx, { action: "hr.profile.save", entity: "EmployeeProfile", entityId: userId, before, after: p });
    return p;
  });
}

export async function saveShifts(ctx: Ctx, userId: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "hr.update");
  const shifts = z.array(z.object({ dayOfWeek: z.coerce.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm, branchId: z.string().uuid().optional().nullable() }))
    .max(7).refine((a) => new Set(a.map((x) => x.dayOfWeek)).size === a.length, "One shift per day")
    .refine((a) => a.every((x) => toMin(x.endTime) > toMin(x.startTime)), "Shift must end after it starts").parse(raw);
  return withTenant(tenantId, async (tx) => {
    await staffOr400(tx, tenantId, userId);
    await tx.workShift.deleteMany({ where: { tenantId, userId } });
    if (shifts.length) await tx.workShift.createMany({ data: shifts.map((s) => ({ ...s, branchId: s.branchId ?? null, tenantId, userId })) });
    await audit(tx, ctx, { action: "hr.shifts.save", entity: "WorkShift", entityId: userId, after: shifts });
    return tx.workShift.findMany({ where: { tenantId, userId }, orderBy: { dayOfWeek: "asc" } });
  });
}

// ----------------------------------------------------------- attendance ----

/** Self-service clock in / out for the signed-in user. */
export async function clock(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx);
  const { action } = z.object({ action: z.enum(["IN", "OUT"]) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const now = new Date();
    const { date, minutes, dow } = localParts(now, await tzOf(tx, tenantId));
    const userId = ctx.user.id;
    const rec = await tx.attendanceRecord.findUnique({ where: { userId_date: { userId, date } } });
    if (action === "IN") {
      if (rec?.checkIn) throw conflict("Already clocked in today");
      const shift = await tx.workShift.findFirst({ where: { tenantId, userId, dayOfWeek: dow } });
      const late = shift ? Math.max(0, minutes - toMin(shift.startTime)) : 0;
      const status = late > LATE_GRACE_MIN ? "LATE" : "PRESENT";
      const r = await tx.attendanceRecord.upsert({
        where: { userId_date: { userId, date } },
        create: { tenantId, userId, date, checkIn: now, status, lateMinutes: late > LATE_GRACE_MIN ? late : 0, recordedById: userId },
        update: { checkIn: now, status, lateMinutes: late > LATE_GRACE_MIN ? late : 0 },
      });
      await audit(tx, ctx, { action: "hr.clock.in", entity: "AttendanceRecord", entityId: r.id, after: { status, late } });
      return r;
    }
    if (!rec?.checkIn) throw conflict("Clock in first");
    if (rec.checkOut) throw conflict("Already clocked out today");
    const r = await tx.attendanceRecord.update({ where: { id: rec.id }, data: { checkOut: now } });
    await audit(tx, ctx, { action: "hr.clock.out", entity: "AttendanceRecord", entityId: r.id });
    return r;
  });
}

export async function myAttendanceToday(ctx: Ctx) {
  const tenantId = requireTenant(ctx);
  return withTenant(tenantId, async (tx) => {
    const { date, dow } = localParts(new Date(), await tzOf(tx, tenantId));
    const [record, shift] = await Promise.all([
      tx.attendanceRecord.findUnique({ where: { userId_date: { userId: ctx.user.id, date } } }),
      tx.workShift.findFirst({ where: { tenantId, userId: ctx.user.id, dayOfWeek: dow } }),
    ]);
    return { date, record, shift };
  });
}

export async function attendanceBoard(ctx: Ctx, q: { date?: string }) {
  const tenantId = requireTenant(ctx, "hr.view");
  return withTenant(tenantId, async (tx) => {
    const tz = await tzOf(tx, tenantId);
    const date = q.date ? new Date(`${q.date}T00:00:00Z`) : localParts(new Date(), tz).date;
    const dow = date.getUTCDay();
    const users = await tx.user.findMany({
      where: { tenantId, status: "ACTIVE" }, orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, jobTitle: true, shifts: { where: { dayOfWeek: dow } }, attendance: { where: { date } } },
    });
    const leaves = await tx.leaveRequest.findMany({ where: { tenantId, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } }, select: { userId: true, type: true } });
    return { date, rows: users.map((u) => ({ id: u.id, fullName: u.fullName, jobTitle: u.jobTitle, shift: u.shifts[0] ?? null, record: u.attendance[0] ?? null, leave: leaves.find((l) => l.userId === u.id)?.type ?? null })) };
  });
}

export async function listAttendance(ctx: Ctx, q: { from: string; to: string; userId?: string }) {
  const tenantId = requireTenant(ctx);
  const all = ctx.permissions.has("hr.view");
  const userId = all ? q.userId : ctx.user.id;
  return withTenant(tenantId, (tx) =>
    tx.attendanceRecord.findMany({
      where: { tenantId, ...(userId ? { userId } : {}), date: { gte: new Date(q.from), lte: new Date(q.to) } },
      include: { user: { select: { fullName: true } } }, orderBy: [{ date: "desc" }], take: 2000,
    }),
  );
}

export async function setAttendance(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "hr.update");
  const d = z.object({
    userId: z.string().uuid(), date: z.coerce.date(), status: z.enum(["PRESENT", "LATE", "ABSENT", "LEAVE"]),
    checkIn: z.coerce.date().optional().nullable(), checkOut: z.coerce.date().optional().nullable(),
    lateMinutes: z.coerce.number().int().min(0).max(1440).default(0), note: optText(300),
  }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    await staffOr400(tx, tenantId, d.userId);
    const date = new Date(Date.UTC(d.date.getUTCFullYear(), d.date.getUTCMonth(), d.date.getUTCDate()));
    const data = { status: d.status, checkIn: d.checkIn ?? null, checkOut: d.checkOut ?? null, lateMinutes: d.status === "LATE" ? d.lateMinutes : 0, note: d.note, recordedById: ctx.user.id };
    const r = await tx.attendanceRecord.upsert({ where: { userId_date: { userId: d.userId, date } }, create: { ...data, tenantId, userId: d.userId, date }, update: data });
    await audit(tx, ctx, { action: "hr.attendance.set", entity: "AttendanceRecord", entityId: r.id, after: r });
    return r;
  });
}

// ---------------------------------------------------------------- leave ----

export async function requestLeave(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx);
  const d = z.object({
    userId: z.string().uuid().optional(), type: z.enum(["ANNUAL", "SICK", "UNPAID", "OTHER"]),
    startDate: z.coerce.date(), endDate: z.coerce.date(), reason: optText(500),
  }).refine((x) => x.endDate >= x.startDate, { message: "End date must be on or after start", path: ["endDate"] }).parse(raw);
  const userId = d.userId ?? ctx.user.id;
  if (userId !== ctx.user.id && !ctx.permissions.has("hr.create")) throw forbidden("You can only request leave for yourself");
  return withTenant(tenantId, async (tx) => {
    await staffOr400(tx, tenantId, userId);
    const overlap = await tx.leaveRequest.findFirst({ where: { tenantId, userId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: d.endDate }, endDate: { gte: d.startDate } } });
    if (overlap) throw conflict("Overlaps another leave request");
    const days = Math.round((+d.endDate - +d.startDate) / 86400000) + 1;
    const l = await tx.leaveRequest.create({ data: { tenantId, userId, type: d.type, startDate: d.startDate, endDate: d.endDate, days, reason: d.reason } });
    await audit(tx, ctx, { action: "hr.leave.request", entity: "LeaveRequest", entityId: l.id, after: l });
    await notifyPermission(tx, tenantId, "hr.approve", { type: "leave.requested", title: "طلب إجازة جديد", body: `${d.startDate.toISOString().slice(0, 10)} → ${d.endDate.toISOString().slice(0, 10)} (${days})`, link: "/hr" });
    return l;
  });
}

export async function listLeaves(ctx: Ctx, q: { status?: string } = {}) {
  const tenantId = requireTenant(ctx);
  const all = ctx.permissions.has("hr.view");
  return withTenant(tenantId, (tx) =>
    tx.leaveRequest.findMany({
      where: { tenantId, ...(all ? {} : { userId: ctx.user.id }), ...(q.status ? { status: q.status as never } : {}) },
      include: { user: { select: { fullName: true, jobTitle: true } } }, orderBy: [{ status: "asc" }, { startDate: "desc" }], take: 500,
    }),
  );
}

export async function decideLeave(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx);
  const d = z.object({ action: z.enum(["APPROVE", "REJECT", "CANCEL"]), note: optText(300) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const l = await tx.leaveRequest.findFirst({ where: { id, tenantId } });
    if (!l) throw notFound("Leave request not found");
    if (d.action === "CANCEL") {
      if (l.userId !== ctx.user.id && !ctx.permissions.has("hr.approve")) throw forbidden();
      if (!["PENDING", "APPROVED"].includes(l.status)) throw conflict("Request is already closed");
    } else {
      if (!ctx.permissions.has("hr.approve")) throw forbidden("Approving leave requires hr.approve");
      if (l.userId === ctx.user.id && ctx.user.roleKey !== "tenant_admin") throw forbidden("You can't approve your own leave");
      if (l.status !== "PENDING") throw conflict("Request is not pending");
    }
    const status = d.action === "APPROVE" ? "APPROVED" : d.action === "REJECT" ? "REJECTED" : "CANCELLED";
    const after = await tx.leaveRequest.update({ where: { id }, data: { status, decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: d.note } });
    await audit(tx, ctx, { action: `hr.leave.${status.toLowerCase()}`, entity: "LeaveRequest", entityId: id, before: { status: l.status }, after: { status } });
    return after;
  });
}

// ------------------------------------------------------------- advances ----

export async function listAdvances(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "hr.view");
  return withTenant(tenantId, (tx) => tx.salaryAdvance.findMany({ where: { tenantId }, include: { user: { select: { fullName: true } } }, orderBy: { givenAt: "desc" }, take: 500 }));
}

export async function createAdvance(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "hr.create");
  const d = z.object({ userId: z.string().uuid(), amount: z.coerce.number().positive().max(1e10), givenAt: z.coerce.date().default(() => new Date()), note: optText(300), cashAccountId: z.string().uuid().optional().nullable() }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    await staffOr400(tx, tenantId, d.userId);
    const a = await tx.salaryAdvance.create({ data: { ...d, tenantId, createdById: ctx.user.id } });
    await postAdvance(tx, tenantId, a.id, ctx.user.id); // Phase 5: Dr advances / Cr cash
    await audit(tx, ctx, { action: "hr.advance.create", entity: "SalaryAdvance", entityId: a.id, after: a });
    return a;
  });
}

// --------------------------------------------------------------- payroll ----

const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const periodRange = (p: string) => { const [y, m] = p.split("-").map(Number); return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }; };

/** (Re)builds a DRAFT payroll run for a month. */
export async function generatePayroll(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "hr.create");
  const { period } = z.object({ period: z.string().regex(periodRe, "Use YYYY-MM") }).parse(raw);
  const { start, end } = periodRange(period);
  return withTenant(tenantId, async (tx) => {
    let run = await tx.payrollRun.findUnique({ where: { tenantId_period: { tenantId, period } } });
    if (run && run.status !== "DRAFT") throw conflict("This month's payroll is already approved");
    run ??= await tx.payrollRun.create({ data: { tenantId, period, createdById: ctx.user.id } });
    await tx.payrollItem.deleteMany({ where: { tenantId, runId: run.id } });

    const staff = await tx.employeeProfile.findMany({ where: { tenantId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, include: { user: { select: { status: true } } } });
    const items: Prisma.PayrollItemCreateManyInput[] = [];
    for (const p of staff.filter((s) => s.user.status === "ACTIVE")) {
      const [comm, adv, absent, unpaid] = await Promise.all([
        tx.commissionEntry.aggregate({ where: { tenantId, userId: p.userId, status: "APPROVED", payrollRunId: null, earnedAt: { lt: end } }, _sum: { amount: true } }),
        tx.salaryAdvance.aggregate({ where: { tenantId, userId: p.userId, status: "OPEN", givenAt: { lt: end } }, _sum: { amount: true } }),
        tx.attendanceRecord.count({ where: { tenantId, userId: p.userId, status: "ABSENT", date: { gte: start, lt: end } } }),
        tx.leaveRequest.findMany({ where: { tenantId, userId: p.userId, status: "APPROVED", type: "UNPAID", startDate: { lt: end }, endDate: { gte: start } } }),
      ]);
      const unpaidDays = unpaid.reduce((n, l) => {
        const a = Math.max(+l.startDate, +start), b = Math.min(+l.endDate, +end - 86400000);
        return n + Math.max(0, Math.round((b - a) / 86400000) + 1);
      }, 0);
      const absenceDays = absent + unpaidDays;
      const base = D(p.baseSalary);
      const absenceDeduction = r2(base.dividedBy(30).times(absenceDays));
      const commissions = D(comm._sum.amount ?? 0);
      const advances = D(adv._sum.amount ?? 0);
      const net = r2(base.plus(p.fixedAllowance).plus(commissions).minus(advances).minus(absenceDeduction));
      items.push({ tenantId, runId: run.id, userId: p.userId, baseSalary: base, allowances: p.fixedAllowance, commissions, advances, absenceDays, absenceDeduction, net });
    }
    if (items.length) await tx.payrollItem.createMany({ data: items });
    const totalNet = sum(items.map((i) => D(i.net as Prisma.Decimal)));
    const after = await tx.payrollRun.update({ where: { id: run.id }, data: { totalNet } });
    await audit(tx, ctx, { action: "hr.payroll.generate", entity: "PayrollRun", entityId: run.id, after: { period, employees: items.length, totalNet } });
    return after;
  });
}

export async function listPayrollRuns(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "hr.view");
  return withTenant(tenantId, (tx) => tx.payrollRun.findMany({ where: { tenantId }, orderBy: { period: "desc" }, include: { _count: { select: { items: true } } } }));
}

export async function getPayrollRun(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "hr.view");
  return withTenant(tenantId, async (tx) => {
    const run = await tx.payrollRun.findFirst({ where: { id, tenantId }, include: { items: { include: { user: { select: { fullName: true, jobTitle: true } } }, orderBy: { user: { fullName: "asc" } } } } });
    if (!run) throw notFound("Payroll run not found");
    return run;
  });
}

export async function updatePayrollItem(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "hr.update");
  const d = z.object({ allowances: money, deductions: money, note: optText(300) }).partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const it = await tx.payrollItem.findFirst({ where: { id, tenantId }, include: { run: true } });
    if (!it) throw notFound("Payroll line not found");
    if (it.run.status !== "DRAFT") throw conflict("Approved payroll can't be edited");
    const allowances = d.allowances !== undefined ? D(d.allowances) : D(it.allowances);
    const deductions = d.deductions !== undefined ? D(d.deductions) : D(it.deductions);
    const net = r2(D(it.baseSalary).plus(allowances).plus(it.commissions).minus(deductions).minus(it.advances).minus(it.absenceDeduction));
    const after = await tx.payrollItem.update({ where: { id }, data: { allowances, deductions, note: d.note, net } });
    const total = await tx.payrollItem.aggregate({ where: { runId: it.runId }, _sum: { net: true } });
    await tx.payrollRun.update({ where: { id: it.runId }, data: { totalNet: total._sum.net ?? ZERO } });
    await audit(tx, ctx, { action: "hr.payroll.item.update", entity: "PayrollItem", entityId: id, before: it, after });
    return after;
  });
}

export async function setPayrollStatus(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "hr.approve");
  const { action, cashAccountId } = z.object({ action: z.enum(["APPROVE", "PAID"]), cashAccountId: z.string().uuid().optional().nullable() }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const run = await tx.payrollRun.findFirst({ where: { id, tenantId }, include: { items: true } });
    if (!run) throw notFound("Payroll run not found");
    const now = new Date();
    if (action === "APPROVE") {
      if (run.status !== "DRAFT") throw conflict("Payroll is already approved");
      if (!run.items.length) throw conflict("Payroll has no employees — set salaries in employee profiles first");
      const { end } = periodRange(run.period);
      const users = run.items.map((i) => i.userId);
      // Lock what was paid: commissions & advances move into this run.
      await tx.commissionEntry.updateMany({ where: { tenantId, userId: { in: users }, status: "APPROVED", payrollRunId: null, earnedAt: { lt: end } }, data: { status: "PAID", payrollRunId: id } });
      await tx.salaryAdvance.updateMany({ where: { tenantId, userId: { in: users }, status: "OPEN", givenAt: { lt: end } }, data: { status: "SETTLED", payrollRunId: id } });
      const after = await tx.payrollRun.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.user.id, approvedAt: now } });
      await postPayrollApproved(tx, tenantId, id, ctx.user.id);
      await audit(tx, ctx, { action: "hr.payroll.approve", entity: "PayrollRun", entityId: id, after: { period: run.period, totalNet: run.totalNet } });
      return after;
    }
    if (run.status !== "APPROVED") throw conflict("Approve the payroll first");
    const after = await tx.payrollRun.update({ where: { id }, data: { status: "PAID", paidAt: now } });
    await postPayrollPaid(tx, tenantId, id, cashAccountId ?? null, ctx.user.id);
    await audit(tx, ctx, { action: "hr.payroll.paid", entity: "PayrollRun", entityId: id, after: { period: run.period } });
    return after;
  });
}

// ----------------------------------------------------------- performance ----

export async function performance(ctx: Ctx, q: { from: string; to: string }) {
  const tenantId = requireTenant(ctx, "hr.view");
  const from = new Date(q.from), to = new Date(q.to);
  if (isNaN(+from) || isNaN(+to) || to <= from) throw badRequest("Invalid date range");
  const months = Math.max(1, (+to - +from) / (30 * 86400000));
  return withTenant(tenantId, async (tx) => {
    const users = await tx.user.findMany({ where: { tenantId, status: "ACTIVE" }, select: { id: true, fullName: true, jobTitle: true, employee: { select: { monthlyTarget: true } } } });
    const [appts, performed, sold, comm, att, evals] = await Promise.all([
      tx.appointment.groupBy({ by: ["staffId"], where: { tenantId, status: "COMPLETED", startsAt: { gte: from, lt: to } }, _count: true }),
      tx.invoiceLine.groupBy({ by: ["performedById"], where: { tenantId, voided: false, invoice: { status: { in: ["PAID", "PARTIALLY_PAID", "ISSUED"] }, issuedAt: { gte: from, lt: to } } }, _sum: { lineTotal: true } }),
      tx.invoice.groupBy({ by: ["salesStaffId"], where: { tenantId, status: { in: ["PAID", "PARTIALLY_PAID", "ISSUED"] }, issuedAt: { gte: from, lt: to } }, _sum: { total: true }, _count: true }),
      tx.commissionEntry.groupBy({ by: ["userId"], where: { tenantId, status: { not: "VOID" }, earnedAt: { gte: from, lt: to } }, _sum: { amount: true } }),
      tx.attendanceRecord.groupBy({ by: ["userId", "status"], where: { tenantId, date: { gte: from, lt: to } }, _count: true }),
      tx.employeeEvaluation.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
    ]);
    const clients = await tx.$queryRaw<{ staffId: string; n: bigint }[]>`
      SELECT "staffId", COUNT(DISTINCT "clientId") AS n FROM "Appointment"
      WHERE "tenantId" = ${tenantId}::uuid AND status = 'COMPLETED' AND "startsAt" >= ${from} AND "startsAt" < ${to} AND "staffId" IS NOT NULL GROUP BY "staffId"`;
    return users.map((u) => {
      const revenue = D(performed.find((p) => p.performedById === u.id)?._sum.lineTotal ?? 0).plus(sold.find((s) => s.salesStaffId === u.id)?._sum.total ?? 0);
      const target = D(u.employee?.monthlyTarget ?? 0).times(months);
      const a = (st: string) => att.find((x) => x.userId === u.id && x.status === st)?._count ?? 0;
      const ev = evals.find((e) => e.userId === u.id);
      return {
        id: u.id, fullName: u.fullName, jobTitle: u.jobTitle,
        services: appts.find((x) => x.staffId === u.id)?._count ?? 0,
        clients: Number(clients.find((c) => c.staffId === u.id)?.n ?? 0),
        sales: sold.find((s) => s.salesStaffId === u.id)?._count ?? 0,
        revenue: r2(revenue), commissions: comm.find((c) => c.userId === u.id)?._sum.amount ?? ZERO,
        target: r2(target), achievement: target.isZero() ? null : Math.round(revenue.dividedBy(target).times(100).toNumber()),
        attendance: { present: a("PRESENT"), late: a("LATE"), absent: a("ABSENT"), leave: a("LEAVE") },
        lastEvaluation: ev ? { rating: ev.rating, period: ev.period, notes: ev.notes } : null,
      };
    }).sort((x, y) => y.revenue.minus(x.revenue).toNumber() || y.services - x.services);
  });
}

export async function addEvaluation(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "hr.update");
  const d = z.object({ userId: z.string().uuid(), period: z.string().regex(periodRe), rating: z.coerce.number().int().min(1).max(5), notes: optText(1000) }).parse(raw);
  if (d.userId === ctx.user.id) throw forbidden("You can't evaluate yourself");
  return withTenant(tenantId, async (tx) => {
    await staffOr400(tx, tenantId, d.userId);
    const e = await tx.employeeEvaluation.create({ data: { ...d, tenantId, evaluatorId: ctx.user.id } });
    await audit(tx, ctx, { action: "hr.evaluation.add", entity: "EmployeeEvaluation", entityId: e.id, after: e });
    return e;
  });
}

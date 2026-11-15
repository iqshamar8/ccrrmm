/**
 * Client messaging (WhatsApp Business Cloud API) — outbox, templates,
 * automations and delivery tracking.
 *
 *   queue (Message QUEUED, idempotent dedupeKey) ──► dispatchQueued()
 *     claim → SENDING (FOR UPDATE SKIP LOCKED) → still relevant? → provider
 *     → SENT (providerMessageId) ──webhook──► DELIVERED ──► READ   (or FAILED)
 *
 * Providers: SANDBOX (simulated, no network), WHATSAPP_CLOUD (Meta Graph API,
 * approved templates for business-initiated messages), DISABLED.
 * runAutomations() creates the scheduled reminders; it is idempotent and is
 * called by the cron endpoint / worker and by "Run now".
 */
import { z } from "zod";
import { Prisma, type MessageCategory, type MessagingProvider } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { decryptSecret, encryptSecret, randomToken, verifyHubSignature } from "../crypto";
import { type Tx, withPlatform, withTenant } from "../db";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { ACTIVE_APPT, optText, recordBranchScope } from "./common";
import { notifyPermission, notifyUsers } from "./notifications";

export const CATEGORIES = ["APPOINTMENT_CONFIRM", "APPOINTMENT_REMINDER", "PAYMENT_REMINDER", "SUBSCRIPTION_EXPIRY", "SESSION_REMINDER", "FOLLOW_UP", "BIRTHDAY", "PROMOTION", "REACTIVATION", "CUSTOM"] as const;
/** Marketing categories respect the client's opt-out; the rest are service messages. */
export const MARKETING_CATEGORIES: MessageCategory[] = ["PROMOTION", "REACTIVATION", "BIRTHDAY"];
/** Sent even during quiet hours (as are messages a staff member sends by hand; campaigns wait). */
const URGENT: MessageCategory[] = ["APPOINTMENT_CONFIRM", "CUSTOM"];

export const PLACEHOLDERS = ["client_name", "clinic_name", "branch_name", "date", "time", "service", "staff", "amount", "invoice_code", "due_date", "plan_name", "end_date", "program_name", "remaining", "coupon_code", "offer", "message"] as const;

export const DEFAULT_RULES = {
  APPOINTMENT_CONFIRM: { enabled: true },
  APPOINTMENT_REMINDER: { enabled: true, hoursBefore: 24 },
  PAYMENT_REMINDER: { enabled: true, daysAfterDue: 3, repeatDays: 7 },
  SUBSCRIPTION_EXPIRY: { enabled: true, daysBefore: 7 },
  SESSION_REMINDER: { enabled: true, daysIdle: 21 },
  FOLLOW_UP: { enabled: true, hoursAfter: 24 },
  BIRTHDAY: { enabled: true, hour: 10 },
};
export type Rules = typeof DEFAULT_RULES;

const DEFAULT_TEMPLATES: Record<MessageCategory, { name: string; body: string }> = {
  APPOINTMENT_CONFIRM: { name: "تأكيد الحجز", body: "مرحباً {{client_name}}، تم تأكيد موعدك في {{clinic_name}} – {{branch_name}} يوم {{date}} الساعة {{time}} ({{service}}). للتعديل أو الإلغاء يرجى التواصل معنا." },
  APPOINTMENT_REMINDER: { name: "تذكير بالموعد", body: "تذكير من {{clinic_name}}: لديك موعد يوم {{date}} الساعة {{time}} ({{service}}) في {{branch_name}}. نتطلع لرؤيتك!" },
  PAYMENT_REMINDER: { name: "تذكير بالدفع", body: "عزيزنا {{client_name}}، نذكّرك بوجود مبلغ مستحق {{amount}} على الفاتورة {{invoice_code}} منذ {{due_date}}. شكراً لتعاملك مع {{clinic_name}}." },
  SUBSCRIPTION_EXPIRY: { name: "انتهاء الاشتراك", body: "مرحباً {{client_name}}، اشتراكك «{{plan_name}}» في {{clinic_name}} ينتهي في {{end_date}}. جدّده الآن لتستمر بالاستفادة من المزايا." },
  SESSION_REMINDER: { name: "تذكير بالجلسات", body: "مرحباً {{client_name}}، تبقّت لك {{remaining}} جلسة في برنامج «{{program_name}}». احجز جلستك القادمة للحفاظ على أفضل النتائج." },
  FOLLOW_UP: { name: "متابعة بعد الخدمة", body: "شكراً لزيارتك {{clinic_name}} يا {{client_name}}. كيف تشعر بعد {{service}}؟ يسعدنا سماع رأيك وأي استفسار لديك." },
  BIRTHDAY: { name: "تهنئة عيد الميلاد", body: "كل عام وأنت بخير يا {{client_name}}! 🎉 فريق {{clinic_name}} يتمنى لك عاماً مليئاً بالصحة والجمال." },
  PROMOTION: { name: "عرض خاص", body: "مرحباً {{client_name}}، لدينا عرض خاص لك في {{clinic_name}}: {{offer}} استخدم الكود {{coupon_code}} عند الحجز." },
  REACTIVATION: { name: "اشتقنا لك", body: "اشتقنا لك يا {{client_name}}! مرّ وقت على زيارتك الأخيرة لـ {{clinic_name}}. احجز موعدك الآن ويسعدنا استقبالك." },
  CUSTOM: { name: "رسالة حرة", body: "{{message}}" },
};

// ------------------------------------------------------------ helpers ----

export function render(body: string, vars: Record<string, string | number | null | undefined>) {
  const params: string[] = [];
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    const s = v === null || v === undefined || v === "" ? "-" : String(v);
    params.push(s);
    return s;
  });
  return { text: text.replace(/[ \t]+\n/g, "\n").trim(), params };
}

/** Digits in international format for WhatsApp ("0770…" → "964770…"). */
export function toE164(phone: string, cc: string) {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith(cc)) return d;
  if (d.startsWith("0")) return cc + d.slice(1);
  return d.length <= 10 ? cc + d : d;
}

function localParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => Number(f.find((p) => p.type === t)?.value);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour") };
}
const fmt = (d: Date | null | undefined, tz: string, lang: string, kind: "date" | "time") =>
  !d ? "-" : new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ar-IQ", { timeZone: tz, ...(kind === "date" ? { weekday: "long", day: "numeric", month: "long" } : { hour: "numeric", minute: "2-digit" }) }).format(d);
const money = (v: Prisma.Decimal | number, cur: string, lang: string) => new Intl.NumberFormat(lang === "en" ? "en" : "ar-IQ", { style: "currency", currency: cur, maximumFractionDigits: cur === "IQD" ? 0 : 2 }).format(Number(v));

export function inQuietHours(now: Date, tz: string, start: number, end: number) {
  const h = localParts(now, tz).h;
  return start === end ? false : start < end ? h >= start && h < end : h >= start || h < end;
}

async function settingsTx(tx: Tx, tenantId: string) {
  return (await tx.messagingSettings.findUnique({ where: { tenantId } })) ?? tx.messagingSettings.create({ data: { tenantId, verifyToken: randomToken(18) } });
}
export function rulesOf(raw: unknown): Rules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown>>;
  const out = structuredClone(DEFAULT_RULES) as Record<string, Record<string, unknown>>;
  for (const k of Object.keys(out)) if (r[k]) Object.assign(out[k], r[k]);
  return out as unknown as Rules;
}

/** Default templates are created lazily, one per category. */
export async function ensureTemplates(tx: Tx, tenantId: string) {
  const have = await tx.messageTemplate.findMany({ where: { tenantId, isDefault: true }, select: { category: true } });
  const missing = CATEGORIES.filter((c) => !have.some((h) => h.category === c));
  if (missing.length) await tx.messageTemplate.createMany({ data: missing.map((c) => ({ tenantId, category: c, name: DEFAULT_TEMPLATES[c].name, body: DEFAULT_TEMPLATES[c].body, isDefault: true })) });
}
async function templateFor(tx: Tx, tenantId: string, category: MessageCategory, templateId?: string | null) {
  if (templateId) {
    const t = await tx.messageTemplate.findFirst({ where: { id: templateId, tenantId } });
    if (t) return t;
  }
  await ensureTemplates(tx, tenantId);
  return (await tx.messageTemplate.findFirst({ where: { tenantId, category, isActive: true }, orderBy: [{ isDefault: "asc" }, { updatedAt: "desc" }] }))
    ?? tx.messageTemplate.findFirstOrThrow({ where: { tenantId, category, isDefault: true } });
}

type Base = { clinic: string; tz: string; cur: string; cc: string };
async function baseVars(tx: Tx, tenantId: string): Promise<Base> {
  const [t, s] = await Promise.all([tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { name: true, timezone: true, baseCurrency: true } }), settingsTx(tx, tenantId)]);
  return { clinic: t.name, tz: t.timezone, cur: t.baseCurrency, cc: s.defaultCountryCode };
}

export type QueueInput = {
  category: MessageCategory; client: { id: string; fullName: string; phone: string; marketingOptOut?: boolean };
  vars?: Record<string, string | number | null | undefined>; templateId?: string | null; body?: string | null;
  dedupeKey?: string | null; relatedType?: string | null; relatedId?: string | null; scheduledFor?: Date; campaignId?: string | null; createdById?: string | null;
};

/** Queues one message (no-op if the dedupe key exists or a marketing message targets an opted-out client). */
export async function queueMessage(tx: Tx, tenantId: string, q: QueueInput, base?: Base) {
  if (MARKETING_CATEGORIES.includes(q.category) && q.client.marketingOptOut) return null;
  if (q.dedupeKey && (await tx.message.findFirst({ where: { tenantId, dedupeKey: q.dedupeKey }, select: { id: true } }))) return null;
  const b = base ?? (await baseVars(tx, tenantId));
  const vars = { client_name: q.client.fullName, clinic_name: b.clinic, ...q.vars };
  // Free text goes through the CUSTOM template ("{{message}}"), so on WhatsApp it is the single body parameter.
  const t = q.body ? await templateFor(tx, tenantId, "CUSTOM") : await templateFor(tx, tenantId, q.category, q.templateId);
  let { text, params } = render(q.body ?? t.body, vars);
  if (q.body) params = render(t.body, { ...vars, message: text }).params;
  return tx.message.create({
    data: {
      tenantId, category: q.category, toPhone: toE164(q.client.phone, b.cc), clientId: q.client.id, templateId: t.id, campaignId: q.campaignId ?? null,
      body: text, params, dedupeKey: q.dedupeKey ?? null, relatedType: q.relatedType ?? null, relatedId: q.relatedId ?? null,
      scheduledFor: q.scheduledFor ?? new Date(), createdById: q.createdById ?? null,
    },
  });
}

// --------------------------------------------------------- event hooks ----

async function apptVars(tx: Tx, tenantId: string, id: string, b: Base) {
  const a = await tx.appointment.findFirst({ where: { id, tenantId }, include: { client: true, service: true, staff: { select: { fullName: true } }, branch: { select: { name: true } } } });
  if (!a) return null;
  return { a, vars: { date: fmt(a.startsAt, b.tz, "ar", "date"), time: fmt(a.startsAt, b.tz, "ar", "time"), service: a.service?.name ?? "-", staff: a.staff?.fullName ?? "-", branch_name: a.branch.name } };
}

/** On booking: confirmation to the client (if enabled) + notification to the assigned staff member. */
export async function onAppointmentCreated(tx: Tx, ctx: Ctx, tenantId: string, appointmentId: string) {
  const b = await baseVars(tx, tenantId);
  const x = await apptVars(tx, tenantId, appointmentId, b);
  if (!x) return;
  if (x.a.staffId && x.a.staffId !== ctx.user.id) {
    await notifyUsers(tx, tenantId, [x.a.staffId], { type: "appointment.assigned", title: `موعد جديد: ${x.a.client.fullName}`, body: `${x.vars.date} ${x.vars.time} — ${x.vars.service}`, link: `/appointments?date=${x.a.startsAt.toISOString().slice(0, 10)}` });
  }
  if (!ctx.features.has("notifications") || x.a.startsAt < new Date()) return;
  const rules = rulesOf((await settingsTx(tx, tenantId)).rules);
  if (!rules.APPOINTMENT_CONFIRM.enabled) return;
  await queueMessage(tx, tenantId, { category: "APPOINTMENT_CONFIRM", client: x.a.client, vars: x.vars, dedupeKey: `appt-confirm:${x.a.id}`, relatedType: "appointment", relatedId: x.a.id, createdById: ctx.user.id }, b);
}

// --------------------------------------------------------- automations ----

/** Creates due automatic messages + staff notifications. Idempotent (dedupe keys). */
export async function runAutomations(tenantId: string, now = new Date()) {
  return withTenant(tenantId, async (tx) => {
    const sub = await tx.tenantSubscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { plan: true } });
    const features = new Set(sub && !["CANCELLED", "EXPIRED", "PAUSED"].includes(sub.status) ? sub.plan.features : []);
    const s = await settingsTx(tx, tenantId);
    const rules = rulesOf(s.rules);
    const b = await baseVars(tx, tenantId);
    const counts: Record<string, number> = {};
    const add = (k: string, m: unknown) => { if (m) counts[k] = (counts[k] ?? 0) + 1; };
    const HOUR = 3600000, DAY = 86400000;

    if (features.has("notifications") && s.provider !== "DISABLED") {
      if (rules.APPOINTMENT_REMINDER.enabled) {
        const lead = rules.APPOINTMENT_REMINDER.hoursBefore * HOUR;
        const appts = await tx.appointment.findMany({
          where: { tenantId, status: { in: [...ACTIVE_APPT] }, startsAt: { gt: now, lte: new Date(+now + lead + 6 * HOUR) } },
          include: { client: true, service: true, staff: { select: { fullName: true } }, branch: { select: { name: true } } }, take: 1000,
        });
        for (const a of appts) {
          add("APPOINTMENT_REMINDER", await queueMessage(tx, tenantId, {
            category: "APPOINTMENT_REMINDER", client: a.client, dedupeKey: `appt-remind:${a.id}`, relatedType: "appointment", relatedId: a.id,
            scheduledFor: new Date(Math.max(+now, +a.startsAt - lead)),
            vars: { date: fmt(a.startsAt, b.tz, "ar", "date"), time: fmt(a.startsAt, b.tz, "ar", "time"), service: a.service?.name, staff: a.staff?.fullName, branch_name: a.branch.name },
          }, b));
        }
      }
      if (rules.FOLLOW_UP.enabled) {
        const after = rules.FOLLOW_UP.hoursAfter * HOUR;
        const done = await tx.appointment.findMany({
          where: { tenantId, status: "COMPLETED", completedAt: { gte: new Date(+now - after - 2 * DAY), lte: new Date(+now - after) }, review: null, surgery: null },
          include: { client: true, service: true, branch: { select: { name: true } } }, take: 1000,
        });
        for (const a of done) add("FOLLOW_UP", await queueMessage(tx, tenantId, { category: "FOLLOW_UP", client: a.client, dedupeKey: `follow:${a.id}`, relatedType: "appointment", relatedId: a.id, vars: { service: a.service?.name, branch_name: a.branch.name } }, b));
      }
      if (rules.PAYMENT_REMINDER.enabled && features.has("invoices")) {
        const invs = await tx.invoice.findMany({
          where: { tenantId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, clientId: { not: null } },
          include: { client: true, installments: { orderBy: { seq: "asc" } } }, take: 2000,
        });
        for (const inv of invs) {
          if (!inv.client) continue;
          let left = Number(inv.paidTotal), due = inv.dueDate;
          for (const x of inv.installments) { const p = Math.min(left, Number(x.amount)); left -= p; if (Number(x.amount) > p) { due = x.dueDate; break; } }
          if (!due) continue;
          const overdueDays = Math.floor((+now - +due) / DAY);
          if (overdueDays < rules.PAYMENT_REMINDER.daysAfterDue) continue;
          const round = Math.floor((overdueDays - rules.PAYMENT_REMINDER.daysAfterDue) / Math.max(1, rules.PAYMENT_REMINDER.repeatDays));
          add("PAYMENT_REMINDER", await queueMessage(tx, tenantId, {
            category: "PAYMENT_REMINDER", client: inv.client, dedupeKey: `pay-remind:${inv.id}:${round}`, relatedType: "invoice", relatedId: inv.id,
            vars: { amount: money(Number(inv.total) - Number(inv.paidTotal), b.cur, "ar"), invoice_code: inv.code, due_date: fmt(due, b.tz, "ar", "date") },
          }, b));
        }
      }
      if (rules.SUBSCRIPTION_EXPIRY.enabled && features.has("subscriptions")) {
        const subs = await tx.clientSubscription.findMany({
          where: { tenantId, status: "ACTIVE", endDate: { gte: new Date(+now - DAY), lte: new Date(+now + rules.SUBSCRIPTION_EXPIRY.daysBefore * DAY) } },
          include: { client: true }, take: 1000,
        });
        for (const x of subs) add("SUBSCRIPTION_EXPIRY", await queueMessage(tx, tenantId, { category: "SUBSCRIPTION_EXPIRY", client: x.client, dedupeKey: `sub-exp:${x.id}:${x.endDate.toISOString().slice(0, 10)}`, relatedType: "subscription", relatedId: x.id, vars: { plan_name: x.name, end_date: fmt(x.endDate, "UTC", "ar", "date") } }, b));
      }
      if (rules.SESSION_REMINDER.enabled && features.has("programs")) {
        const idle = new Date(+now - rules.SESSION_REMINDER.daysIdle * DAY);
        const progs = await tx.clientProgram.findMany({
          where: { tenantId, status: "ACTIVE", startDate: { lte: idle } },
          include: { client: true, items: { include: { _count: { select: { sessions: true } }, appointments: { where: { status: { in: [...ACTIVE_APPT] } }, select: { id: true } } } }, sessions: { orderBy: { performedAt: "desc" }, take: 1 } },
          take: 1000,
        });
        for (const p of progs) {
          const remaining = p.items.reduce((a, i) => a + Math.max(0, i.sessionsTotal - i._count.sessions), 0);
          const booked = p.items.some((i) => i.appointments.length);
          const last = p.sessions[0]?.performedAt ?? p.startDate;
          if (!remaining || booked || last > idle) continue;
          add("SESSION_REMINDER", await queueMessage(tx, tenantId, { category: "SESSION_REMINDER", client: p.client, dedupeKey: `session:${p.id}:${last.toISOString().slice(0, 10)}`, relatedType: "program", relatedId: p.id, vars: { program_name: p.name, remaining } }, b));
        }
      }
      if (rules.BIRTHDAY.enabled) {
        const lp = localParts(now, b.tz);
        if (lp.h >= rules.BIRTHDAY.hour) {
          const bdays = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Client" WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL AND status = 'ACTIVE' AND "marketingOptOut" = false
              AND "birthDate" IS NOT NULL AND EXTRACT(MONTH FROM "birthDate") = ${lp.m} AND EXTRACT(DAY FROM "birthDate") = ${lp.d} LIMIT 2000`;
          const cl = await tx.client.findMany({ where: { tenantId, id: { in: bdays.map((x) => x.id) } } });
          for (const c of cl) add("BIRTHDAY", await queueMessage(tx, tenantId, { category: "BIRTHDAY", client: c, dedupeKey: `bday:${c.id}:${lp.y}` }, b));
        }
      }
    }

    // ---- staff / management notifications (core) ----
    const day = new Date(now).toISOString().slice(0, 10);
    if (features.has("inventory")) {
      const low = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (SELECT p.id FROM "Product" p LEFT JOIN "StockLot" l ON l."itemId" = p.id
          WHERE p."tenantId" = ${tenantId}::uuid AND p."trackStock" AND p."isActive" GROUP BY p.id HAVING COALESCE(SUM(l.quantity), 0) < MAX(p."minStock")) x`;
      const nLow = Number(low[0]?.n ?? 0);
      if (nLow) add("staff", await notifyPermission(tx, tenantId, "inventory.approve", { type: "stock.low", title: `${nLow} صنف تحت الحد الأدنى`, body: "راجع الأرصدة واطلب الكميات الناقصة.", link: "/inventory?low=1", dedupeKey: `low-stock:${day}` }));
      const exp = await tx.stockLot.count({ where: { tenantId, quantity: { gt: 0 }, expiryDate: { lte: new Date(+now + 7 * DAY) } } });
      if (exp) add("staff", await notifyPermission(tx, tenantId, "inventory.approve", { type: "stock.expiry", title: `${exp} تشغيلة منتهية أو تنتهي خلال 7 أيام`, link: "/inventory", dedupeKey: `expiry:${day}` }));
    }
    if (features.has("reviews")) {
      const overdue = await tx.medicalReview.findMany({ where: { tenantId, status: "SCHEDULED", scheduledAt: { lt: new Date(+now - 2 * HOUR) }, doctorId: { not: null } }, include: { client: { select: { fullName: true } } }, take: 300 });
      for (const r of overdue) add("staff", await notifyUsers(tx, tenantId, [r.doctorId], { type: "review.overdue", title: `مراجعة متأخرة: ${r.client.fullName}`, body: r.reason, link: `/reviews`, dedupeKey: `review-overdue:${r.id}` }));
    }
    const failed = await tx.message.count({ where: { tenantId, status: "FAILED", failedAt: { gte: new Date(+now - DAY) } } });
    if (failed) add("staff", await notifyPermission(tx, tenantId, "notifications.update", { type: "messages.failed", title: `${failed} رسالة فشل إرسالها خلال آخر 24 ساعة`, link: "/notifications?status=FAILED", dedupeKey: `msg-failed:${day}` }));
    return counts;
  });
}

// -------------------------------------------------------------- sending ----

type SendResult = { ok: true; id: string; delivered?: boolean } | { ok: false; error: string; retry: boolean };
const GRAPH = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0"}`;

async function sendCloud(cfg: { phoneNumberId: string; token: string }, m: { toPhone: string; body: string; params: string[]; waTemplateName: string | null; waLanguage: string | null; language: string }): Promise<SendResult> {
  const payload = m.waTemplateName
    ? { messaging_product: "whatsapp", to: m.toPhone, type: "template", template: { name: m.waTemplateName, language: { code: m.waLanguage ?? m.language }, components: m.params.length ? [{ type: "body", parameters: m.params.map((t) => ({ type: "text", text: t.slice(0, 1000) })) }] : [] } }
    : { messaging_product: "whatsapp", to: m.toPhone, type: "text", text: { body: m.body.slice(0, 4096), preview_url: false } };
  try {
    const r = await fetch(`${GRAPH()}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
    });
    const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (r.ok && j.messages?.[0]?.id) return { ok: true, id: j.messages[0].id };
    return { ok: false, error: `${j.error?.code ?? r.status}: ${j.error?.message ?? "WhatsApp API error"}`.slice(0, 500), retry: r.status >= 500 || r.status === 429 };
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500), retry: true };
  }
}

/** Is the message still relevant (appointment not cancelled, invoice still unpaid…)? */
async function stillRelevant(tx: Tx, tenantId: string, m: { relatedType: string | null; relatedId: string | null; category: MessageCategory; client: { marketingOptOut: boolean; deletedAt: Date | null } | null }) {
  if (m.client?.deletedAt) return false;
  if (MARKETING_CATEGORIES.includes(m.category) && m.client?.marketingOptOut) return false;
  if (!m.relatedId) return true;
  switch (m.relatedType) {
    case "appointment": {
      const a = await tx.appointment.findFirst({ where: { id: m.relatedId, tenantId }, select: { status: true, startsAt: true } });
      if (!a) return false;
      return m.category === "FOLLOW_UP" ? a.status === "COMPLETED" : (ACTIVE_APPT as readonly string[]).includes(a.status) && a.startsAt > new Date();
    }
    case "invoice": return !!(await tx.invoice.findFirst({ where: { id: m.relatedId, tenantId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { id: true } }));
    case "subscription": return !!(await tx.clientSubscription.findFirst({ where: { id: m.relatedId, tenantId, status: "ACTIVE" }, select: { id: true } }));
    case "program": return !!(await tx.clientProgram.findFirst({ where: { id: m.relatedId, tenantId, status: "ACTIVE" }, select: { id: true } }));
    default: return true;
  }
}

/** Sends due queued messages for one tenant. Network calls happen outside DB transactions. */
export async function dispatchQueued(tenantId: string, now = new Date(), limit = 50) {
  const cfg = await withTenant(tenantId, async (tx) => {
    const s = await settingsTx(tx, tenantId);
    const t = await tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { timezone: true } });
    // Requeue messages stuck in SENDING (crashed worker) for > 10 minutes.
    await tx.message.updateMany({ where: { tenantId, status: "SENDING", scheduledFor: { lt: new Date(+now - 600000) } }, data: { status: "QUEUED" } });
    if (s.provider === "DISABLED") {
      const r = await tx.message.updateMany({ where: { tenantId, status: "QUEUED", scheduledFor: { lte: now } }, data: { status: "CANCELLED", error: "Messaging is turned off" } });
      return { provider: s.provider, cancelled: r.count, claimed: [] as string[] };
    }
    const quiet = inQuietHours(now, t.timezone, s.quietStartHour, s.quietEndHour);
    const claimed = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Message" SET status = 'SENDING', attempts = attempts + 1
      WHERE id IN (SELECT id FROM "Message" WHERE "tenantId" = ${tenantId}::uuid AND status = 'QUEUED' AND "scheduledFor" <= ${now}
        ${quiet ? Prisma.sql`AND (category IN ('APPOINTMENT_CONFIRM', 'CUSTOM') OR ("createdById" IS NOT NULL AND "campaignId" IS NULL))` : Prisma.empty}
        ORDER BY "scheduledFor" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    return { provider: s.provider as MessagingProvider, phoneNumberId: s.phoneNumberId, token: decryptSecret(s.accessTokenEnc), claimed: claimed.map((c) => c.id), cancelled: 0 };
  });
  const out = { sent: 0, failed: 0, cancelled: cfg.cancelled, retried: 0 };
  if (!cfg.claimed.length) return out;
  const msgs = await withTenant(tenantId, (tx) => tx.message.findMany({ where: { tenantId, id: { in: cfg.claimed } }, include: { template: true, client: { select: { marketingOptOut: true, deletedAt: true } } } }));
  for (const m of msgs) {
    const relevant = await withTenant(tenantId, (tx) => stillRelevant(tx, tenantId, m));
    if (!relevant) {
      await withTenant(tenantId, (tx) => tx.message.update({ where: { id: m.id }, data: { status: "CANCELLED", error: "No longer relevant" } }));
      out.cancelled++; continue;
    }
    let res: SendResult;
    if (cfg.provider === "SANDBOX") res = { ok: true, id: `sandbox.${m.id}`, delivered: true };
    else if (!cfg.phoneNumberId || !("token" in cfg) || !cfg.token) res = { ok: false, error: "WhatsApp is not connected (phone number id / access token missing)", retry: false };
    else res = await sendCloud({ phoneNumberId: cfg.phoneNumberId, token: cfg.token }, { toPhone: m.toPhone, body: m.body, params: m.params, waTemplateName: m.template?.waTemplateName ?? null, waLanguage: m.template?.waLanguage ?? null, language: m.template?.language ?? "ar" });
    const at = new Date();
    await withTenant(tenantId, (tx) => {
      if (res.ok) return tx.message.update({ where: { id: m.id }, data: { status: res.delivered ? "DELIVERED" : "SENT", providerMessageId: res.id, sentAt: at, deliveredAt: res.delivered ? at : null, error: null } });
      if (res.retry && m.attempts < 3) return tx.message.update({ where: { id: m.id }, data: { status: "QUEUED", error: res.error, scheduledFor: new Date(+at + m.attempts * 5 * 60000) } });
      return tx.message.update({ where: { id: m.id }, data: { status: "FAILED", error: res.error, failedAt: at } });
    });
    if (res.ok) out.sent++; else if (res.retry && m.attempts < 3) out.retried++; else out.failed++;
  }
  // Campaigns whose messages are all processed become SENT.
  await withTenant(tenantId, async (tx) => {
    const sending = await tx.campaign.findMany({ where: { tenantId, status: "SENDING" }, select: { id: true } });
    for (const c of sending) if (!(await tx.message.count({ where: { tenantId, campaignId: c.id, status: { in: ["QUEUED", "SENDING"] } } }))) await tx.campaign.update({ where: { id: c.id }, data: { status: "SENT" } });
  });
  return out;
}

/** Cron / worker entry: automations + dispatch for every active tenant. */
export async function runMessagingCycle(now = new Date()) {
  const tenants = await withPlatform((tx) => tx.tenant.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] } }, select: { id: true, slug: true } }));
  const report: Record<string, unknown> = {};
  for (const t of tenants) {
    try {
      const created = await runAutomations(t.id, now);
      const sent = await dispatchQueued(t.id, now, 200);
      report[t.slug] = { created, ...sent };
    } catch (e) {
      report[t.slug] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return report;
}

// ------------------------------------------------------------- webhook ----

const RANK: Record<string, number> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5, CANCELLED: 5 };

export async function verifyWebhook(tenantId: string, mode: string | null, token: string | null, challenge: string | null) {
  const s = await withPlatform((tx) => tx.messagingSettings.findUnique({ where: { tenantId } }));
  return mode === "subscribe" && !!s?.verifyToken && token === s.verifyToken ? challenge : null;
}

type Hook = { entry?: { changes?: { value?: {
  statuses?: { id: string; status: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string }[] }[];
  messages?: { from: string; id: string; type: string; text?: { body?: string }; button?: { text?: string } }[];
} }[] }[] };

/** Meta status/inbound webhook. Signature is verified with the tenant's app secret. */
export async function handleWebhook(tenantId: string, rawBody: string, signature: string | null) {
  const s = await withPlatform((tx) => tx.messagingSettings.findUnique({ where: { tenantId } }));
  const secret = decryptSecret(s?.appSecretEnc);
  if (!s || !secret || !verifyHubSignature(rawBody, signature, secret)) throw new AppError(401, "BAD_SIGNATURE", "Invalid signature");
  let body: Hook;
  try { body = JSON.parse(rawBody) as Hook; } catch { throw badRequest("Invalid JSON"); }
  let updated = 0, inbound = 0;
  await withTenant(tenantId, async (tx) => {
    for (const ch of body.entry?.flatMap((e) => e.changes ?? []) ?? []) {
      for (const st of ch.value?.statuses ?? []) {
        const m = await tx.message.findFirst({ where: { tenantId, providerMessageId: st.id } });
        if (!m) continue;
        const next = ({ sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as const)[st.status as "sent"];
        if (!next || RANK[next] <= RANK[m.status]) continue;
        const at = st.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date();
        await tx.message.update({ where: { id: m.id }, data: {
          status: next, ...(next === "SENT" ? { sentAt: at } : next === "DELIVERED" ? { deliveredAt: at } : next === "READ" ? { readAt: at, deliveredAt: m.deliveredAt ?? at } : { failedAt: at, error: (st.errors?.map((x) => `${x.code}: ${x.message ?? x.title}`).join("; ") ?? "failed").slice(0, 500) }),
        } });
        updated++;
      }
      for (const im of ch.value?.messages ?? []) {
        const text = im.text?.body ?? im.button?.text ?? `[${im.type}]`;
        const tail = im.from.slice(-9);
        const client = await tx.client.findFirst({ where: { tenantId, deletedAt: null, phoneNormalized: { endsWith: tail } } });
        if (!client) continue;
        inbound++;
        await tx.clientInteraction.create({ data: { tenantId, clientId: client.id, type: "WHATSAPP", content: `↩ ${text}`.slice(0, 2000) } });
        if (/^\s*(stop|الغاء|إلغاء|ايقاف|إيقاف)\s*$/i.test(text)) await tx.client.update({ where: { id: client.id }, data: { marketingOptOut: true } });
        await notifyUsers(tx, tenantId, [client.ownerId], { type: "whatsapp.inbound", title: `رسالة واتساب من ${client.fullName}`, body: text.slice(0, 300), link: `/clients/${client.id}` });
      }
    }
  });
  return { updated, inbound };
}

// ----------------------------------------------------------------- API ----

const maskTail = (v: string | null) => (v ? `••••${v.slice(-4)}` : null);

export async function getMessagingSettings(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "notifications.view");
  return withTenant(tenantId, async (tx) => {
    const s = await settingsTx(tx, tenantId);
    const token = decryptSecret(s.accessTokenEnc);
    return {
      provider: s.provider, phoneNumberId: s.phoneNumberId, wabaId: s.wabaId, defaultCountryCode: s.defaultCountryCode,
      quietStartHour: s.quietStartHour, quietEndHour: s.quietEndHour, rules: rulesOf(s.rules),
      accessToken: maskTail(token), hasAppSecret: !!s.appSecretEnc, verifyToken: ctx.permissions.has("notifications.update") ? s.verifyToken : null,
      webhookPath: `/api/webhooks/whatsapp/${tenantId}`,
    };
  });
}

const ruleNum = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
export const settingsSchema = z.object({
  provider: z.enum(["DISABLED", "SANDBOX", "WHATSAPP_CLOUD"]),
  phoneNumberId: z.string().trim().max(40).regex(/^\d*$/, "Digits only").optional().nullable().transform((v) => v || null),
  wabaId: z.string().trim().max(40).regex(/^\d*$/, "Digits only").optional().nullable().transform((v) => v || null),
  /** empty/omitted = keep the stored secret */
  accessToken: z.string().trim().max(1000).optional().nullable(),
  appSecret: z.string().trim().max(200).optional().nullable(),
  defaultCountryCode: z.string().trim().regex(/^\d{1,4}$/),
  quietStartHour: ruleNum(0, 23), quietEndHour: ruleNum(0, 23),
  rules: z.object({
    APPOINTMENT_CONFIRM: z.object({ enabled: z.boolean() }),
    APPOINTMENT_REMINDER: z.object({ enabled: z.boolean(), hoursBefore: ruleNum(1, 168) }),
    PAYMENT_REMINDER: z.object({ enabled: z.boolean(), daysAfterDue: ruleNum(0, 365), repeatDays: ruleNum(1, 90) }),
    SUBSCRIPTION_EXPIRY: z.object({ enabled: z.boolean(), daysBefore: ruleNum(1, 90) }),
    SESSION_REMINDER: z.object({ enabled: z.boolean(), daysIdle: ruleNum(3, 365) }),
    FOLLOW_UP: z.object({ enabled: z.boolean(), hoursAfter: ruleNum(1, 336) }),
    BIRTHDAY: z.object({ enabled: z.boolean(), hour: ruleNum(0, 23) }),
  }),
  regenerateVerifyToken: z.boolean().optional(),
});

export async function saveMessagingSettings(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "notifications.update");
  const d = settingsSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await settingsTx(tx, tenantId);
    const data: Prisma.MessagingSettingsUpdateInput = {
      provider: d.provider, phoneNumberId: d.phoneNumberId, wabaId: d.wabaId, defaultCountryCode: d.defaultCountryCode,
      quietStartHour: d.quietStartHour, quietEndHour: d.quietEndHour, rules: d.rules,
      ...(d.accessToken ? { accessTokenEnc: encryptSecret(d.accessToken) } : {}),
      ...(d.appSecret ? { appSecretEnc: encryptSecret(d.appSecret) } : {}),
      ...(d.regenerateVerifyToken || !before.verifyToken ? { verifyToken: randomToken(18) } : {}),
    };
    if (d.provider === "WHATSAPP_CLOUD" && (!d.phoneNumberId || (!d.accessToken && !before.accessTokenEnc))) throw badRequest("Phone number ID and access token are required for WhatsApp Cloud API");
    const after = await tx.messagingSettings.update({ where: { tenantId }, data });
    await audit(tx, ctx, { action: "messaging.settings", entity: "MessagingSettings", entityId: after.id,
      before: { provider: before.provider, phoneNumberId: before.phoneNumberId, rules: before.rules }, after: { provider: after.provider, phoneNumberId: after.phoneNumberId, rules: after.rules, tokenChanged: !!d.accessToken, secretChanged: !!d.appSecret } });
    return getMessagingSettings(ctx);
  });
}

export async function listTemplates(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "notifications.view");
  return withTenant(tenantId, async (tx) => {
    await ensureTemplates(tx, tenantId);
    return tx.messageTemplate.findMany({ where: { tenantId }, orderBy: [{ category: "asc" }, { isDefault: "desc" }, { name: "asc" }] });
  });
}

export const templateSchema = z.object({
  category: z.enum(CATEGORIES), name: z.string().trim().min(2).max(120), language: z.enum(["ar", "en", "ku"]).default("ar"),
  body: z.string().trim().min(2).max(1024).refine((b) => [...b.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].every((m) => (PLACEHOLDERS as readonly string[]).includes(m[1])), "Unknown placeholder"),
  waTemplateName: z.string().trim().max(512).regex(/^[a-z0-9_]*$/, "lowercase letters, digits and _ only").optional().nullable().transform((v) => v || null),
  waLanguage: z.string().trim().max(10).optional().nullable().transform((v) => v || null),
  isActive: z.boolean().default(true),
});

export async function saveTemplate(ctx: Ctx, id: string | null, raw: unknown) {
  const tenantId = requireTenant(ctx, id ? "notifications.update" : "notifications.create");
  const d = templateSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = id ? await tx.messageTemplate.findFirst({ where: { id, tenantId } }) : null;
    if (id && !before) throw notFound("Template not found");
    if (before?.isDefault && before.category !== d.category) throw conflict("A default template keeps its category");
    const t = id ? await tx.messageTemplate.update({ where: { id }, data: d }) : await tx.messageTemplate.create({ data: { ...d, tenantId } });
    await audit(tx, ctx, { action: id ? "template.update" : "template.create", entity: "MessageTemplate", entityId: t.id, before, after: t });
    return t;
  });
}

export async function previewTemplate(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "notifications.view");
  const { body } = z.object({ body: z.string().max(2000) }).parse(raw);
  return withTenant(tenantId, async (tx) => {
    const b = await baseVars(tx, tenantId);
    const now = new Date(Date.now() + 86400000);
    return render(body, {
      client_name: "سارة أحمد", clinic_name: b.clinic, branch_name: "الفرع الرئيسي", date: fmt(now, b.tz, "ar", "date"), time: fmt(now, b.tz, "ar", "time"), service: "ليزر الوجه", staff: "د. ليلى",
      amount: money(150000, b.cur, "ar"), invoice_code: "INV-000123", due_date: fmt(new Date(), b.tz, "ar", "date"), plan_name: "اشتراك ذهبي", end_date: fmt(now, b.tz, "ar", "date"),
      program_name: "برنامج الليزر 6 جلسات", remaining: 3, coupon_code: "WELCOME10", offer: "خصم 20% على جلسات الليزر", message: "نص الرسالة",
    });
  });
}

export async function listMessages(ctx: Ctx, q: { status?: string; category?: string; campaignId?: string; clientId?: string; from?: string; to?: string; q?: string; page?: number }) {
  const tenantId = requireTenant(ctx, "notifications.view");
  const where: Prisma.MessageWhereInput = { tenantId };
  if (q.status) where.status = q.status as never;
  if (q.category) where.category = q.category as never;
  if (q.campaignId) where.campaignId = q.campaignId;
  if (q.clientId) where.clientId = q.clientId;
  if (q.q) where.OR = [{ toPhone: { contains: q.q.replace(/\D/g, "") || q.q } }, { client: { fullName: { contains: q.q, mode: "insensitive" } } }];
  if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
  const page = Math.max(1, q.page ?? 1);
  return withTenant(tenantId, async (tx) => {
    const scope = recordBranchScope(ctx);
    if (scope.branchId) where.AND = [{ OR: [{ clientId: null }, { client: { branchId: scope.branchId } }] }];
    const [items, total, byStatus] = await Promise.all([
      tx.message.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { client: { select: { id: true, fullName: true, code: true } }, campaign: { select: { id: true, name: true } } } }),
      tx.message.count({ where }),
      tx.message.groupBy({ by: ["status"], where: { ...where, status: undefined }, _count: true }),
    ]);
    return { items, total, page, byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count])) };
  });
}

export const sendSchema = z.object({
  clientIds: z.array(z.string().uuid()).min(1).max(500),
  category: z.enum(["CUSTOM", "PROMOTION", "REACTIVATION", "PAYMENT_REMINDER", "FOLLOW_UP", "SESSION_REMINDER", "SUBSCRIPTION_EXPIRY"]).default("CUSTOM"),
  templateId: z.string().uuid().optional().nullable(),
  message: optText(1024),
  scheduledFor: z.coerce.date().optional().nullable(),
});

/** Best-effort context for manual sends: open program, ending subscription, unpaid invoice, last service. */
async function clientContextVars(tx: Tx, tenantId: string, clientId: string, branchId: string, b: Base) {
  const [branch, prog, sub, inv, last] = await Promise.all([
    tx.branch.findFirst({ where: { id: branchId, tenantId }, select: { name: true } }),
    tx.clientProgram.findFirst({ where: { tenantId, clientId, status: { in: ["ACTIVE", "PAUSED"] } }, orderBy: { startDate: "desc" }, include: { items: { include: { _count: { select: { sessions: true } } } } } }),
    tx.clientSubscription.findFirst({ where: { tenantId, clientId, status: "ACTIVE" }, orderBy: { endDate: "asc" } }),
    tx.invoice.findFirst({ where: { tenantId, clientId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, orderBy: { issuedAt: "asc" } }),
    tx.appointment.findFirst({ where: { tenantId, clientId, status: "COMPLETED" }, orderBy: { startsAt: "desc" }, include: { service: { select: { name: true } } } }),
  ]);
  return {
    branch_name: branch?.name, service: last?.service?.name,
    program_name: prog?.name, remaining: prog ? prog.items.reduce((a, i) => a + Math.max(0, i.sessionsTotal - i._count.sessions), 0) : undefined,
    plan_name: sub?.name, end_date: sub ? fmt(sub.endDate, "UTC", "ar", "date") : undefined,
    invoice_code: inv?.code ?? undefined, amount: inv ? money(Number(inv.total) - Number(inv.paidTotal), b.cur, "ar") : undefined, due_date: inv ? fmt(inv.dueDate ?? inv.issuedAt, b.tz, "ar", "date") : undefined,
  };
}

/** Manual send to one or more clients (from the client page or follow-up lists). */
export async function sendToClients(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "notifications.create");
  const d = sendSchema.parse(raw);
  if (!d.templateId && !d.message) throw badRequest("Write a message or choose a template");
  const res = await withTenant(tenantId, async (tx) => {
    const clients = await tx.client.findMany({ where: { tenantId, id: { in: d.clientIds }, deletedAt: null, ...recordBranchScope(ctx) } });
    if (!clients.length) throw badRequest("No clients found");
    const b = await baseVars(tx, tenantId);
    let queued = 0, skipped = 0;
    for (const c of clients) {
      const m = await queueMessage(tx, tenantId, {
        category: d.category, client: c, templateId: d.templateId, body: d.templateId ? null : d.message,
        vars: { ...(d.templateId ? await clientContextVars(tx, tenantId, c.id, c.branchId, b) : {}), message: d.message ?? "" },
        scheduledFor: d.scheduledFor ?? new Date(), createdById: ctx.user.id,
      }, b);
      if (!m) { skipped++; continue; }
      queued++;
      await tx.clientInteraction.create({ data: { tenantId, clientId: c.id, type: "WHATSAPP", userId: ctx.user.id, content: m.body.slice(0, 2000) } });
    }
    await audit(tx, ctx, { action: "message.send", entity: "Message", after: { queued, skipped, category: d.category, clients: d.clientIds.length } });
    return { queued, skipped };
  });
  const sent = !d.scheduledFor || d.scheduledFor <= new Date() ? await dispatchQueued(tenantId) : null;
  return { ...res, dispatch: sent };
}

export async function messageAction(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireTenant(ctx, "notifications.update");
  const { action } = z.object({ action: z.enum(["CANCEL", "RETRY"]) }).parse(raw);
  const r = await withTenant(tenantId, async (tx) => {
    const m = await tx.message.findFirst({ where: { id, tenantId } });
    if (!m) throw notFound("Message not found");
    if (action === "CANCEL") {
      if (m.status !== "QUEUED") throw conflict("Only queued messages can be cancelled");
      return tx.message.update({ where: { id }, data: { status: "CANCELLED", error: "Cancelled by user" } });
    }
    if (!["FAILED", "CANCELLED"].includes(m.status)) throw conflict("Only failed or cancelled messages can be retried");
    return tx.message.update({ where: { id }, data: { status: "QUEUED", attempts: 0, error: null, failedAt: null, scheduledFor: new Date() } });
  });
  if (action === "RETRY") await dispatchQueued(tenantId);
  return r;
}

/** "Run now": automations + dispatch for the caller's tenant. */
export async function runNow(ctx: Ctx) {
  const tenantId = requireTenant(ctx, "notifications.update");
  const created = await runAutomations(tenantId);
  const sent = await dispatchQueued(tenantId, new Date(), 200);
  await withTenant(tenantId, (tx) => audit(tx, ctx, { action: "messaging.run", entity: "Message", after: { created, ...sent } }));
  return { created, ...sent };
}

export async function messagingStats(ctx: Ctx, days = 30) {
  const tenantId = requireTenant(ctx, "notifications.view");
  return withTenant(tenantId, async (tx) => {
    const since = new Date(Date.now() - days * 86400000);
    const rows = await tx.message.groupBy({ by: ["category", "status"], where: { tenantId, createdAt: { gte: since } }, _count: true });
    const queued = await tx.message.count({ where: { tenantId, status: "QUEUED" } });
    return { days, rows: rows.map((r) => ({ category: r.category, status: r.status, count: r._count })), queued };
  });
}

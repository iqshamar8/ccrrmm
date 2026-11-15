/**
 * Automated SaaS subscription lifecycle (run by cron, or manually by a
 * platform admin). Idempotent: running it twice for the same `now` changes
 * nothing the second time.
 *
 *   TRIALING  → NEW invoice `renewalLeadDays` before trial end (if autoRenew)
 *             → EXPIRED once the trial ends unpaid
 *   ACTIVE    → RENEWAL invoice `renewalLeadDays` before period end
 *               (if autoRenew and not cancelAtPeriodEnd; skipped while paused)
 *             → at period end: CANCELLED (cancelAtPeriodEnd) | EXPIRED (no autoRenew)
 *               | PAST_DUE (grace starts, access kept)
 *   PAST_DUE  → EXPIRED once `pastDueSince + graceDays` has passed
 *
 * The tenant itself is never SUSPENDED here — an expired subscription blocks
 * the app (402) but still lets the clinic pay, and a confirmed payment brings
 * it back to ACTIVE (see reviewPlatformPayment).
 *
 * Reminders go to tenant admins (+ users with "settings.update") on the days
 * listed in `reminderDays`, deduplicated per subscription/period/day.
 */
import { audit } from "../audit";
import { type Ctx, requirePlatform } from "../context";
import { type Tx, withPlatform } from "../db";
import { notifyPermission } from "./notifications";
import { issueSystemSubscriptionInvoice } from "./platform-billing";

const DAY = 86_400_000;

export type LifecycleReport = {
  at: string;
  scanned: number;
  invoicesIssued: number;
  reminders: number;
  expiredTrials: number;
  pastDue: number;
  expired: number;
  cancelled: number;
  errors: { subscriptionId: string; error: string }[];
};

type Sub = {
  id: string; tenantId: string; status: string; endsAt: Date | null; trialEndsAt: Date | null;
  autoRenew: boolean; cancelAtPeriodEnd: boolean; pausedAt: Date | null; pastDueSince: Date | null;
};

const SELECT = {
  id: true, tenantId: true, status: true, endsAt: true, trialEndsAt: true,
  autoRenew: true, cancelAtPeriodEnd: true, pausedAt: true, pastDueSince: true,
} as const;

export async function runSubscriptionLifecycle(
  now: Date = new Date(),
  opts: { subscriptionIds?: string[] } = {},
): Promise<LifecycleReport> {
  const report: LifecycleReport = {
    at: now.toISOString(), scanned: 0, invoicesIssued: 0, reminders: 0,
    expiredTrials: 0, pastDue: 0, expired: 0, cancelled: 0, errors: [],
  };

  const { settings, subs } = await withPlatform(async (tx) => ({
    settings: await tx.platformSettings.findUnique({ where: { id: 1 } }),
    subs: await tx.tenantSubscription.findMany({
      where: {
        ...(opts.subscriptionIds ? { id: { in: opts.subscriptionIds } } : {}),
        status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] }, tenant: { status: { notIn: ["SUSPENDED", "CANCELLED"] } } },
      select: SELECT,
    }),
  }));
  const graceDays = settings?.graceDays ?? 7;
  const leadDays = settings?.renewalLeadDays ?? 7;
  const reminderDays = new Set(settings?.reminderDays ?? [14, 7, 3, 1]);
  report.scanned = subs.length;

  for (const sub of subs) {
    try {
      await processOne(sub, now, { graceDays, leadDays, reminderDays }, report);
    } catch (e) {
      report.errors.push({ subscriptionId: sub.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}

/** Manual run from the platform console. Platform admins only; the run itself is audited. */
export async function runSubscriptionLifecycleAsPlatform(ctx: Ctx | null) {
  const c = requirePlatform(ctx);
  const report = await runSubscriptionLifecycle();
  await withPlatform((tx) => audit(tx, c, {
    action: "platform.lifecycle.run", entity: "platform",
    after: { ...report, errors: report.errors.length },
  }));
  return report;
}

async function processOne(
  sub: Sub, now: Date, cfg: { graceDays: number; leadDays: number; reminderDays: Set<number> }, report: LifecycleReport,
) {
  const t = now.getTime();

  if (sub.status === "TRIALING") {
    const end = sub.trialEndsAt;
    if (!end) return;
    if (end.getTime() <= t) {
      if (await transition(sub.id, "TRIALING", now, { status: "EXPIRED" }, "subscription.trial_expired")) report.expiredTrials++;
      return;
    }
    if (sub.autoRenew && end.getTime() - t <= cfg.leadDays * DAY) {
      if (await ensureInvoice(sub, "NEW", end, now)) report.invoicesIssued++;
    }
    if (await remind(sub, end, now, cfg.reminderDays, "trial")) report.reminders++;
    return;
  }

  if (sub.status === "ACTIVE") {
    if (sub.pausedAt || !sub.endsAt) return;
    const end = sub.endsAt;
    const renewing = sub.autoRenew && !sub.cancelAtPeriodEnd;
    if (end.getTime() <= t) {
      if (sub.cancelAtPeriodEnd) {
        if (await transition(sub.id, "ACTIVE", now, { status: "CANCELLED", cancelledAt: now }, "subscription.cancelled_at_period_end")) report.cancelled++;
      } else if (!sub.autoRenew) {
        if (await transition(sub.id, "ACTIVE", now, { status: "EXPIRED" }, "subscription.expired")) report.expired++;
      } else {
        if (await transition(sub.id, "ACTIVE", now, { status: "PAST_DUE", pastDueSince: end }, "subscription.past_due")) report.pastDue++;
        // Make sure the renewal invoice exists so the clinic can pay during grace.
        if (await ensureInvoice(sub, "RENEWAL", end, now)) report.invoicesIssued++;
      }
      return;
    }
    if (renewing && end.getTime() - t <= cfg.leadDays * DAY) {
      if (await ensureInvoice(sub, "RENEWAL", end, now)) report.invoicesIssued++;
    }
    if (await remind(sub, end, now, cfg.reminderDays, renewing ? "renewal" : "ending")) report.reminders++;
    return;
  }

  if (sub.status === "PAST_DUE") {
    const since = sub.pastDueSince ?? sub.endsAt ?? now;
    if (since.getTime() + cfg.graceDays * DAY <= t) {
      if (await transition(sub.id, "PAST_DUE", now, { status: "EXPIRED" }, "subscription.expired")) report.expired++;
      return;
    }
    if (sub.endsAt && sub.autoRenew && !sub.cancelAtPeriodEnd) {
      if (await ensureInvoice(sub, "RENEWAL", sub.endsAt, now)) report.invoicesIssued++;
    }
  }
}

/** Issue the period invoice unless a non-void one already exists. Returns true if newly issued. */
async function ensureInvoice(sub: Sub, kind: "NEW" | "RENEWAL", periodStart: Date, now: Date) {
  const existing = await withPlatform((tx) =>
    tx.platformInvoice.findFirst({ where: { subscriptionId: sub.id, periodStart, kind, status: { not: "VOID" } }, select: { id: true } }));
  if (existing) return false;
  await issueSystemSubscriptionInvoice(sub.tenantId, sub.id, kind, { now });
  return true;
}

/** Lock, re-check the status hasn't moved, update, audit. Returns true if it changed. */
async function transition(
  subId: string, from: "TRIALING" | "ACTIVE" | "PAST_DUE", now: Date,
  data: { status: "EXPIRED" | "PAST_DUE" | "CANCELLED"; pastDueSince?: Date; cancelledAt?: Date }, action: string,
) {
  return withPlatform(async (tx: Tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${subId}, 0))`;
    const cur = await tx.tenantSubscription.findUnique({ where: { id: subId }, select: { ...SELECT } });
    if (!cur || cur.status !== from) return false;
    const after = await tx.tenantSubscription.update({ where: { id: subId }, data });
    await audit(tx, null, {
      action, entity: "tenant_subscription", entityId: subId, tenantId: cur.tenantId,
      before: { status: cur.status }, after: { status: after.status, pastDueSince: after.pastDueSince, at: now.toISOString() },
    });
    const title = data.status === "PAST_DUE"
      ? "انتهت فترة الاشتراك — يرجى السداد خلال فترة السماح"
      : data.status === "CANCELLED" ? "تم إلغاء الاشتراك بنهاية الفترة" : "انتهى الاشتراك — جدّد للمتابعة";
    await notifyPermission(tx, cur.tenantId, "settings.update", {
      type: action, title, link: "/settings/billing", dedupeKey: `${action}:${subId}:${(cur.endsAt ?? cur.trialEndsAt ?? now).toISOString()}`,
    });
    return true;
  });
}

/** Send a reminder when the whole days left matches `reminderDays`. Dedup via notification dedupeKey. */
async function remind(sub: Sub, end: Date, now: Date, days: Set<number>, kind: "trial" | "renewal" | "ending") {
  const left = Math.ceil((end.getTime() - now.getTime()) / DAY);
  if (!days.has(left)) return false;
  return withPlatform(async (tx) => {
    const title = kind === "trial"
      ? `تنتهي الفترة التجريبية خلال ${left} يوم`
      : kind === "renewal" ? `يتجدد الاشتراك خلال ${left} يوم — فاتورة التجديد بانتظار السداد` : `ينتهي الاشتراك خلال ${left} يوم`;
    const n = await notifyPermission(tx, sub.tenantId, "settings.update", {
      type: "subscription.reminder", title, link: "/settings/billing",
      dedupeKey: `sub-reminder:${sub.id}:${end.toISOString()}:${left}`,
    });
    if (n > 0) {
      await audit(tx, null, {
        action: "subscription.reminder", entity: "tenant_subscription", entityId: sub.id, tenantId: sub.tenantId,
        after: { daysLeft: left, kind, periodEnd: end.toISOString() },
      });
    }
    return n > 0;
  });
}

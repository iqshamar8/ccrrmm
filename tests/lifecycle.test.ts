import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withPlatform } from "@/server/db";
import { loadContext } from "@/server/context";
import * as platformBilling from "@/server/services/platform-billing";
import { runSubscriptionLifecycle, runSubscriptionLifecycleAsPlatform } from "@/server/services/subscription-lifecycle";
import { makePlan, makePlatformAdmin, makeTenant } from "./helpers";

const DAY = 86_400_000;
let planId: string;
let owner: Awaited<ReturnType<typeof makePlatformAdmin>>;
let graceDays = 7;
let leadDays = 7;
let reminderDays: number[] = [14, 7, 3, 1];

async function billableTenant() {
  const tenant = await makeTenant(planId);
  const subscription = await withPlatform((tx) => tx.tenantSubscription.findFirstOrThrow({ where: { tenantId: tenant.tenant.id } }));
  return { ...tenant, subscription };
}

type SubPatch = {
  status?: "TRIALING" | "ACTIVE" | "PAST_DUE"; endsAt?: Date | null; trialEndsAt?: Date | null; autoRenew?: boolean;
  cancelAtPeriodEnd?: boolean; pausedAt?: Date | null; pastDueSince?: Date | null; startsAt?: Date;
};

async function setSub(id: string, data: SubPatch) {
  return withPlatform((tx) => tx.tenantSubscription.update({ where: { id }, data }));
}

async function getSub(id: string) {
  return withPlatform((tx) => tx.tenantSubscription.findUniqueOrThrow({ where: { id } }));
}

const run = (now: Date, id: string) => runSubscriptionLifecycle(now, { subscriptionIds: [id] });

beforeAll(async () => {
  owner = await makePlatformAdmin();
  const plan = await makePlan();
  planId = plan.id;
  await withPlatform((tx) => tx.plan.update({ where: { id: plan.id }, data: { priceMonthly: 100, currency: "USD" } }));
  const s = await withPlatform((tx) => tx.platformSettings.findUnique({ where: { id: 1 } }));
  graceDays = s?.graceDays ?? graceDays;
  leadDays = s?.renewalLeadDays ?? leadDays;
  reminderDays = s?.reminderDays ?? reminderDays;
});

afterAll(async () => {
  const { disconnectAll } = await import("@/server/db");
  await disconnectAll();
});

describe("subscription lifecycle", () => {
  it("expires a trial that ended unpaid", async () => {
    const t = await billableTenant();
    const now = new Date();
    await setSub(t.subscription.id, { status: "TRIALING", trialEndsAt: new Date(now.getTime() - DAY), endsAt: null });
    await withPlatform((tx) => tx.tenant.update({ where: { id: t.tenant.id }, data: { status: "TRIAL" } }));

    const r = await run(now, t.subscription.id);
    expect(r.expiredTrials).toBe(1);
    expect((await getSub(t.subscription.id)).status).toBe("EXPIRED");
    // Second run: nothing left to do (EXPIRED isn't scanned).
    expect((await run(now, t.subscription.id)).scanned).toBe(0);
  });

  it("issues a NEW invoice when a trial ends within the lead window", async () => {
    const t = await billableTenant();
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + Math.max(1, leadDays - 2) * DAY);
    await setSub(t.subscription.id, { status: "TRIALING", trialEndsAt, endsAt: null, autoRenew: true });

    const r = await run(now, t.subscription.id);
    expect(r.invoicesIssued).toBe(1);
    const invoices = await withPlatform((tx) => tx.platformInvoice.findMany({ where: { subscriptionId: t.subscription.id } }));
    expect(invoices).toHaveLength(1);
    expect(invoices[0].kind).toBe("NEW");
    expect(invoices[0].periodStart.getTime()).toBe(trialEndsAt.getTime());
  });

  it("issues the RENEWAL invoice once (idempotent)", async () => {
    const t = await billableTenant();
    const now = new Date();
    await setSub(t.subscription.id, { status: "ACTIVE", endsAt: new Date(now.getTime() + Math.max(1, leadDays - 2) * DAY), autoRenew: true, cancelAtPeriodEnd: false });

    expect((await run(now, t.subscription.id)).invoicesIssued).toBe(1);
    expect((await run(now, t.subscription.id)).invoicesIssued).toBe(0);
    const invoices = await withPlatform((tx) => tx.platformInvoice.findMany({ where: { subscriptionId: t.subscription.id, kind: "RENEWAL" } }));
    expect(invoices).toHaveLength(1);
  });

  it("does not issue a renewal outside the lead window or when cancelling", async () => {
    const t = await billableTenant();
    const now = new Date();
    await setSub(t.subscription.id, { status: "ACTIVE", endsAt: new Date(now.getTime() + (leadDays + 5) * DAY), autoRenew: true });
    expect((await run(now, t.subscription.id)).invoicesIssued).toBe(0);

    await setSub(t.subscription.id, { endsAt: new Date(now.getTime() + DAY), cancelAtPeriodEnd: true });
    expect((await run(now, t.subscription.id)).invoicesIssued).toBe(0);
  });

  it("sends a reminder on a reminder day, once", async () => {
    const t = await billableTenant();
    const day = reminderDays[0] ?? 7;
    const now = new Date();
    // A little less than `day` whole days → ceil() lands exactly on `day`.
    await setSub(t.subscription.id, { status: "ACTIVE", endsAt: new Date(now.getTime() + day * DAY - 60_000), autoRenew: true });

    expect((await run(now, t.subscription.id)).reminders).toBe(1);
    expect((await run(now, t.subscription.id)).reminders).toBe(0);
    const n = await withPlatform((tx) => tx.notification.count({ where: { tenantId: t.tenant.id, type: "subscription.reminder" } }));
    expect(n).toBeGreaterThan(0);
  });

  it("moves an ended auto-renewing subscription to PAST_DUE but keeps access", async () => {
    const t = await billableTenant();
    const now = new Date();
    const endsAt = new Date(now.getTime() - DAY);
    await setSub(t.subscription.id, { status: "ACTIVE", endsAt, autoRenew: true, cancelAtPeriodEnd: false });

    const r = await run(now, t.subscription.id);
    expect(r.pastDue).toBe(1);
    expect(r.invoicesIssued).toBe(1);
    const sub = await getSub(t.subscription.id);
    expect(sub.status).toBe("PAST_DUE");
    expect(sub.pastDueSince?.getTime()).toBe(endsAt.getTime());

    const ctx = await loadContext(t.admin.id, null);
    expect(ctx?.tenant?.access).toBe("ok");

    // Re-running during grace changes nothing.
    const again = await run(now, t.subscription.id);
    expect(again.pastDue + again.expired + again.invoicesIssued).toBe(0);
  });

  it("expires a PAST_DUE subscription after the grace period", async () => {
    const t = await billableTenant();
    const now = new Date();
    const since = new Date(now.getTime() - (graceDays + 1) * DAY);
    await setSub(t.subscription.id, { status: "PAST_DUE", endsAt: since, pastDueSince: since, autoRenew: true });

    expect((await run(now, t.subscription.id)).expired).toBe(1);
    expect((await getSub(t.subscription.id)).status).toBe("EXPIRED");
    const ctx = await loadContext(t.admin.id, null);
    expect(ctx?.tenant?.access).toBe("expired");
  });

  it("cancels at period end when requested", async () => {
    const t = await billableTenant();
    const now = new Date();
    await setSub(t.subscription.id, { status: "ACTIVE", endsAt: new Date(now.getTime() - 1000), autoRenew: true, cancelAtPeriodEnd: true });

    expect((await run(now, t.subscription.id)).cancelled).toBe(1);
    const sub = await getSub(t.subscription.id);
    expect(sub.status).toBe("CANCELLED");
    expect(sub.cancelledAt).not.toBeNull();
  });

  it("expires at period end when autoRenew is off", async () => {
    const t = await billableTenant();
    const now = new Date();
    await setSub(t.subscription.id, { status: "ACTIVE", endsAt: new Date(now.getTime() - 1000), autoRenew: false, cancelAtPeriodEnd: false });

    const r = await run(now, t.subscription.id);
    expect(r.expired).toBe(1);
    expect(r.invoicesIssued).toBe(0);
    expect((await getSub(t.subscription.id)).status).toBe("EXPIRED");
  });

  it("leaves paused subscriptions alone", async () => {
    const t = await billableTenant();
    const now = new Date();
    await setSub(t.subscription.id, { status: "ACTIVE", endsAt: new Date(now.getTime() - DAY), autoRenew: true, pausedAt: new Date(now.getTime() - 2 * DAY) });

    const r = await run(now, t.subscription.id);
    expect(r.pastDue + r.expired + r.cancelled + r.invoicesIssued + r.reminders).toBe(0);
    expect((await getSub(t.subscription.id)).status).toBe("ACTIVE");
  });

  it("a confirmed renewal payment restores ACTIVE from PAST_DUE", async () => {
    const t = await billableTenant();
    const now = new Date();
    await setSub(t.subscription.id, { status: "ACTIVE", endsAt: new Date(now.getTime() - DAY), autoRenew: true, cancelAtPeriodEnd: false });
    await run(now, t.subscription.id);
    expect((await getSub(t.subscription.id)).status).toBe("PAST_DUE");

    const invoice = await withPlatform((tx) => tx.platformInvoice.findFirstOrThrow({ where: { subscriptionId: t.subscription.id, kind: "RENEWAL" } }));
    const payment = await platformBilling.submitPlatformPayment(t.ctx, invoice.id, { amount: Number(invoice.total), method: "BANK_TRANSFER", reference: "LC-TEST" });
    await platformBilling.reviewPlatformPayment(owner, payment.id, { status: "CONFIRMED" });

    const sub = await getSub(t.subscription.id);
    expect(sub.status).toBe("ACTIVE");
    expect(sub.pastDueSince).toBeNull();
    expect(sub.endsAt?.getTime()).toBe(invoice.periodEnd.getTime());
  });

  it("manual run is platform-admin only", async () => {
    const t = await billableTenant();
    await expect(runSubscriptionLifecycleAsPlatform(t.ctx)).rejects.toMatchObject({ status: 403 });
  });
});

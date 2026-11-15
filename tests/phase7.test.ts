import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withPlatform, withTenant } from "@/server/db";
import * as platformBilling from "@/server/services/platform-billing";
import { makePlan, makePlatformAdmin, makeTenant } from "./helpers";

let owner: Awaited<ReturnType<typeof makePlatformAdmin>>;
let planId: string;

async function billableTenant() {
  const tenant = await makeTenant(planId);
  const subscription = await withPlatform((tx) => tx.tenantSubscription.findFirstOrThrow({ where: { tenantId: tenant.tenant.id } }));
  return { ...tenant, subscription };
}

beforeAll(async () => {
  owner = await makePlatformAdmin();
  const plan = await makePlan();
  planId = plan.id;
  await withPlatform((tx) => tx.plan.update({ where: { id: plan.id }, data: { priceMonthly: 100, currency: "USD" } }));
});

afterAll(async () => {
  const { disconnectAll } = await import("@/server/db");
  await disconnectAll();
});

describe("platform SaaS billing", () => {
  it("issues an idempotent subscription invoice using the plan price", async () => {
    const issue = (platformBilling as Record<string, any>).issueSubscriptionInvoice;
    const t = await billableTenant();
    const first = await issue(owner, t.tenant.id, t.subscription.id, "NEW");
    const again = await issue(owner, t.tenant.id, t.subscription.id, "NEW");
    expect(first.id).toBe(again.id);
    expect(first.number).toMatch(/^SUB-\d{4}-\d{6}$/);
    expect(Number(first.subtotal)).toBe(100);
    expect(Number(first.total)).toBe(100);
    expect(first.status).toBe("ISSUED");
  });

  it("scopes invoice reads and payment submissions to the tenant", async () => {
    const issue = (platformBilling as Record<string, any>).issueSubscriptionInvoice;
    const t = await billableTenant();
    const invoice = await issue(owner, t.tenant.id, t.subscription.id, "NEW");
    const list = (platformBilling as Record<string, any>).listPlatformInvoices;
    const submit = (platformBilling as Record<string, any>).submitPlatformPayment;
    const other = await billableTenant();
    await expect(list(other.ctx)).resolves.toEqual([]);
    await expect(submit(other.ctx, invoice.id, { amount: 100, method: "BANK_TRANSFER", reference: "TX-1" }))
      .rejects.toMatchObject({ status: 404 });
    const payment = await submit(t.ctx, invoice.id, { amount: 100, method: "BANK_TRANSFER", reference: "TX-2" });
    expect(payment.status).toBe("PENDING");
  });

  it("activates the subscription only after an authorized payment confirmation", async () => {
    const issue = (platformBilling as Record<string, any>).issueSubscriptionInvoice;
    const t = await billableTenant();
    await withPlatform(async (tx) => {
      await tx.tenantSubscription.update({ where: { id: t.subscription.id }, data: { status: "TRIALING", trialEndsAt: new Date(Date.now() + 60_000), endsAt: null } });
      await tx.tenant.update({ where: { id: t.tenant.id }, data: { status: "TRIAL" } });
    });
    const invoice = await issue(owner, t.tenant.id, t.subscription.id, "NEW");
    const submit = (platformBilling as Record<string, any>).submitPlatformPayment;
    const review = (platformBilling as Record<string, any>).reviewPlatformPayment;
    const first = await submit(t.ctx, invoice.id, { amount: 40, method: "BANK_TRANSFER", reference: "TX-3A" });
    await review(owner, first.id, { status: "CONFIRMED" });
    let updated = await withPlatform((tx) => tx.tenantSubscription.findUniqueOrThrow({ where: { id: t.subscription.id } }));
    expect(updated.status).toBe("TRIALING");
    const second = await submit(t.ctx, invoice.id, { amount: 60, method: "BANK_TRANSFER", reference: "TX-3B" });
    await expect(review(t.ctx, second.id, { status: "CONFIRMED" })).rejects.toMatchObject({ status: 403 });
    await review(owner, second.id, { status: "CONFIRMED" });
    updated = await withPlatform((tx) => tx.tenantSubscription.findUniqueOrThrow({ where: { id: t.subscription.id } }));
    expect(updated.status).toBe("ACTIVE");
    expect(updated.endsAt).toEqual(invoice.periodEnd);
  });

  it("prevents tenant database credentials from inserting a pre-confirmed payment", async () => {
    const t = await billableTenant();
    const invoice = await (platformBilling as Record<string, any>).issueSubscriptionInvoice(owner, t.tenant.id, t.subscription.id, "NEW");
    await expect(withTenant(t.tenant.id, (tx) => tx.platformPayment.create({
      data: { tenantId: t.tenant.id, invoiceId: invoice.id, amount: 100, method: "BANK_TRANSFER", status: "CONFIRMED", confirmedById: owner.user.id, confirmedAt: new Date() },
    }))).rejects.toThrow(/tenant app may only submit pending platform payments/);
  });

  it("rejects overpayment and duplicate pending submissions beyond the balance", async () => {
    const issue = (platformBilling as Record<string, any>).issueSubscriptionInvoice;
    const t = await billableTenant();
    const invoice = await issue(owner, t.tenant.id, t.subscription.id, "NEW");
    const submit = (platformBilling as Record<string, any>).submitPlatformPayment;
    await expect(submit(t.ctx, invoice.id, { amount: 101, method: "BANK_TRANSFER" })).rejects.toMatchObject({ status: 400 });
    await submit(t.ctx, invoice.id, { amount: 70, method: "BANK_TRANSFER", reference: "TX-4" });
    await expect(submit(t.ctx, invoice.id, { amount: 40, method: "BANK_TRANSFER", reference: "TX-5" })).rejects.toMatchObject({ status: 400 });
  });
});

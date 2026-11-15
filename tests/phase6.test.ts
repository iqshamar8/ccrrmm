/** Phase 6: messaging (queue, automations, providers, webhook), notifications, marketing, influencers, reports, isolation. */
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { disconnectAll, withPlatform, withTenant } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { createClient } from "@/server/services/clients";
import { createService } from "@/server/services/catalog";
import { createAppointment, setAppointmentStatus } from "@/server/services/appointments";
import { addPayment, createInvoice, refundInvoice } from "@/server/services/billing";
import { encryptSecret } from "@/server/crypto";
import {
  dispatchQueued, getMessagingSettings, handleWebhook, inQuietHours, listMessages, render, runAutomations, saveMessagingSettings, sendToClients, toE164,
} from "@/server/services/messaging";
import { listMyNotifications, markNotificationsRead } from "@/server/services/notifications";
import {
  getCampaign, influencerCommissionAction, launchCampaign, listInfluencers, previewAudience, saveCampaign, saveInfluencer,
} from "@/server/services/marketing";
import { listReports, runReport } from "@/server/services/reports";
import { buildXlsx } from "@/server/xlsx";
import { makePlan, makeTenant, makeUserWithRole } from "./helpers";

let A: Awaited<ReturnType<typeof makeTenant>>, B: Awaited<ReturnType<typeof makeTenant>>;
let doctor: Ctx, svc: string, client: { id: string; phone: string }, k = 0;
const future = (h = 30) => { const d = new Date(Date.now() + h * 3600000); d.setUTCMinutes(0, 0, 0); d.setUTCHours(d.getUTCHours() + (k++ % 5)); return d; };

/** Messaging settings straight in the DB (quiet hours off so tests don't depend on the clock). */
const setProvider = (tenantId: string, data: Record<string, unknown>) =>
  withPlatform((tx) => tx.messagingSettings.upsert({ where: { tenantId }, create: { tenantId, quietStartHour: 0, quietEndHour: 0, ...data }, update: { quietStartHour: 0, quietEndHour: 0, ...data } }));
const msgs = (tenantId: string, where: Record<string, unknown> = {}) => withPlatform((tx) => tx.message.findMany({ where: { tenantId, ...where }, orderBy: { createdAt: "asc" } }));

beforeAll(async () => {
  const plan = await makePlan({ maxUsers: 50 });
  A = await makeTenant(plan.id);
  B = await makeTenant(plan.id);
  const d = await makeUserWithRole(A.tenant.id, "doctor");
  await withPlatform((tx) => tx.user.update({ where: { id: d.user.id }, data: { allBranches: true } }));
  doctor = (await loadContext(d.user.id, null))!;
  svc = (await createService(A.ctx, { name: "Laser face", price: 100, durationMin: 30 })).id;
  client = await createClient(A.ctx, { fullName: "Msg Client", phone: "0770 111 2233" });
  await setProvider(A.tenant.id, { provider: "SANDBOX" });
  await setProvider(B.tenant.id, { provider: "SANDBOX" });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(disconnectAll);

describe("templates & helpers", () => {
  it("renders placeholders in order (WhatsApp body parameters) and normalises phones", () => {
    const r = render("Hi {{client_name}}, {{date}} at {{time}} — {{missing}}", { client_name: "Sara", date: "Mon", time: "10:00" });
    expect(r.text).toBe("Hi Sara, Mon at 10:00 — -");
    expect(r.params).toEqual(["Sara", "Mon", "10:00", "-"]);
    expect([toE164("0770 111 2233", "964"), toE164("+964 770 111 2233", "964"), toE164("00964770", "964")]).toEqual(["9647701112233", "9647701112233", "964770"]);
  });
  it("quiet hours wrap around midnight", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h, 30));
    expect([inQuietHours(at(23), "UTC", 22, 9), inQuietHours(at(3), "UTC", 22, 9), inQuietHours(at(12), "UTC", 22, 9), inQuietHours(at(12), "UTC", 0, 0)]).toEqual([true, true, false, false]);
  });
});

describe("booking confirmation, reminders and relevance", () => {
  let apptId: string;
  it("booking queues a confirmation and notifies the assigned staff member", async () => {
    const a = (await createAppointment(A.ctx, { clientId: client.id, serviceId: svc, staffId: doctor.user.id, startsAt: future() })) as { id: string };
    apptId = a.id;
    const m = await msgs(A.tenant.id, { relatedId: a.id });
    expect(m.map((x) => x.category)).toEqual(["APPOINTMENT_CONFIRM"]);
    expect(m[0].toPhone).toBe("9647701112233");
    expect(m[0].body).toContain("Msg Client");
    const n = await listMyNotifications(doctor);
    expect(n.items.some((x) => x.type === "appointment.assigned")).toBe(true);
    expect(n.unread).toBeGreaterThan(0);
  });

  it("automations are idempotent and sandbox delivery is simulated", async () => {
    await runAutomations(A.tenant.id);
    await runAutomations(A.tenant.id);
    const rem = await msgs(A.tenant.id, { relatedId: apptId, category: "APPOINTMENT_REMINDER" });
    expect(rem.length).toBe(1);
    expect(+rem[0].scheduledFor).toBeGreaterThan(Date.now()); // 24h before a 30h-away visit
    const r = await dispatchQueued(A.tenant.id);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const conf = (await msgs(A.tenant.id, { relatedId: apptId, category: "APPOINTMENT_CONFIRM" }))[0];
    expect(conf.status).toBe("DELIVERED");
    expect(conf.providerMessageId).toMatch(/^sandbox\./);
  });

  it("a reminder for a cancelled appointment is cancelled instead of sent", async () => {
    await setAppointmentStatus(A.ctx, apptId, { status: "CANCELLED", reason: "client asked" });
    await withPlatform((tx) => tx.message.updateMany({ where: { relatedId: apptId, category: "APPOINTMENT_REMINDER" }, data: { scheduledFor: new Date(Date.now() - 1000) } }));
    await dispatchQueued(A.tenant.id);
    const rem = (await msgs(A.tenant.id, { relatedId: apptId, category: "APPOINTMENT_REMINDER" }))[0];
    expect([rem.status, rem.error]).toEqual(["CANCELLED", "No longer relevant"]);
  });

  it("payment reminder for an overdue invoice, once per round", async () => {
    const inv = await createInvoice(A.ctx, { clientId: client.id, lines: [{ kind: "SERVICE", serviceId: svc, quantity: 1 }] }, { issue: true });
    await withPlatform((tx) => tx.invoice.update({ where: { id: inv.id }, data: { dueDate: new Date(Date.now() - 5 * 86400000) } }));
    await runAutomations(A.tenant.id);
    await runAutomations(A.tenant.id);
    const m = await msgs(A.tenant.id, { relatedId: inv.id, category: "PAYMENT_REMINDER" });
    expect(m.length).toBe(1);
    expect(m[0].body).toContain(inv.code!);
  });
});

describe("providers", () => {
  it("WhatsApp Cloud API: sends an approved template with ordered parameters", async () => {
    const C = await makeTenant((await makePlan()).id);
    const cl = await createClient(C.ctx, { fullName: "Cloud Client", phone: "0771 000 0001" });
    await setProvider(C.tenant.id, { provider: "WHATSAPP_CLOUD", phoneNumberId: "123456", accessTokenEnc: encryptSecret("EAAtoken") });
    await withPlatform(async (tx) => { const { ensureTemplates } = await import("@/server/services/messaging"); await ensureTemplates(tx, C.tenant.id); await tx.messageTemplate.updateMany({ where: { tenantId: C.tenant.id, category: "CUSTOM" }, data: { waTemplateName: "custom_note", waLanguage: "ar" } }); });
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.OK1" }] }), { status: 200 });
    }));
    const r = await sendToClients(C.ctx, { clientIds: [cl.id], message: "Your results are ready" });
    expect(r.dispatch?.sent).toBe(1);
    expect(calls[0].url).toMatch(/\/123456\/messages$/);
    expect(calls[0].auth).toBe("Bearer EAAtoken");
    expect(calls[0].body).toMatchObject({ to: "9647710000001", type: "template", template: { name: "custom_note", components: [{ type: "body", parameters: [{ type: "text", text: "Your results are ready" }] }] } });
    expect((await msgs(C.tenant.id))[0]).toMatchObject({ status: "SENT", providerMessageId: "wamid.OK1" });

    // API rejection (e.g. outside the 24h window) → FAILED with Meta's error, no retry for 4xx.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 })));
    await sendToClients(C.ctx, { clientIds: [cl.id], message: "again" });
    const last = (await msgs(C.tenant.id)).at(-1)!;
    expect(last.status).toBe("FAILED");
    expect(last.error).toContain("131047");
  });

  it("quiet hours hold automatic messages but not ones a staff member sends by hand", async () => {
    const C = await makeTenant((await makePlan()).id);
    const cl = await createClient(C.ctx, { fullName: "Quiet Client", phone: "0771 000 0003" });
    await setProvider(C.tenant.id, { provider: "SANDBOX" });
    await withPlatform((tx) => tx.messagingSettings.update({ where: { tenantId: C.tenant.id }, data: { quietStartHour: 0, quietEndHour: 23 } })); // quiet almost all day
    const now = new Date(); now.setUTCHours(12); // inside 00–23 in any zone offset ≤ ±11
    const auto = await withPlatform((tx) => tx.message.create({ data: { tenantId: C.tenant.id, category: "PROMOTION", toPhone: "9647710000003", clientId: cl.id, body: "auto", params: [], scheduledFor: new Date(Date.now() - 1000) } }));
    await sendToClients(C.ctx, { clientIds: [cl.id], category: "PROMOTION", message: "manual" });
    await dispatchQueued(C.tenant.id, now);
    const all = await msgs(C.tenant.id);
    expect(all.find((m) => m.id === auto.id)?.status).toBe("QUEUED");
    expect(all.find((m) => m.body === "manual")?.status).toBe("DELIVERED");
  });

  it("DISABLED cancels queued messages; settings never expose secrets", async () => {
    const C = await makeTenant((await makePlan()).id);
    const cl = await createClient(C.ctx, { fullName: "Off Client", phone: "0771 000 0002" });
    await setProvider(C.tenant.id, { provider: "DISABLED" });
    await sendToClients(C.ctx, { clientIds: [cl.id], message: "hello" });
    expect((await msgs(C.tenant.id))[0]).toMatchObject({ status: "CANCELLED", error: "Messaging is turned off" });

    const s = await getMessagingSettings(C.ctx);
    await saveMessagingSettings(C.ctx, { ...s, provider: "WHATSAPP_CLOUD", phoneNumberId: "999", accessToken: "SECRET_TOKEN_1234", appSecret: "app-secret" });
    const after = await getMessagingSettings(C.ctx);
    expect(after.accessToken).toBe("••••1234");
    expect(JSON.stringify(after)).not.toContain("SECRET_TOKEN");
    const row = await withPlatform((tx) => tx.messagingSettings.findUniqueOrThrow({ where: { tenantId: C.tenant.id } }));
    expect(row.accessTokenEnc).not.toContain("SECRET_TOKEN");
    const log = await withPlatform((tx) => tx.auditLog.findFirst({ where: { tenantId: C.tenant.id, action: "messaging.settings" } }));
    expect(JSON.stringify(log, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain("SECRET_TOKEN");
  });
});

describe("webhook", () => {
  it("rejects bad signatures, applies delivery statuses forward-only, records replies and STOP", async () => {
    await setProvider(A.tenant.id, { appSecretEnc: encryptSecret("whsec") });
    const m = await withPlatform((tx) => tx.message.create({ data: { tenantId: A.tenant.id, category: "CUSTOM", status: "SENT", toPhone: "9647701112233", clientId: client.id, body: "x", params: [], providerMessageId: "wamid.HOOK" } }));
    const payload = (statuses: unknown[], messages: unknown[] = []) => JSON.stringify({ entry: [{ changes: [{ value: { statuses, messages } }] }] });
    const sign = (b: string) => "sha256=" + createHmac("sha256", "whsec").update(b).digest("hex");
    const b1 = payload([{ id: "wamid.HOOK", status: "read", timestamp: String(Math.floor(Date.now() / 1000)) }]);
    await expect(handleWebhook(A.tenant.id, b1, "sha256=deadbeef")).rejects.toMatchObject({ status: 401 });
    await handleWebhook(A.tenant.id, b1, sign(b1));
    const b2 = payload([{ id: "wamid.HOOK", status: "delivered" }]); // late "delivered" must not downgrade READ
    await handleWebhook(A.tenant.id, b2, sign(b2));
    const now = await withPlatform((tx) => tx.message.findUniqueOrThrow({ where: { id: m.id } }));
    expect(now.status).toBe("READ");
    expect(now.readAt).toBeTruthy();

    const b3 = payload([], [{ from: "9647701112233", id: "in1", type: "text", text: { body: "STOP" } }]);
    const r = await handleWebhook(A.tenant.id, b3, sign(b3));
    expect(r.inbound).toBe(1);
    const c = await withPlatform((tx) => tx.client.findUniqueOrThrow({ where: { id: client.id } }));
    expect(c.marketingOptOut).toBe(true);
    // B's webhook can't touch A's message even with a valid B signature.
    await setProvider(B.tenant.id, { appSecretEnc: encryptSecret("bsec") });
    const b4 = payload([{ id: "wamid.HOOK", status: "failed" }]);
    const rb = await handleWebhook(B.tenant.id, b4, "sha256=" + createHmac("sha256", "bsec").update(b4).digest("hex"));
    expect(rb.updated).toBe(0);
    await withPlatform((tx) => tx.client.update({ where: { id: client.id }, data: { marketingOptOut: false } }));
  });
});

describe("marketing", () => {
  it("audiences exclude opted-out clients; campaigns queue per recipient and attribute purchases", async () => {
    const opted = await createClient(A.ctx, { fullName: "No Marketing", phone: "0770 999 0001", tags: ["camp"] });
    const yes = await createClient(A.ctx, { fullName: "Yes Marketing", phone: "0770 999 0002", tags: ["camp"] });
    await withPlatform((tx) => tx.client.update({ where: { id: opted.id }, data: { marketingOptOut: true } }));
    const p = await previewAudience(A.ctx, { tags: ["camp"] });
    expect(p.count).toBe(1);
    const c = await saveCampaign(A.ctx, null, { name: "Spring promo", objective: "PROMOTION", filter: { tags: ["camp"] }, body: "Hi {{client_name}}!", budget: 50 });
    expect(c.code).toMatch(/^CMP-/);
    const l = await launchCampaign(A.ctx, c.id, {});
    expect(l.queued).toBe(1);
    await expect(launchCampaign(A.ctx, c.id, {})).rejects.toMatchObject({ status: 409 });
    const inv = await createInvoice(A.ctx, { clientId: yes.id, lines: [{ kind: "SERVICE", serviceId: svc, quantity: 1 }] }, { issue: true });
    await addPayment(A.ctx, inv.id, { amount: 100, method: "CASH" });
    const g = await getCampaign(A.ctx, c.id);
    expect(g.stats).toMatchObject({ recipients: 1, delivered: 1, converted: 1 });
    expect(Number(g.stats.revenue)).toBe(100);
    expect(g.stats.roi).toBe(100); // (100 − 50) / 50
  });

  it("influencer earns on a referred client's paid invoice, reversed on refund, paid through the ledger", async () => {
    const inf = await saveInfluencer(A.ctx, null, { name: "Noor", platform: "instagram", commissionType: "PERCENT", commissionValue: 10, attributionDays: 90 });
    const cl = await createClient(A.ctx, { fullName: "Referred One", phone: "0770 999 0003", influencerId: inf.id });
    const inv = await createInvoice(A.ctx, { clientId: cl.id, lines: [{ kind: "SERVICE", serviceId: svc, quantity: 1 }] }, { issue: true });
    await addPayment(A.ctx, inv.id, { amount: 100, method: "CASH" });
    let rows = await withPlatform((tx) => tx.influencerCommission.findMany({ where: { influencerId: inf.id } }));
    expect(rows.map((r) => [r.source, Number(r.amount)])).toEqual([["REFERRAL", 10]]);
    await refundInvoice(A.ctx, inv.id, { amount: 50, method: "CASH", reason: "half" });
    rows = await withPlatform((tx) => tx.influencerCommission.findMany({ where: { influencerId: inf.id }, orderBy: { createdAt: "asc" } }));
    expect(rows.map((r) => Number(r.amount))).toEqual([10, -5]);
    await influencerCommissionAction(A.ctx, inf.id, { action: "APPROVE", ids: rows.map((r) => r.id) });
    const paid = await influencerCommissionAction(A.ctx, inf.id, { action: "PAY", ids: [] });
    expect(Number((paid as { paid: unknown }).paid)).toBe(5);
    const lines = await withTenant(A.tenant.id, (tx) => tx.journalLine.findMany({ where: { entry: { source: "INFLUENCER", sourceId: inf.id } }, include: { account: true } }));
    expect(lines.find((l) => l.account.code === "5106")?.debit.toString()).toBe("5");
    const list = await listInfluencers(A.ctx);
    expect(list.find((x) => x.id === inf.id)?.stats.referred).toBe(1);
  });
});

describe("reports", () => {
  it("lists only permitted reports, runs them, hides money without finance access, exports xlsx", async () => {
    const keys = listReports(A.ctx).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["clients-overview", "finance-monthly", "branches-compare", "period-compare", "influencers", "campaigns"]));
    for (const key of keys) {
      const r = await runReport(A.ctx, key, { from: new Date(Date.now() - 30 * 86400000).toISOString(), lang: "en" });
      expect(Array.isArray(r.rows)).toBe(true);
      expect(r.columns.length).toBeGreaterThan(0);
    }
    const rec = await makeUserWithRole(A.tenant.id, "marketing"); // reports.view without finance.view_data
    const mk = listReports(rec).map((r) => r.key);
    expect(mk).not.toContain("finance-monthly");
    const camp = await runReport(rec, "campaigns", {});
    expect(camp.columns.some((c) => c.type === "money")).toBe(false);
    await expect(runReport(rec, "receivables", {})).rejects.toMatchObject({ status: 403 });
    const file = buildXlsx({ sheet: "T", header: ["a", "b"], rows: [["x", 1]], rtl: true });
    expect(String.fromCharCode(file[0], file[1])).toBe("PK");
  });

  it("branch-restricted users can't report on other branches", async () => {
    const mgr = await makeUserWithRole(A.tenant.id, "branch_manager");
    const other = await withPlatform((tx) => tx.branch.create({ data: { tenantId: A.tenant.id, name: "Far branch", code: "FAR" } }));
    await expect(runReport(mgr, "branches-compare", { branchId: other.id })).rejects.toMatchObject({ status: 403 });
  });
});

describe("isolation", () => {
  it("another tenant sees none of this tenant's messages, notifications or campaigns", async () => {
    expect((await listMessages(B.ctx, {})).total).toBe(0);
    expect((await listMyNotifications(B.ctx)).items.length).toBe(0);
    expect((await previewAudience(B.ctx, {})).sample.some((s) => s.id === client.id)).toBe(false);
    await expect(sendToClients(B.ctx, { clientIds: [client.id], message: "hi" })).rejects.toMatchObject({ status: 400 });
    expect(await withTenant(B.tenant.id, (tx) => tx.message.count({ where: { tenantId: A.tenant.id } }))).toBe(0);
    // A user can only mark their own notifications read.
    const mine = await listMyNotifications(doctor);
    const r = await markNotificationsRead(A.ctx, { ids: mine.items.map((i) => i.id) });
    expect(r.updated).toBe(0);
    expect((await markNotificationsRead(doctor, { all: true })).updated).toBeGreaterThan(0);
    // The app role can't delete the message log.
    await expect(withTenant(A.tenant.id, (tx) => tx.message.deleteMany({ where: { tenantId: A.tenant.id } }))).rejects.toThrow();
  });

  it("modules outside the plan are refused", async () => {
    const C = await makeTenant((await makePlan({ features: ["clients", "appointments", "services", "invoices", "reports"] })).id);
    await expect(getMessagingSettings(C.ctx)).rejects.toMatchObject({ status: 403 });
    await expect(previewAudience(C.ctx, {})).rejects.toMatchObject({ status: 403 });
    expect(listReports(C.ctx).map((r) => r.key)).not.toContain("campaigns");
  });
});

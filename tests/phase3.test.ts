/** Phase 3: programs, client subscriptions, surgeries, reviews. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withPlatform, withTenant } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { createClient } from "@/server/services/clients";
import { createRoom, createService } from "@/server/services/catalog";
import { createAppointment, setAppointmentStatus } from "@/server/services/appointments";
import { assignProgram, createTemplate, getProgram, recordSession, renewProgram, setProgramStatus } from "@/server/services/programs";
import { clientCoverage, createPlan, getSubscription, sellSubscription, setSubscriptionStatus } from "@/server/services/subscriptions";
import { createSurgery, getSurgery, setSurgeryStatus } from "@/server/services/surgeries";
import { completeReview, createReview, getReview, listReviews } from "@/server/services/reviews";
import { createRole } from "@/server/services/roles";
import { listAudit } from "@/server/services/organization";
import { makePlan, makeTenant, makeUserWithRole } from "./helpers";

let A: Awaited<ReturnType<typeof makeTenant>>, B: Awaited<ReturnType<typeof makeTenant>>;
let doctor: Ctx, laser: string, facial: string, room: string, clientId: string, branchId: string;
let n = 0;
/** distinct past/future slots so tests never collide on the doctor's calendar */
const slot = (dayOffset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + dayOffset); d.setUTCHours(5 + (n++ % 12), 0, 0, 0); return d; };

beforeAll(async () => {
  const plan = await makePlan({ maxUsers: 50 });
  A = await makeTenant(plan.id);
  B = await makeTenant(plan.id);
  branchId = (await withPlatform((tx) => tx.branch.findFirstOrThrow({ where: { tenantId: A.tenant.id } }))).id;
  const d = await makeUserWithRole(A.tenant.id, "doctor");
  await withPlatform((tx) => tx.user.update({ where: { id: d.user.id }, data: { allBranches: true } }));
  doctor = (await loadContext(d.user.id, null))!;
  laser = (await createService(A.ctx, { name: "Laser", price: 100, durationMin: 30, kind: "LASER" })).id;
  facial = (await createService(A.ctx, { name: "Facial", price: 50, durationMin: 30 })).id;
  room = (await createRoom(A.ctx, { branchId, name: "OR", kind: "OPERATING" })).id;
  clientId = (await createClient(A.ctx, { fullName: "Program Client", phone: "0780 000 0001" })).id;
});
afterAll(disconnectAll);

const book = async (extra: Record<string, unknown>, day = -1) => {
  const a = await createAppointment(A.ctx, { clientId, staffId: doctor.user.id, startsAt: slot(day), durationMin: 30, ...extra });
  if (!("id" in a)) throw new Error("expected single appointment");
  return a;
};

describe("treatment programs", () => {
  it("consumes sessions on completed visits, enforces the balance and auto-completes", async () => {
    const tpl = await createTemplate(A.ctx, { name: "Laser x2", price: 180, validityDays: 90, items: [{ serviceId: laser, sessions: 2 }] });
    const p = await assignProgram(A.ctx, { clientId, templateId: tpl.id });
    const item = p.items[0];
    expect(p.progress).toMatchObject({ total: 2, used: 0 });

    const a1 = await book({ programItemId: item.id }, -2);
    expect(a1.serviceId).toBe(laser);       // service comes from the program
    expect(a1.price).toBeNull();            // prepaid: no per-visit price
    const a2 = await book({ programItemId: item.id }, -1);
    await expect(book({ programItemId: item.id }, -3)).rejects.toMatchObject({ status: 409 }); // 2 booked = full

    await setAppointmentStatus(A.ctx, a1.id, { status: "COMPLETED" });
    let g = await getProgram(A.ctx, p.id);
    expect(g.progress.used).toBe(1);
    expect(g.sessions[0].appointmentId).toBe(a1.id);

    await setAppointmentStatus(A.ctx, a2.id, { status: "COMPLETED" });
    g = await getProgram(A.ctx, p.id);
    expect(g.status).toBe("COMPLETED");
    await expect(recordSession(A.ctx, p.id, { itemId: item.id })).rejects.toMatchObject({ status: 409 });

    const renewed = await renewProgram(A.ctx, p.id, {});
    expect(renewed.status).toBe("ACTIVE");
    expect(renewed.progress).toMatchObject({ total: 2, used: 0 });
  });

  it("pause blocks booking; cancel needs a reason and cancels future sessions", async () => {
    const p = await assignProgram(A.ctx, { clientId, name: "Custom", price: 10, items: [{ serviceId: facial, sessions: 3 }] });
    const future = await book({ programItemId: p.items[0].id }, 5);
    await setProgramStatus(A.ctx, p.id, { action: "PAUSE" });
    await expect(book({ programItemId: p.items[0].id }, 6)).rejects.toMatchObject({ status: 409 });
    await setProgramStatus(A.ctx, p.id, { action: "RESUME" });
    await expect(setProgramStatus(A.ctx, p.id, { action: "CANCEL" })).rejects.toMatchObject({ status: 400 });
    await setProgramStatus(A.ctx, p.id, { action: "CANCEL", reason: "moved abroad" });
    const appt = await withPlatform((tx) => tx.appointment.findUniqueOrThrow({ where: { id: future.id } }));
    expect(appt.status).toBe("CANCELLED");
  });

  it("session notes are hidden from users without medical data access", async () => {
    const p = await assignProgram(A.ctx, { clientId, name: "Notes", price: 0, items: [{ serviceId: facial, sessions: 2 }] });
    await recordSession(doctor, p.id, { itemId: p.items[0].id, performedAt: slot(-1), notes: "secret clinical note" });
    const rec = await makeUserWithRole(A.tenant.id, "receptionist");
    await withPlatform((tx) => tx.user.update({ where: { id: rec.user.id }, data: { allBranches: true } }));
    const recCtx = (await loadContext(rec.user.id, null))!;
    const g = await getProgram(recCtx, p.id);
    expect(g.sessions[0].notes).toBeNull();
    expect((await getProgram(doctor, p.id)).sessions[0].notes).toBe("secret clinical note");
  });
});

describe("client subscriptions", () => {
  it("covers only listed services, consumes visits and closes when exhausted", async () => {
    const plan = await createPlan(A.ctx, { name: "2 laser visits", kind: "VISITS", price: 150, durationDays: 30, visitsLimit: 2, maxFreezeDays: 10, allServices: false, serviceIds: [laser] });
    const s = await sellSubscription(A.ctx, { clientId, planId: plan.id, startDate: new Date(Date.now() - 5 * 86400000) });
    expect(s.remaining).toBe(2);
    await expect(book({ subscriptionId: s.id, serviceId: facial })).rejects.toMatchObject({ status: 409 }); // not covered
    const cov = await clientCoverage(A.ctx, clientId);
    expect(cov.subscriptions.some((x) => x.id === s.id)).toBe(true);

    const v1 = await book({ subscriptionId: s.id, serviceId: laser }, -2);
    const v2 = await book({ subscriptionId: s.id, serviceId: laser }, -1);
    await expect(book({ subscriptionId: s.id, serviceId: laser }, -3)).rejects.toMatchObject({ status: 409 }); // 2 reserved
    await setAppointmentStatus(A.ctx, v1.id, { status: "COMPLETED" });
    await setAppointmentStatus(A.ctx, v2.id, { status: "COMPLETED" });
    const g = await getSubscription(A.ctx, s.id);
    expect(g.used).toBe(2);
    expect(g.status).toBe("EXPIRED");
  });

  it("freeze/unfreeze extends the end date within the allowance; cancel needs a reason", async () => {
    const plan = await createPlan(A.ctx, { name: "Monthly", kind: "TIME", price: 99, durationDays: 30, maxFreezeDays: 5 });
    const s = await sellSubscription(A.ctx, { clientId, planId: plan.id });
    await setSubscriptionStatus(A.ctx, s.id, { action: "FREEZE" });
    await expect(book({ subscriptionId: s.id, serviceId: facial }, 2)).rejects.toMatchObject({ status: 409 });
    // pretend it was frozen 3 days ago
    await withPlatform((tx) => tx.clientSubscription.update({ where: { id: s.id }, data: { frozenAt: new Date(Date.now() - 3 * 86400000) } }));
    const after = await setSubscriptionStatus(A.ctx, s.id, { action: "UNFREEZE" });
    expect((+after.endDate - +new Date(s.endDate)) / 86400000).toBe(3);
    expect(after.frozenDaysUsed).toBe(3);
    await expect(setSubscriptionStatus(A.ctx, s.id, { action: "CANCEL" })).rejects.toMatchObject({ status: 400 });
  });

  it("plans without freeze allowance can't be frozen", async () => {
    const plan = await createPlan(A.ctx, { name: "No freeze", kind: "TIME", price: 1, durationDays: 10 });
    const s = await sellSubscription(A.ctx, { clientId, planId: plan.id });
    await expect(setSubscriptionStatus(A.ctx, s.id, { action: "FREEZE" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("surgeries", () => {
  it("books surgeon + OR, blocks clashes, and is managed only from the surgery", async () => {
    const at = slot(8);
    const s = await createSurgery(A.ctx, { clientId, surgeonId: doctor.user.id, roomId: room, surgeryType: "Rhinoplasty", scheduledAt: at, durationMin: 120, price: 2000 });
    expect(s.appointmentId).toBeTruthy();
    // surgeon is busy
    await expect(createAppointment(A.ctx, { clientId, staffId: doctor.user.id, startsAt: new Date(+at + 30 * 60000), durationMin: 30 })).rejects.toMatchObject({ status: 409 });
    // operating room is busy
    await expect(createSurgery(A.ctx, { clientId, surgeonId: A.admin.id, roomId: room, surgeryType: "Other", scheduledAt: new Date(+at + 60 * 60000), durationMin: 60 }))
      .rejects.toMatchObject({ status: 409 });
    // calendar can't change it
    await expect(setAppointmentStatus(A.ctx, s.appointmentId!, { status: "CANCELLED", reason: "x" })).rejects.toMatchObject({ status: 409 });
    await expect(setSurgeryStatus(A.ctx, s.id, { action: "START" })).rejects.toMatchObject({ status: 409 }); // future
    await setSurgeryStatus(A.ctx, s.id, { action: "CANCEL", reason: "patient unwell" });
    const appt = await withPlatform((tx) => tx.appointment.findUniqueOrThrow({ where: { id: s.appointmentId! } }));
    expect(appt.status).toBe("CANCELLED");
  });

  it("completion schedules post-op reviews; clinical notes hidden and never audited", async () => {
    const s = await createSurgery(doctor, { clientId, surgeonId: doctor.user.id, surgeryType: "Lipo", scheduledAt: slot(-1), durationMin: 60, price: 1000, preOpNotes: "fasting ok — PRIVATE" });
    await setSurgeryStatus(doctor, s.id, { action: "START" });
    await setSurgeryStatus(doctor, s.id, { action: "COMPLETE", followUpDays: [7] });
    const g = await getSurgery(doctor, s.id);
    expect(g.status).toBe("COMPLETED");
    expect(g.reviews.length).toBe(1);
    expect(g.preOpNotes).toContain("PRIVATE");

    const viewerRole = await createRole(A.ctx, { key: `sviewer${n++}`, name: "Viewer", nameAr: "مشاهد", permissions: ["surgeries.view", "reviews.view"] });
    const viewer = await makeUserWithRole(A.tenant.id, viewerRole.key);
    await withPlatform((tx) => tx.user.update({ where: { id: viewer.user.id }, data: { allBranches: true } }));
    const vctx = (await loadContext(viewer.user.id, null))!;
    expect((await getSurgery(vctx, s.id)).preOpNotes).toBeNull();
    expect(JSON.stringify((await listAudit(A.ctx, { take: 200 })).items)).not.toContain("PRIVATE");
  });
});

describe("medical reviews", () => {
  it("completing a review records findings and schedules the next one in the chain", async () => {
    const r = await createReview(doctor, { clientId, doctorId: doctor.user.id, reason: "Check", scheduledAt: slot(-1) });
    const done = await completeReview(doctor, r.id, { diagnosis: "healing — CONFIDENTIAL", outcome: "IMPROVED", nextReviewAt: slot(14) });
    expect(done.status).toBe("COMPLETED");
    expect(done.nextReview?.previousReviewId).toBe(r.id);
    const up = await listReviews(doctor, { scope: "upcoming", clientId });
    expect(up.some((x) => x.id === done.nextReview!.id)).toBe(true);
    await expect(completeReview(doctor, done.nextReview!.id, {})).rejects.toMatchObject({ status: 409 }); // future
  });

  it("users without medical access see the review but not the diagnosis", async () => {
    const role = await createRole(A.ctx, { key: `rviewer${n++}`, name: "Reviews viewer", nameAr: "مراجعات", permissions: ["reviews.view"] });
    const u = await makeUserWithRole(A.tenant.id, role.key);
    await withPlatform((tx) => tx.user.update({ where: { id: u.user.id }, data: { allBranches: true } }));
    const ctx = (await loadContext(u.user.id, null))!;
    const all = await listReviews(ctx, { clientId });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((x) => x.diagnosis === null)).toBe(true);
  });
});

describe("isolation", () => {
  it("another tenant gets 404 for programs, subscriptions, surgeries and reviews", async () => {
    const p = await assignProgram(A.ctx, { clientId, name: "Iso", price: 1, items: [{ serviceId: laser, sessions: 1 }] });
    const plan = await createPlan(A.ctx, { name: "Iso", kind: "TIME", price: 1, durationDays: 5 });
    const s = await sellSubscription(A.ctx, { clientId, planId: plan.id });
    const sg = await createSurgery(A.ctx, { clientId, surgeonId: doctor.user.id, surgeryType: "Iso", scheduledAt: slot(20), durationMin: 30 });
    const r = await createReview(A.ctx, { clientId, doctorId: doctor.user.id, reason: "Iso", scheduledAt: slot(21) });
    await expect(getProgram(B.ctx, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(getSubscription(B.ctx, s.id)).rejects.toMatchObject({ status: 404 });
    await expect(getSurgery(B.ctx, sg.id)).rejects.toMatchObject({ status: 404 });
    await expect(getReview(B.ctx, r.id)).rejects.toMatchObject({ status: 404 });
    await expect(setSurgeryStatus(B.ctx, sg.id, { action: "CANCEL", reason: "x" })).rejects.toMatchObject({ status: 404 });
    // B can't book A's program session / subscription
    const bClient = await createClient(B.ctx, { fullName: "B client", phone: "0790 000 0001" });
    await expect(createAppointment(B.ctx, { clientId: bClient.id, programItemId: p.items[0].id, startsAt: slot(22) })).rejects.toMatchObject({ status: 400 });
    await expect(createAppointment(B.ctx, { clientId: bClient.id, subscriptionId: s.id, startsAt: slot(22) })).rejects.toMatchObject({ status: 400 });
  });

  it("DB trigger rejects cross-tenant references on new tables", async () => {
    const bClient = await createClient(B.ctx, { fullName: "B2", phone: "0790 000 0002" });
    await expect(withTenant(A.tenant.id, (tx) =>
      tx.medicalReview.create({ data: { tenantId: A.tenant.id, clientId: bClient.id, branchId, reasonType: "OTHER", reason: "x", scheduledAt: new Date() } }),
    )).rejects.toThrow();
    await expect(withTenant(A.tenant.id, (tx) =>
      tx.clientSubscription.create({ data: { tenantId: A.tenant.id, code: "X", clientId: bClient.id, branchId, name: "x", kind: "TIME", startDate: new Date(), endDate: new Date() } }),
    )).rejects.toThrow();
  });
});

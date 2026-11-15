/**
 * Phase 2: clients, medical records, files, catalog, appointments.
 * Isolation (RLS + cross-tenant FK triggers), business rules and permissions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withPlatform, withTenant } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { createClient, getClient, listClients, mergeClients, updateClient, deleteClient, importClients } from "@/server/services/clients";
import { addMedicalEntry, getMedical, saveMedicalRecord } from "@/server/services/medical";
import { downloadFile, uploadFile, listFiles } from "@/server/services/files";
import { createCategory, createRoom, createService, deleteCategory, updateCategory } from "@/server/services/catalog";
import { createAppointment, listAppointments, setAppointmentStatus, updateAppointment } from "@/server/services/appointments";
import { getDashboard } from "@/server/services/dashboard";
import { listAudit } from "@/server/services/organization";
import { createBranch } from "@/server/services/branches";
import { makePlan, makeTenant, makeUserWithRole } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T, B: T;
let aBranch: string, bBranch: string;
let aService: string, aRoom: string, aClient: string, bClient: string;
let aDoctor: Ctx;

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const at = (h: number, dayOffset = 2) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + dayOffset); d.setUTCHours(h, 0, 0, 0); return d;
};

beforeAll(async () => {
  const plan = await makePlan({ maxUsers: 50, maxBranches: 5 });
  A = await makeTenant(plan.id);
  B = await makeTenant(plan.id);
  A.ctx = (await loadContext(A.admin.id, null))!;
  aBranch = (await withPlatform((tx) => tx.branch.findFirstOrThrow({ where: { tenantId: A.tenant.id } }))).id;
  bBranch = (await withPlatform((tx) => tx.branch.findFirstOrThrow({ where: { tenantId: B.tenant.id } }))).id;
  aDoctor = await makeUserWithRole(A.tenant.id, "doctor");
  await withPlatform((tx) => tx.user.update({ where: { id: aDoctor.user.id }, data: { allBranches: true } }));
  aDoctor = (await loadContext(aDoctor.user.id, null))!;
  aService = (await createService(A.ctx, { name: "Laser", price: 100, durationMin: 60, kind: "LASER" })).id;
  aRoom = (await createRoom(A.ctx, { branchId: aBranch, name: "Room 1" })).id;
  aClient = (await createClient(A.ctx, { fullName: "Client A", phone: "0770 111 2222" })).id;
  bClient = (await createClient(B.ctx, { fullName: "Client B", phone: "0770 333 4444" })).id;
});
afterAll(disconnectAll);

describe("isolation", () => {
  it("clients of another tenant are invisible", async () => {
    expect((await listClients(A.ctx)).items.map((c) => c.id)).not.toContain(bClient);
    await expect(getClient(A.ctx, bClient)).rejects.toMatchObject({ status: 404 });
    await expect(updateClient(A.ctx, bClient, { fullName: "hacked" })).rejects.toMatchObject({ status: 404 });
    await expect(getMedical(A.ctx, bClient)).rejects.toMatchObject({ status: 404 });
  });

  it("cannot book another tenant's client, service, room or staff", async () => {
    await expect(createAppointment(A.ctx, { clientId: bClient, startsAt: at(9) })).rejects.toMatchObject({ status: 400 });
    await expect(createAppointment(A.ctx, { clientId: aClient, serviceId: (await createService(B.ctx, { name: "S", price: 1, durationMin: 30 })).id, startsAt: at(9) }))
      .rejects.toMatchObject({ status: 400 });
  });

  it("DB triggers reject cross-tenant references even when app checks are bypassed", async () => {
    // Raw write inside tenant A pointing at tenant B's client
    await expect(withTenant(A.tenant.id, (tx) =>
      tx.appointment.create({ data: { tenantId: A.tenant.id, branchId: aBranch, clientId: bClient, startsAt: at(9), endsAt: at(10) } }),
    )).rejects.toThrow(/cross-tenant|violates/);
    await expect(withTenant(A.tenant.id, (tx) =>
      tx.clientInteraction.create({ data: { tenantId: A.tenant.id, clientId: bClient, type: "NOTE", content: "x" } }),
    )).rejects.toThrow();
    await expect(withTenant(A.tenant.id, (tx) =>
      tx.client.create({ data: { tenantId: A.tenant.id, code: "X-1", fullName: "x", phone: "1", phoneNormalized: "999999991", branchId: bBranch } }),
    )).rejects.toThrow();
  });

  it("appointments list only shows own tenant", async () => {
    await createAppointment(B.ctx, { clientId: bClient, startsAt: at(9, 3) });
    const list = await listAppointments(A.ctx, { from: at(0, 0).toISOString(), to: at(23, 10).toISOString() });
    expect(list.every((a) => a.tenantId === A.tenant.id)).toBe(true);
  });
});

describe("clients", () => {
  it("blocks duplicates by phone regardless of format", async () => {
    await expect(createClient(A.ctx, { fullName: "Dup", phone: "+964 770 111 2222" })).rejects.toMatchObject({ status: 409, code: "DUPLICATE_CLIENT" });
    // Same phone in ANOTHER tenant is fine
    await createClient(B.ctx, { fullName: "Same phone other org", phone: "07701112222" });
  });

  it("generates sequential codes and converts leads", async () => {
    const lead = await createClient(A.ctx, { fullName: "Lead One", phone: "0771 000 0001", status: "LEAD" });
    expect(lead.code).toMatch(/^C-\d{6}$/);
    const conv = await updateClient(A.ctx, lead.id, { status: "ACTIVE" });
    expect(conv.status).toBe("ACTIVE");
    const raw = await withPlatform((tx) => tx.client.findUniqueOrThrow({ where: { id: lead.id } }));
    expect(raw.convertedAt).not.toBeNull();
  });

  it("import skips duplicates and invalid rows", async () => {
    const r = await importClients(A.ctx, [
      { fullName: "Imp 1", phone: "0772 000 0001", tags: "VIP;laser" },
      { fullName: "Imp dup", phone: "0772 000 0001" },
      { fullName: "X", phone: "1" },
    ]);
    expect(r.created).toBe(1);
    expect(r.skipped.length).toBe(2);
  });

  it("merge moves history and soft-deletes the source", async () => {
    const t = await createClient(A.ctx, { fullName: "Target", phone: "0773 000 0001", tags: ["a"] });
    const s = await createClient(A.ctx, { fullName: "Source", phone: "0773 000 0002", tags: ["b"] });
    await createAppointment(A.ctx, { clientId: s.id, startsAt: at(7, 5) });
    const res = await mergeClients(A.ctx, t.id, { sourceId: s.id });
    expect(res.moved.appointments).toBe(1);
    const merged = await getClient(A.ctx, t.id);
    expect(merged.tags.sort()).toEqual(["a", "b"]);
    await expect(getClient(A.ctx, s.id)).rejects.toMatchObject({ status: 404 });
  });

  it("receptionist cannot merge or delete", async () => {
    const rec = await makeUserWithRole(A.tenant.id, "receptionist");
    await expect(mergeClients(rec, aClient, { sourceId: aClient })).rejects.toMatchObject({ status: 403 });
    await expect(deleteClient(rec, aClient)).rejects.toMatchObject({ status: 403 });
  });

  it("branch-restricted users only see clients of their branches", async () => {
    const second = await createBranch(A.ctx, { name: "Second", code: "SEC2" });
    const other = await createClient(A.ctx, { fullName: "Other branch", phone: "0774 000 0001", branchId: second.id });
    const rec = await makeUserWithRole(A.tenant.id, "receptionist");
    await withPlatform((tx) => tx.userBranch.create({ data: { tenantId: A.tenant.id, userId: rec.user.id, branchId: aBranch } }));
    const recCtx = (await loadContext(rec.user.id, null))!;
    const ids = (await listClients(recCtx, { pageSize: 100 })).items.map((c) => c.id);
    expect(ids).toContain(aClient);
    expect(ids).not.toContain(other.id);
    await expect(getClient(recCtx, other.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("medical records", () => {
  it("requires medical.view_data; receptionist is refused", async () => {
    const rec = await makeUserWithRole(A.tenant.id, "receptionist");
    await expect(getMedical(rec, aClient)).rejects.toMatchObject({ status: 403 });
    await saveMedicalRecord(aDoctor, aClient, { allergies: "Penicillin" });
    await addMedicalEntry(aDoctor, aClient, { type: "DIAGNOSIS", title: "Acne", content: "Grade 2" });
    const m = await getMedical(aDoctor, aClient);
    expect(m.record?.allergies).toBe("Penicillin");
    expect(m.entries.length).toBe(1);
  });

  it("audit log never contains medical content, but records access", async () => {
    const log = await listAudit(A.ctx, { take: 200 });
    expect(JSON.stringify(log.items)).not.toContain("Penicillin");
    expect(JSON.stringify(log.items)).not.toContain("Grade 2");
    expect(log.items.some((r) => r.action === "medical.view")).toBe(true);
  });

  it("files: magic-byte check, medical files hidden without permission", async () => {
    await expect(uploadFile(aDoctor, aClient, { category: "MEDICAL_BEFORE", name: "x.png", data: Buffer.from("MZ not an image") }))
      .rejects.toMatchObject({ status: 400 });
    const f = await uploadFile(aDoctor, aClient, { category: "MEDICAL_BEFORE", name: "before.png", data: PNG });
    const r0 = await makeUserWithRole(A.tenant.id, "receptionist");
    await withPlatform((tx) => tx.user.update({ where: { id: r0.user.id }, data: { allBranches: true } }));
    const rec = (await loadContext(r0.user.id, null))!;
    expect((await listFiles(rec, aClient)).length).toBe(0);
    await expect(downloadFile(rec, f.id)).rejects.toMatchObject({ status: 403 });
    await expect(downloadFile(B.ctx, f.id)).rejects.toMatchObject({ status: 404 });
    const dl = await downloadFile(aDoctor, f.id);
    expect(dl.data.equals(PNG)).toBe(true);
  });
});

describe("catalog", () => {
  it("prevents category cycles and deleting non-empty categories", async () => {
    const root = await createCategory(A.ctx, { name: "Root" });
    const child = await createCategory(A.ctx, { name: "Child", parentId: root.id });
    await expect(updateCategory(A.ctx, root.id, { parentId: child.id })).rejects.toMatchObject({ status: 400 });
    await expect(deleteCategory(A.ctx, root.id)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects >100% commission", async () => {
    await expect(createService(A.ctx, { name: "Bad", price: 1, durationMin: 30, execCommission: { type: "PERCENT", value: 150 } })).rejects.toThrow();
  });
});

describe("appointments", () => {
  it("prevents double-booking staff and rooms (app check)", async () => {
    const a1 = await createAppointment(A.ctx, { clientId: aClient, serviceId: aService, staffId: aDoctor.user.id, roomId: aRoom, startsAt: at(10) });
    expect("id" in a1 && Number(a1.price)).toBe(100);
    await expect(createAppointment(A.ctx, { clientId: aClient, staffId: aDoctor.user.id, startsAt: at(10, 2), durationMin: 30 }))
      .rejects.toMatchObject({ status: 409, code: "SLOT_CONFLICT" });
    await expect(createAppointment(A.ctx, { clientId: aClient, roomId: aRoom, startsAt: new Date(+at(10) + 30 * 60000), durationMin: 30 }))
      .rejects.toMatchObject({ status: 409 });
    // back-to-back is fine
    await createAppointment(A.ctx, { clientId: aClient, staffId: aDoctor.user.id, startsAt: at(11), durationMin: 30 });
  });

  it("PostgreSQL exclusion constraint blocks overlaps that bypass the app check", async () => {
    await expect(withTenant(A.tenant.id, (tx) =>
      tx.appointment.create({ data: { tenantId: A.tenant.id, branchId: aBranch, clientId: aClient, staffId: aDoctor.user.id, startsAt: at(10), endsAt: at(11) } }),
    )).rejects.toThrow(/appt_no_staff_overlap/);
  });

  it("cancelled slots can be rebooked; recurring bookings create a series", async () => {
    const x = await createAppointment(A.ctx, { clientId: aClient, staffId: aDoctor.user.id, startsAt: at(13), durationMin: 30 });
    if (!("id" in x)) throw new Error();
    await expect(setAppointmentStatus(A.ctx, x.id, { status: "CANCELLED" })).rejects.toMatchObject({ status: 400 }); // reason required
    await setAppointmentStatus(A.ctx, x.id, { status: "CANCELLED", reason: "client asked" });
    await createAppointment(A.ctx, { clientId: aClient, staffId: aDoctor.user.id, startsAt: at(13), durationMin: 30 });
    const series = await createAppointment(A.ctx, { clientId: aClient, staffId: aDoctor.user.id, startsAt: at(15, 20), durationMin: 30, repeat: { frequency: "WEEKLY", count: 4 } });
    expect("items" in series && series.items.length).toBe(4);
  });

  it("completing a visit updates the client and status workflow is enforced", async () => {
    const lead = await createClient(A.ctx, { fullName: "Lead to visit", phone: "0775 000 0001", status: "LEAD" });
    const ap = await createAppointment(A.ctx, { clientId: lead.id, startsAt: at(8, -1), durationMin: 30 });
    if (!("id" in ap)) throw new Error();
    await setAppointmentStatus(A.ctx, ap.id, { status: "COMPLETED" });
    const c = await getClient(A.ctx, lead.id);
    expect(c.status).toBe("ACTIVE");
    expect(c.lastVisitAt).not.toBeNull();
    await expect(setAppointmentStatus(A.ctx, ap.id, { status: "SCHEDULED" })).rejects.toMatchObject({ status: 409 });
    await expect(updateAppointment(A.ctx, ap.id, { startsAt: at(9, -1) })).rejects.toMatchObject({ status: 409 });
  });

  it("future appointments can't be checked in, completed or marked no-show", async () => {
    const ap = await createAppointment(A.ctx, { clientId: aClient, startsAt: at(9, 9), durationMin: 30 });
    if (!("id" in ap)) throw new Error();
    await expect(setAppointmentStatus(A.ctx, ap.id, { status: "COMPLETED" })).rejects.toMatchObject({ status: 409 });
    await expect(setAppointmentStatus(A.ctx, ap.id, { status: "CHECKED_IN" })).rejects.toMatchObject({ status: 409 });
    await expect(setAppointmentStatus(A.ctx, ap.id, { status: "NO_SHOW" })).rejects.toMatchObject({ status: 409 });
    await setAppointmentStatus(A.ctx, ap.id, { status: "CONFIRMED" });
  });

  it("unqualified staff cannot be booked for a restricted service", async () => {
    const nurse = await makeUserWithRole(A.tenant.id, "nurse");
    await withPlatform((tx) => tx.user.update({ where: { id: nurse.user.id }, data: { allBranches: true } }));
    const svc = await createService(A.ctx, { name: "Botox", price: 300, durationMin: 30, staffIds: [aDoctor.user.id] });
    await expect(createAppointment(A.ctx, { clientId: aClient, serviceId: svc.id, staffId: nurse.user.id, startsAt: at(16, 4) }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe("dashboard", () => {
  it("returns KPIs scoped to the tenant and hides money without finance permission", async () => {
    const from = new Date(Date.now() - 30 * 86400000).toISOString(), to = new Date(Date.now() + 30 * 86400000).toISOString();
    const d = await getDashboard(A.ctx, { from, to, granularity: "day" });
    expect(d.kpis.clientsTotal).toBeGreaterThan(0);
    expect(d.finance).toBe(true);
    const doc = await getDashboard(aDoctor, { from, to });
    expect(doc.kpis.completedValue).toBeNull();
    const b = await getDashboard(B.ctx, { from, to });
    expect(b.kpis.clientsTotal).toBeLessThan(d.kpis.clientsTotal!);
  });
});

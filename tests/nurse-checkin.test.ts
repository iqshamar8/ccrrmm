/** Nurses receive patients: they may check a patient in, nothing else on a booking. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withPlatform } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { createClient } from "@/server/services/clients";
import { createAppointment, setAppointmentStatus, updateAppointment } from "@/server/services/appointments";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { makePlan, makeTenant, makeUserWithRole } from "./helpers";

let admin: Ctx, nurse: Ctx, clientId: string;
const soon = (min: number) => new Date(Date.now() + min * 60000);

beforeAll(async () => {
  const plan = await makePlan();
  const t = await makeTenant(plan.id);
  admin = t.ctx;
  nurse = await makeUserWithRole(t.tenant.id, "nurse");
  await withPlatform((tx) => tx.user.update({ where: { id: nurse.user.id }, data: { allBranches: true } }));
  nurse = (await loadContext(nurse.user.id, null))!;
  clientId = (await createClient(admin, { fullName: "Walk in", phone: "0791 000 0009" })).id;
});
afterAll(disconnectAll);

describe("nurse check-in", () => {
  it("the default nurse role has check-in but not full appointment editing", () => {
    const role = DEFAULT_ROLES.find((r) => r.key === "nurse")!;
    expect(role.permissions).toContain("appointments.checkin");
    expect(role.permissions).not.toContain("appointments.update");
  });

  it("checks a patient in, and can't do anything else to the booking", async () => {
    const a = await createAppointment(admin, { clientId, startsAt: soon(20), durationMin: 30 }) as unknown as { id: string };
    await expect(setAppointmentStatus(nurse, a.id, { status: "CONFIRMED" })).rejects.toMatchObject({ status: 403 });
    await expect(setAppointmentStatus(nurse, a.id, { status: "CANCELLED", reason: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(updateAppointment(nurse, a.id, { startsAt: soon(120) })).rejects.toMatchObject({ status: 403 });
    const r = await setAppointmentStatus(nurse, a.id, { status: "CHECKED_IN" });
    expect(r.status).toBe("CHECKED_IN");
    await expect(setAppointmentStatus(nurse, a.id, { status: "COMPLETED" })).rejects.toMatchObject({ status: 403 });
    await expect(setAppointmentStatus(nurse, a.id, { status: "NO_SHOW" })).rejects.toMatchObject({ status: 403 });
  });
});

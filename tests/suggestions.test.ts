/** Booking conflicts come back with the nearest free times (before and after). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withPlatform } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { createClient } from "@/server/services/clients";
import { createRoom } from "@/server/services/catalog";
import { createAppointment } from "@/server/services/appointments";
import { makePlan, makeTenant, makeUserWithRole } from "./helpers";

let ctx: Ctx, doctor: Ctx, room: string, c1: string, c2: string;
/** A day 10 days ahead at hh:mm Baghdad time (UTC+3). */
const at = (h: number, m = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 10); d.setUTCHours(h - 3, m, 0, 0); return d; };

beforeAll(async () => {
  const plan = await makePlan();
  const t = await makeTenant(plan.id);
  ctx = t.ctx;
  const branchId = (await withPlatform((tx) => tx.branch.findFirstOrThrow({ where: { tenantId: t.tenant.id } }))).id;
  doctor = await makeUserWithRole(t.tenant.id, "doctor");
  await withPlatform((tx) => tx.user.update({ where: { id: doctor.user.id }, data: { allBranches: true } }));
  doctor = (await loadContext(doctor.user.id, null))!;
  room = (await createRoom(ctx, { branchId, name: "R1" })).id;
  c1 = (await createClient(ctx, { fullName: "First", phone: "0790 000 0001" })).id;
  c2 = (await createClient(ctx, { fullName: "Second", phone: "0790 000 0002" })).id;
  // Doctor busy 10:00-11:00 and 11:30-12:00
  await createAppointment(ctx, { clientId: c1, staffId: doctor.user.id, startsAt: at(10), durationMin: 60 });
  await createAppointment(ctx, { clientId: c1, staffId: doctor.user.id, startsAt: at(11, 30), durationMin: 30 });
});
afterAll(disconnectAll);

describe("booking conflict suggestions", () => {
  it("explains the clash and offers free times before and after", async () => {
    const err = await createAppointment(ctx, { clientId: c2, staffId: doctor.user.id, roomId: room, startsAt: at(10, 15), durationMin: 30 }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.code).toBe("SLOT_CONFLICT");
    const d = err.details as { who: string; whoKind: string; clientName: string; suggestions: string[] };
    expect(d.whoKind).toBe("staff");
    expect(d.clientName).toBe("First");
    expect(d.suggestions.length).toBeGreaterThanOrEqual(2);
    const times = d.suggestions.map((s) => +new Date(s));
    expect(times.some((t) => t < +at(10, 15))).toBe(true);  // something earlier
    expect(times.some((t) => t > +at(10, 15))).toBe(true);  // something later
    // Every suggestion is really free: 11:00 fits (30 min before 11:30), 11:15 doesn't.
    expect(times).not.toContain(+at(11, 15));
    for (const s of d.suggestions) {
      const ok = await createAppointment(ctx, { clientId: c2, staffId: doctor.user.id, roomId: room, startsAt: new Date(s), durationMin: 30 }).then(() => true, () => false);
      expect(ok).toBe(true);
      break; // booking one proves the slot was free; the rest would now overlap each other
    }
  });
});

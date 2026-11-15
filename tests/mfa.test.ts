import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as session from "@/server/services/session";
import { totpAt } from "@/server/totp";
import { makePlan, makeTenant, PW } from "./helpers";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
let t: Awaited<ReturnType<typeof makeTenant>>;
let secret: string;
let recovery: string[];

beforeAll(async () => {
  const plan = await makePlan();
  t = await makeTenant(plan.id);
});

afterAll(async () => {
  const { disconnectAll } = await import("@/server/db");
  await disconnectAll();
});

describe("two-factor sign-in (TOTP)", () => {
  it("enrols only after a valid code and returns recovery codes once", async () => {
    const s = await session.startTotp(t.ctx);
    secret = s.secret;
    expect(s.uri).toContain("otpauth://totp/");
    await expect(session.enableTotp(t.ctx, { code: "000000" === totpAt(secret) ? "111111" : "000000" })).rejects.toThrow();
    const r = await session.enableTotp(t.ctx, { code: totpAt(secret) });
    recovery = r.recoveryCodes;
    expect(recovery).toHaveLength(8);
    await expect(session.startTotp(t.ctx)).rejects.toThrow(/already/);
    const o = await session.securityOverview(t.ctx);
    expect(o.mfaEnabled).toBe(true);
    expect(o.recoveryCodesLeft).toBe(8);
  });

  it("password login now returns an MFA challenge, not a session", async () => {
    const r = await session.login({ email: t.admin.email, password: PW }, meta);
    expect(r.mfaToken).toBeTruthy();
    expect(r.token).toBeUndefined();
  });

  it("rejects a wrong code and a forged challenge, accepts a valid code", async () => {
    const { mfaToken } = await session.login({ email: t.admin.email, password: PW }, meta);
    const wrong = totpAt(secret) === "123456" ? "654321" : "123456";
    await expect(session.verifyMfa({ mfaToken, code: wrong }, meta)).rejects.toThrow(/Invalid/);
    await expect(session.verifyMfa({ mfaToken: "x".repeat(40), code: totpAt(secret) }, meta)).rejects.toThrow();
    const ok = await session.verifyMfa({ mfaToken, code: totpAt(secret) }, meta);
    expect(ok.token).toBeTruthy();
  });

  it("a recovery code works exactly once", async () => {
    const { mfaToken } = await session.login({ email: t.admin.email, password: PW }, meta);
    const ok = await session.verifyMfa({ mfaToken, code: recovery[0].toLowerCase() }, meta);
    expect(ok.token).toBeTruthy();
    expect(ok.recoveryLeft).toBe(7);
    const again = await session.login({ email: t.admin.email, password: PW }, meta);
    await expect(session.verifyMfa({ mfaToken: again.mfaToken, code: recovery[0] }, meta)).rejects.toThrow(/Invalid/);
  });

  it("revoking sessions invalidates outstanding MFA challenges", async () => {
    const { mfaToken } = await session.login({ email: t.admin.email, password: PW }, meta);
    const fresh = await session.logoutEverywhere(t.ctx);
    expect(fresh).toBeTruthy();
    await expect(session.verifyMfa({ mfaToken, code: totpAt(secret) }, meta)).rejects.toThrow();
  });

  it("disabling needs the password, then login is single-step again", async () => {
    await expect(session.disableTotp(t.ctx, { password: "wrong-pass1" })).rejects.toThrow(/incorrect/);
    await session.disableTotp(t.ctx, { password: PW });
    const r = await session.login({ email: t.admin.email, password: PW }, meta);
    expect(r.token).toBeTruthy();
    expect(r.mfaToken).toBeUndefined();
    const o = await session.securityOverview(t.ctx);
    expect(o.mfaEnabled).toBe(false);
    expect(o.events.some((e) => e.action === "auth.mfa.enable")).toBe(true);
  });
});

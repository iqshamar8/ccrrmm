import { z } from "zod";
import { hashPassword, passwordProblem, readMfaChallenge, signMfaChallenge, signSession, verifyPassword } from "../auth";
import { decryptSecret, encryptSecret } from "../crypto";
import { rateLimit } from "../ratelimit";
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from "../totp";
import { audit } from "../audit";
import type { Ctx } from "../context";
import { type Tx, withPlatform, withTenant } from "../db";
import { AppError, badRequest } from "../errors";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(1).max(128),
});

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
// Pre-computed hash so unknown emails take the same time as wrong passwords.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("timing-equalizer-not-a-real-password"));

export async function login(raw: unknown, meta: { ip: string | null; userAgent: string | null }) {
  const { email, password } = loginSchema.parse(raw);
  const invalid = new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");

  // The transaction RETURNS an outcome instead of throwing, so the failed-login
  // counter and audit row are committed (a throw would roll them back).
  const outcome = await withPlatform(async (tx) => {
    const user = await tx.user.findUnique({ where: { email }, include: { tenant: true } });
    if (!user) {
      await verifyPassword(password, await getDummyHash());
      return { error: invalid };
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return { error: new AppError(429, "LOCKED", `Too many attempts. Try again in ${LOCK_MINUTES} minutes`) };
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const fails = user.failedLogins + 1;
      await tx.user.update({
        where: { id: user.id },
        data: fails >= MAX_FAILS
          ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
          : { failedLogins: fails },
      });
      await tx.auditLog.create({
        data: { tenantId: user.tenantId, userId: user.id, userEmail: user.email, action: "auth.login.failed", entity: "User", entityId: user.id, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) },
      });
      return { error: invalid };
    }
    if (user.status !== "ACTIVE") throw new AppError(403, "USER_DISABLED", "This account is disabled");
    if (user.tenant && ["SUSPENDED", "CANCELLED"].includes(user.tenant.status)) {
      throw new AppError(403, "TENANT_SUSPENDED", "Your organization account is suspended. Contact support.");
    }
    // Password OK. With 2FA on, issue a 5-minute challenge instead of a session.
    if (user.totpEnabledAt) {
      await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
      return { mfaToken: await signMfaChallenge(user.id, user.sessionVersion) };
    }
    await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await tx.auditLog.create({
      data: { tenantId: user.tenantId, userId: user.id, userEmail: user.email, action: "auth.login", entity: "User", entityId: user.id, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) },
    });
    return { token: await signSession(user.id, user.sessionVersion), locale: user.locale };
  });
  if ("error" in outcome) throw outcome.error;
  return outcome as { token?: string; locale?: string; mfaToken?: string };
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export async function changePassword(ctx: Ctx, raw: unknown) {
  const { currentPassword, newPassword } = changePasswordSchema.parse(raw);
  const issue = passwordProblem(newPassword);
  if (issue) throw badRequest(issue);
  const hash = await hashPassword(newPassword);

  const run = async (tx: Tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!(await verifyPassword(currentPassword, u.passwordHash))) throw badRequest("Current password is incorrect");
    const updated = await tx.user.update({
      where: { id: u.id }, data: { passwordHash: hash, sessionVersion: { increment: 1 } },
    });
    await audit(tx, ctx, { action: "auth.password.change", entity: "User", entityId: u.id });
    return signSession(updated.id, updated.sessionVersion);
  };
  return ctx.tenant ? withTenant(ctx.tenant.id, run) : withPlatform(run);
}

// ------------------------------------------------------------- 2FA (TOTP) ----

/** Second login step: TOTP code or a one-time recovery code → session token. */
export async function verifyMfa(raw: unknown, meta: { ip: string | null; userAgent: string | null }) {
  const { mfaToken, code } = z.object({ mfaToken: z.string().min(10).max(2000), code: z.string().trim().min(6).max(20) }).parse(raw);
  const claims = await readMfaChallenge(mfaToken);
  if (!claims) throw new AppError(401, "MFA_EXPIRED", "The sign-in step expired — enter your password again");
  await rateLimit(`mfa:${claims.sub}`, 8, 600);
  const outcome = await withPlatform(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: claims.sub }, include: { tenant: true } });
    if (!u || u.sessionVersion !== claims.v || !u.totpEnabledAt || u.status !== "ACTIVE") return { error: new AppError(401, "MFA_EXPIRED", "Sign in again") };
    const secret = decryptSecret(u.totpSecretEnc);
    let usedRecovery = false;
    let ok = !!secret && verifyTotp(secret, code);
    if (!ok) {
      const h = hashRecoveryCode(code);
      if (u.recoveryCodes.includes(h)) {
        ok = true; usedRecovery = true;
        await tx.user.update({ where: { id: u.id }, data: { recoveryCodes: u.recoveryCodes.filter((x) => x !== h) } });
      }
    }
    const base = { tenantId: u.tenantId, userId: u.id, userEmail: u.email, entity: "User", entityId: u.id, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) };
    if (!ok) { await tx.auditLog.create({ data: { ...base, action: "auth.mfa.failed" } }); return { error: new AppError(401, "MFA_INVALID", "Invalid verification code") }; }
    await tx.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
    await tx.auditLog.create({ data: { ...base, action: usedRecovery ? "auth.login.recovery_code" : "auth.login" } });
    return { token: await signSession(u.id, u.sessionVersion), locale: u.locale, recoveryLeft: usedRecovery ? u.recoveryCodes.length - 1 : undefined };
  });
  if ("error" in outcome) throw outcome.error;
  return outcome;
}

const runFor = <T,>(ctx: Ctx, fn: (tx: Tx) => Promise<T>) => (ctx.tenant ? withTenant(ctx.tenant.id, fn) : withPlatform(fn));

/** Step 1 of enrolment: a new secret (stored encrypted, not active until confirmed). */
export async function startTotp(ctx: Ctx) {
  const u = await runFor(ctx, (tx) => tx.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { totpEnabledAt: true } }));
  if (u.totpEnabledAt) throw badRequest("Two-factor sign-in is already on");
  const secret = newTotpSecret();
  await runFor(ctx, (tx) => tx.user.update({ where: { id: ctx.user.id }, data: { totpSecretEnc: encryptSecret(secret) } }));
  return { secret, uri: otpauthUri(secret, ctx.user.email) };
}

/** Step 2: confirm with a code from the app; returns the recovery codes ONCE. */
export async function enableTotp(ctx: Ctx, raw: unknown) {
  const { code } = z.object({ code: z.string().trim().min(6).max(10) }).parse(raw);
  await rateLimit(`mfa-enrol:${ctx.user.id}`, 10, 600);
  return runFor(ctx, async (tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    const secret = decryptSecret(u.totpSecretEnc);
    if (!secret) throw badRequest("Start the setup again");
    if (!verifyTotp(secret, code)) throw badRequest("The code does not match — check the time on your phone and try again");
    const codes = newRecoveryCodes();
    await tx.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), recoveryCodes: codes.map(hashRecoveryCode) } });
    await audit(tx, ctx, { action: "auth.mfa.enable", entity: "User", entityId: u.id });
    return { recoveryCodes: codes };
  });
}

export async function disableTotp(ctx: Ctx, raw: unknown) {
  const { password } = z.object({ password: z.string().min(1).max(128) }).parse(raw);
  await rateLimit(`pw-check:${ctx.user.id}`, 10, 600);
  return runFor(ctx, async (tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!(await verifyPassword(password, u.passwordHash))) throw badRequest("Password is incorrect");
    await tx.user.update({ where: { id: u.id }, data: { totpEnabledAt: null, totpSecretEnc: null, recoveryCodes: [] } });
    await audit(tx, ctx, { action: "auth.mfa.disable", entity: "User", entityId: u.id });
    return { ok: true };
  });
}

/** Signs out every device (sessionVersion bump) and returns a fresh token for this one. */
export async function logoutEverywhere(ctx: Ctx) {
  return runFor(ctx, async (tx) => {
    const u = await tx.user.update({ where: { id: ctx.user.id }, data: { sessionVersion: { increment: 1 } } });
    await audit(tx, ctx, { action: "auth.sessions.revoke", entity: "User", entityId: u.id });
    return signSession(u.id, u.sessionVersion);
  });
}

export async function securityOverview(ctx: Ctx) {
  return runFor(ctx, async (tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { totpEnabledAt: true, recoveryCodes: true, lastLoginAt: true } });
    const events = await tx.auditLog.findMany({ where: { userId: ctx.user.id, action: { startsWith: "auth." } }, orderBy: { createdAt: "desc" }, take: 20, select: { action: true, ip: true, userAgent: true, createdAt: true } });
    return { mfaEnabled: !!u.totpEnabledAt, mfaEnabledAt: u.totpEnabledAt, recoveryCodesLeft: u.recoveryCodes.length, lastLoginAt: u.lastLoginAt, events: events.map((e) => ({ ...e })) };
  });
}

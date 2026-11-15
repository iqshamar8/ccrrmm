/**
 * Passwords (bcrypt) and stateless session tokens (HS256 JWT in an httpOnly
 * cookie). Each request re-validates the user against the DB (see context.ts),
 * and `sessionVersion` lets us revoke all sessions of a user instantly.
 */
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "medcrm_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(s);
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export type SessionClaims = { sub: string; v: number };

export async function signSession(userId: string, sessionVersion: number) {
  return new SignJWT({ v: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function readSession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    // A pending-2FA token is never a session.
    if (typeof payload.sub !== "string" || typeof payload.v !== "number" || payload.mfa) return null;
    return { sub: payload.sub, v: payload.v };
  } catch {
    return null;
  }
}

/** Password policy: 8+ chars, at least one letter and one digit. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain letters and numbers";
  return null;
}

/** Short-lived token proving the password step passed; exchanged for a session after the 2FA code. */
export async function signMfaChallenge(userId: string, sessionVersion: number) {
  return new SignJWT({ v: sessionVersion, mfa: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret());
}

export async function readMfaChallenge(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.v !== "number" || payload.mfa !== 1) return null;
    return { sub: payload.sub, v: payload.v };
  } catch {
    return null;
  }
}

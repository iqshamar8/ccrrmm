import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/server/auth";
import { checkCsrf, requestMeta, toErrorResponse } from "@/server/api";
import { verifyMfa } from "@/server/services/session";

// Second sign-in step (public): exchanges the 5-minute MFA challenge + a TOTP
// or recovery code for a real session cookie. Rate-limited inside verifyMfa().
export async function POST(req: Request) {
  try {
    checkCsrf(req);
    const meta = await requestMeta();
    const result = await verifyMfa(await req.json(), meta);
    const res = NextResponse.json({ data: { ok: true, recoveryLeft: result.recoveryLeft } });
    res.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SECONDS,
    });
    res.cookies.set("locale", result.locale ?? "ar", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}

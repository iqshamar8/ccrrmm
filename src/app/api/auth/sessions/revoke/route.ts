import { NextResponse } from "next/server";
import { checkCsrf, getCtx, toErrorResponse } from "@/server/api";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/server/auth";
import { unauthorized } from "@/server/errors";
import { logoutEverywhere } from "@/server/services/session";

// Signs out every other device; this browser gets a fresh token.
export async function POST(req: Request) {
  try {
    checkCsrf(req);
    const ctx = await getCtx();
    if (!ctx) throw unauthorized();
    const token = await logoutEverywhere(ctx);
    const res = NextResponse.json({ data: { ok: true } });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}

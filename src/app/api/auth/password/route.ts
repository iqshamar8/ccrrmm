import { NextResponse } from "next/server";
import { getCtx, checkCsrf, toErrorResponse } from "@/server/api";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/server/auth";
import { unauthorized } from "@/server/errors";
import { changePassword } from "@/server/services/session";

export async function POST(req: Request) {
  try {
    checkCsrf(req);
    const ctx = await getCtx();
    if (!ctx) throw unauthorized();
    // Changing the password revokes all other sessions; re-issue ours.
    const token = await changePassword(ctx, await req.json());
    const res = NextResponse.json({ data: { ok: true } });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}

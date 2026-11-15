import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/server/auth";
import { checkCsrf, requestMeta, toErrorResponse } from "@/server/api";
import { login } from "@/server/services/session";

// Small in-memory throttle per IP (per server instance). Account lockout in
// login() is the durable protection; this just blunts bursts.
const hits = new Map<string, { n: number; t: number }>();
function throttle(ip: string | null) {
  const key = ip ?? "unknown";
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > 60000) return void hits.set(key, { n: 1, t: now });
  if (++h.n > 20) throw Object.assign(new Error("throttled"), { throttled: true });
}

export async function POST(req: Request) {
  try {
    checkCsrf(req);
    const meta = await requestMeta();
    try {
      throttle(meta.ip);
    } catch {
      return NextResponse.json({ error: { code: "RATE_LIMIT", message: "Too many requests, slow down" } }, { status: 429 });
    }
    const result = await login(await req.json(), meta);
    if (result.mfaToken) {
      return NextResponse.json({ data: { mfaToken: result.mfaToken } });
    }
    const token = result.token ?? "";
    const locale = result.locale ?? "ar";
    const res = NextResponse.json({ data: { ok: true } });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SECONDS,
    });
    res.cookies.set("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}

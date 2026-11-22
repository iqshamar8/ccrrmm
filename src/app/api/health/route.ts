/**
 * Public health check for deployments. Reports only whether each required
 * setting is present and well-formed, and whether the database answers —
 * never any value, host name or raw error text.
 */
import { NextResponse } from "next/server";
import { withPlatform } from "@/server/db";

export const dynamic = "force-dynamic";

function urlState(v: string | undefined) {
  if (!v) return "missing";
  try {
    const u = new URL(v);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return "invalid";
    if (["localhost", "127.0.0.1", "::1"].includes(u.hostname)) return "localhost";
    return u.searchParams.get("sslmode") ? "ok" : "ok-no-sslmode";
  } catch {
    return "invalid";
  }
}

export async function GET() {
  const env = {
    DATABASE_URL_APP: urlState(process.env.DATABASE_URL_APP),
    DATABASE_URL_PLATFORM: urlState(process.env.DATABASE_URL_PLATFORM),
    SESSION_SECRET: !process.env.SESSION_SECRET ? "missing" : process.env.SESSION_SECRET.length < 32 ? "too-short" : "ok",
    CRON_SECRET: !process.env.CRON_SECRET ? "missing" : process.env.CRON_SECRET.length < 16 ? "too-short" : "ok",
  };

  let db: string;
  try {
    const users = await withPlatform((tx) => tx.user.count(), { timeout: 10000 });
    db = users > 0 ? "ok" : "ok-no-users";
  } catch (e) {
    // Prisma error codes (P1001 unreachable, P1000 auth failed, P2021 missing table…) are safe to show.
    const code = (e as { code?: string; errorCode?: string })?.code ?? (e as { errorCode?: string })?.errorCode;
    db = code ? `error:${code}` : (e instanceof Error && e.message.includes("not configured") ? "error:not-configured" : "error");
  }

  const healthy = db === "ok" && env.SESSION_SECRET === "ok";
  return NextResponse.json({ healthy, env, db }, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

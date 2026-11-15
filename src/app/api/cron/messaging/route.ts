/**
 * Scheduler entry point: automations (reminders, birthdays, follow-ups, staff
 * notifications) + sending, for every active tenant. Call every 1–5 minutes
 * from cron / a scheduler with `Authorization: Bearer $CRON_SECRET`, or set
 * MESSAGING_WORKER=1 to run it in-process (see src/instrumentation.ts).
 */
import { timingSafeEqual } from "node:crypto";
import { runMessagingCycle } from "@/server/services/messaging";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 16) return false;
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const report = await runMessagingCycle();
  return Response.json({ ok: true, at: new Date().toISOString(), report });
}

export const GET = handle;
export const POST = handle;

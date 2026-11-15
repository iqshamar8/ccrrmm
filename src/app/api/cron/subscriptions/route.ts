import { timingSafeEqual } from "node:crypto";
import { runSubscriptionLifecycle } from "@/server/services/subscription-lifecycle";

/** Daily subscription lifecycle: renewal invoices, reminders, dunning, trial expiry. Bearer CRON_SECRET. */
function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 16) return false;
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const report = await runSubscriptionLifecycle();
  return Response.json({ ok: true, report });
}

export const GET = handle;
export const POST = handle;

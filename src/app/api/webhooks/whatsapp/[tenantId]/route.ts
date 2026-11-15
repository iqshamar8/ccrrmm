/**
 * Meta WhatsApp Cloud API webhook (one URL per tenant).
 *   GET  — subscription verification (hub.verify_token must match the tenant's verify token)
 *   POST — delivery statuses & inbound messages; X-Hub-Signature-256 is verified with the tenant's app secret
 * Not session-authenticated (called by Meta), so no CSRF / cookie checks here.
 */
import { isUuid } from "@/server/db";
import { AppError } from "@/server/errors";
import { handleWebhook, verifyWebhook } from "@/server/services/messaging";

type P = { params: Promise<{ tenantId: string }> };

export async function GET(req: Request, { params }: P) {
  const { tenantId } = await params;
  if (!isUuid(tenantId)) return new Response("not found", { status: 404 });
  const u = new URL(req.url).searchParams;
  const challenge = await verifyWebhook(tenantId, u.get("hub.mode"), u.get("hub.verify_token"), u.get("hub.challenge"));
  return challenge ? new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } }) : new Response("forbidden", { status: 403 });
}

export async function POST(req: Request, { params }: P) {
  const { tenantId } = await params;
  if (!isUuid(tenantId)) return new Response("not found", { status: 404 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return new Response("too large", { status: 413 });
  try {
    const r = await handleWebhook(tenantId, raw, req.headers.get("x-hub-signature-256"));
    return Response.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    console.error("[whatsapp webhook]", e);
    return new Response("error", { status: 500 });
  }
}

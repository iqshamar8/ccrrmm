/**
 * Route handler wrapper used by every /api route:
 *  - resolves the session -> Ctx (401 if missing)
 *  - CSRF: mutating requests must be JSON and come from our own Origin
 *  - maps Zod / Prisma / AppError to clean JSON error responses
 */
import { Prisma } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { readSession, SESSION_COOKIE } from "./auth";
import { type Ctx, loadContext } from "./context";
import { AppError, unauthorized } from "./errors";

export async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}

/** Current user context, or null if not signed in. Used by pages and routes. */
export async function getCtx(): Promise<Ctx | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = await readSession(token);
  if (!claims) return null;
  return loadContext(claims.sub, claims.v, await requestMeta());
}

function checkCsrf(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const ct = req.headers.get("content-type") ?? "";
  if (req.method !== "DELETE" && !ct.includes("application/json") && !ct.includes("multipart/form-data")) {
    throw new AppError(415, "UNSUPPORTED_MEDIA", "Expected application/json");
  }
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) throw new AppError(403, "BAD_ORIGIN", "Cross-site request blocked");
}

export function toErrorResponse(e: unknown) {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const fields = Object.fromEntries(e.issues.map((i) => [i.path.join("."), i.message]));
    return NextResponse.json({ error: { code: "VALIDATION", message: "Please correct the highlighted fields", fields } }, { status: 422 });
  }
  // Database-level guards (exclusion constraints, cross-tenant triggers, partial unique index)
  const msg = e instanceof Error ? e.message : "";
  if (/appt_no_(staff|room)_overlap/.test(msg)) {
    return NextResponse.json({ error: { code: "SLOT_CONFLICT", message: "This time slot is already booked for the selected staff member or room" } }, { status: 409 });
  }
  if (msg.includes("client_phone_unique")) {
    return NextResponse.json({ error: { code: "DUPLICATE_CLIENT", message: "A client with this phone already exists" } }, { status: 409 });
  }
  if (msg.includes("cross-tenant reference")) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Referenced record not found" } }, { status: 404 });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined)?.join(", ") ?? "field";
      return NextResponse.json({ error: { code: "DUPLICATE", message: `A record with this ${target} already exists` } }, { status: 409 });
    }
    if (e.code === "P2025") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    if (e.code === "P2003") return NextResponse.json({ error: { code: "IN_USE", message: "Record is referenced by other data" } }, { status: 409 });
  }
  console.error("[api] unhandled error", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Unexpected server error" } }, { status: 500 });
}

type Handler<P> = (a: { ctx: Ctx; req: Request; params: P; body: unknown; search: URLSearchParams }) => Promise<unknown>;

export function route<P = Record<string, string>>(handler: Handler<P>, opts: { public?: false } = {}) {
  void opts;
  return async (req: Request, info: { params: Promise<P> }) => {
    try {
      checkCsrf(req);
      const ctx = await getCtx();
      if (!ctx) throw unauthorized();
      const multipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
      const body = req.method === "GET" || req.method === "DELETE" || multipart ? undefined : await req.json().catch(() => {
        throw new AppError(400, "BAD_JSON", "Malformed JSON body");
      });
      const params = (await info?.params) ?? ({} as P);
      const result = await handler({ ctx, req, params, body, search: new URL(req.url).searchParams });
      return NextResponse.json({ data: result ?? null });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

/** Like route() but the handler returns its own Response (CSV, file download, multipart input). */
export function rawRoute<P = Record<string, string>>(
  handler: (a: { ctx: Ctx; req: Request; params: P; search: URLSearchParams }) => Promise<Response>,
) {
  return async (req: Request, info: { params: Promise<P> }) => {
    try {
      checkCsrf(req);
      const ctx = await getCtx();
      if (!ctx) throw unauthorized();
      return await handler({ ctx, req, params: (await info?.params) ?? ({} as P), search: new URL(req.url).searchParams });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

export { checkCsrf };

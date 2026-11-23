"use client";
import { arabicError, pageIsArabic } from "./error-ar";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>, public details?: Record<string, unknown>) {
    super(message);
  }
}

/** Server messages are English; show them in Arabic on Arabic pages. */
function apiError(status: number, e: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> }, fallback: string) {
  const ar = pageIsArabic();
  const tr = (m: string) => (ar ? arabicError(m) : m);
  const fields = e.fields ? Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, tr(String(v))])) : undefined;
  return new ApiError(status, e.code ?? "ERROR", tr(e.message ?? fallback), fields, e.details);
}

async function send(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, credentials: "same-origin" });
  } catch {
    // offline / dropped connection: a clear message instead of "Failed to fetch"
    throw new ApiError(0, "NETWORK", pageIsArabic() ? "تعذّر الاتصال بالخادم، تحقق من الإنترنت وحاول مجدداً" : "Can't reach the server — check the connection and try again");
  }
}

/** fetch wrapper for our JSON API: returns `data` or throws ApiError. */
export async function api<T = unknown>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await send(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.includes("/auth/login") && !url.includes("/auth/mfa/verify")) window.location.href = "/login";
    throw apiError(res.status, json.error ?? {}, res.statusText);
  }
  return json.data as T;
}

/** multipart upload to our API */
export async function upload<T = unknown>(url: string, form: FormData): Promise<T> {
  const res = await send(url, { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(res.status, json.error ?? {}, res.statusText);
  return json.data as T;
}

export function setPref(name: "locale" | "theme", value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>, public details?: Record<string, unknown>) {
    super(message);
  }
}

/** fetch wrapper for our JSON API: returns `data` or throws ApiError. */
export async function api<T = unknown>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.includes("/auth/login") && !url.includes("/auth/mfa/verify")) window.location.href = "/login";
    const e = json.error ?? {};
    throw new ApiError(res.status, e.code ?? "ERROR", e.message ?? res.statusText, e.fields, e.details);
  }
  return json.data as T;
}

/** multipart upload to our API */
export async function upload<T = unknown>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error?.code ?? "ERROR", json.error?.message ?? res.statusText);
  return json.data as T;
}

export function setPref(name: "locale" | "theme", value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

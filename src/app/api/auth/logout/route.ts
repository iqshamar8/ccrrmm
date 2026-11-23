import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";

/**
 * Sign out. Works two ways:
 *  - a plain <form method="post"> (the app's buttons): clears the cookie and
 *    redirects to /login with 303, so it works on every phone browser and
 *    even if a script fails;
 *  - fetch with JSON (older callers): clears the cookie and returns { ok }.
 * The cookie is cleared with the SAME attributes it was set with; some
 * mobile browsers keep a Secure/SameSite cookie when a mismatched one is sent.
 */
export async function POST(req: Request) {
  // Ignore cross-site posts (another site can't sign people out).
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const crossSite = !!(origin && host && origin !== "null" && new URL(origin).host !== host);

  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const res = isJson
    ? NextResponse.json({ data: { ok: true } })
    : NextResponse.redirect(new URL("/login", req.url), 303);
  if (crossSite) return res;

  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

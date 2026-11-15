import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";

export async function POST() {
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  // Shared clinic PCs: wipe anything the previous user's session left in the HTTP cache.
  res.headers.set("Clear-Site-Data", '"cache"');
  return res;
}

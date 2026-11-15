import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Edge gate for pages only: redirect to /login when there's no valid token.
// Real authorization (user status, tenant, permissions) happens server-side
// in every page/route via getCtx().
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("medcrm_session")?.value;
  let ok = false;
  if (token && process.env.SESSION_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET), { algorithms: ["HS256"] });
      ok = true;
    } catch {}
  }
  const isLogin = req.nextUrl.pathname === "/login";
  if (!ok && !isLogin) return NextResponse.redirect(new URL("/login", req.url));
  if (ok && isLogin) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api|_next|favicon.ico).*)"] };

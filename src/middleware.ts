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
  const path = req.nextUrl.pathname;
  const isLogin = path === "/login";
  const isLanding = path === "/welcome";
  // Signed-out visitors see the public landing page at "/" (URL stays "/");
  // signed-in users get their dashboard there.
  if (!ok && path === "/") return NextResponse.rewrite(new URL("/welcome", req.url));
  if (!ok && !isLogin && !isLanding) return NextResponse.redirect(new URL("/login", req.url));
  if (ok && (isLogin || isLanding)) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api|_next|favicon.ico|icon.svg|apple-icon.png|brand/).*)"] };

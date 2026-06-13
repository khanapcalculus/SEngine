/**
 * Edge middleware — first line of defense for /dashboard/* (Guideline #4).
 *
 * Verifies the session JWT at the edge BEFORE any dashboard page renders:
 *  - no/invalid/expired cookie  -> redirect to /login
 *  - valid cookie, wrong role for the path -> redirect to /dashboard (their home)
 *
 * This is defense-in-depth on top of the client <RoleGuard> (which renders the
 * 403 UI) and the API `requireRole` guards (the real enforcement). It uses only
 * edge-safe modules: `jwt.ts` (WebCrypto) and `rbac.ts` (pure) — never the
 * drizzle-backed `lib/auth.ts`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { verifyJwt, JwtVerifyError } from "./lib/jwt";
import { canAccess, navItemForPath } from "./lib/rbac";

// Mirrors SESSION_COOKIE in lib/auth.ts (inlined to keep drizzle out of edge).
const SESSION_COOKIE = "sengine_session";

export const config = { matcher: ["/dashboard/:path*"] };

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const loginUrl = new URL("/login", req.url);
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.redirect(loginUrl);

  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 16) return NextResponse.redirect(loginUrl);

  try {
    const claims = await verifyJwt(token, secret, {
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    const nav = navItemForPath(req.nextUrl.pathname);
    if (nav && !canAccess(claims.role, nav.allowedRoles)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  } catch (err) {
    // Any verification failure (incl. JwtVerifyError) → treat as unauthenticated.
    void (err instanceof JwtVerifyError);
    return NextResponse.redirect(loginUrl);
  }
}

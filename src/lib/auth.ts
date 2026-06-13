/**
 * RBAC primitives shared by all API routes (Guideline #4: Security First).
 *
 * In production the AuthContext is derived from a verified session/JWT at the
 * edge. Routes receive it via `getAuthContext(req)`; tests inject a fake one.
 * Either way, route logic NEVER trusts client-supplied role/identity fields.
 */
import type { userRoleEnum } from "../db/schema";
import { verifyJwt, JwtVerifyError } from "./jwt";

export type Role = (typeof userRoleEnum.enumValues)[number];

export interface AuthContext {
  userId: string;
  role: Role;
  /** Org the caller belongs to; null for network-spanning super_admin. */
  orgId: string | null;
  /** Branch the caller is assigned to; null for org/network-level roles. */
  branchId: string | null;
}

/** Thrown when authn/authz fails; carries the HTTP status to emit. */
export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Name of the httpOnly session cookie. */
export const SESSION_COOKIE = "sengine_session";

/** Pull the bearer token from Authorization header, falling back to cookie. */
export function extractToken(req: Request): string | null {
  const authz = req.headers.get("authorization");
  if (authz) {
    const m = /^Bearer\s+(.+)$/i.exec(authz.trim());
    if (m) return m[1];
  }
  const cookie = req.headers.get("cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === SESSION_COOKIE) return v.join("=");
    }
  }
  return null;
}

/** Resolve the JWT signing secret from the Worker environment. */
function getAuthSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 16) {
    // Fail closed: a missing/weak secret must never produce valid auth.
    throw new AuthError(401, "Auth not configured");
  }
  return secret;
}

/**
 * Resolve the authenticated caller by verifying the request's JWT.
 * Reads from the Authorization: Bearer header or the session cookie, verifies
 * the HS256 signature + expiry, and builds the AuthContext the RBAC guards use.
 *
 * @throws AuthError(401) when no valid token is present.
 */
export async function getAuthContext(req: Request): Promise<AuthContext> {
  const token = extractToken(req);
  if (!token) throw new AuthError(401, "Missing authentication token");

  const secret = getAuthSecret();
  const nowSeconds = Math.floor(Date.now() / 1000);

  try {
    const claims = await verifyJwt(token, secret, { nowSeconds });
    return {
      userId: claims.sub,
      role: claims.role,
      orgId: claims.orgId,
      branchId: claims.branchId,
    };
  } catch (err) {
    if (err instanceof JwtVerifyError) {
      throw new AuthError(401, `Invalid token: ${err.reason}`);
    }
    throw new AuthError(401, "Invalid token");
  }
}

/**
 * Assert the caller holds one of the allowed roles.
 * @throws AuthError(403) if the role is not permitted.
 */
export function requireRole(ctx: AuthContext, allowed: Role[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new AuthError(403, "Insufficient role for this operation");
  }
}

/**
 * Branch-manager tenant guard: a branch_manager may only act within their own
 * org. super_admin is unrestricted. Other roles never reach here (role gate
 * runs first), but we fail closed regardless.
 */
export function assertBranchScope(
  ctx: AuthContext,
  targetOrgId: string | null,
): void {
  if (ctx.role === "super_admin") return;
  if (ctx.role === "branch_manager" && ctx.orgId && ctx.orgId === targetOrgId) {
    return;
  }
  throw new AuthError(403, "Branch is outside the caller's tenant scope");
}

/**
 * Branch-scoped guard: non-super-admin users may only access the single branch
 * embedded in their verified session. This keeps branch managers/teachers from
 * hopping across branch ids by editing client requests.
 */
export function assertBranchAccess(
  ctx: AuthContext,
  targetBranchId: string,
): void {
  if (ctx.role === "super_admin") return;
  if (ctx.branchId && ctx.branchId === targetBranchId) return;
  throw new AuthError(403, "Branch is outside the caller's branch scope");
}

/**
 * Module — Authentication service.
 *
 * Verifies email/password against the stored PBKDF2 hash and mints a signed
 * JWT embedding the claims our RBAC guards read (userId, role, orgId,
 * branchId). Stateless and DB-injected (Guideline #1): route passes the real
 * Drizzle client; tests pass a fake.
 *
 * Security posture:
 *  - Failed login returns ONE generic error regardless of whether the email or
 *    the password was wrong (no account enumeration).
 *  - A dummy hash verification runs even when the user is absent, to keep login
 *    timing roughly constant (mitigates user-enumeration via timing).
 *  - Suspended/archived accounts cannot log in.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { users, staffProfiles } from "../../db/schema";
import { verifyPassword } from "../../lib/crypto";
import { signJwt } from "../../lib/jwt";
import type { Role } from "../../lib/auth";

/** A throwaway valid PBKDF2 hash to compare against when no user is found. */
const DUMMY_HASH =
  "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export class LoginError extends Error {
  constructor(message = "Invalid email or password") {
    super(message);
    this.name = "LoginError";
  }
}

export interface LoginResult {
  token: string;
  user: { id: string; role: Role; orgId: string | null; branchId: string | null };
  expiresInSeconds: number;
}

export interface IssueTokenDeps {
  secret: string;
  nowSeconds: number;
  ttlSeconds: number;
}

/**
 * Authenticate a user and issue a JWT.
 * @throws LoginError on any credential failure (generic, non-enumerating).
 */
export async function login(
  db: DB,
  input: { email: string; password: string },
  deps: IssueTokenDeps,
): Promise<LoginResult> {
  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      orgId: users.orgId,
      globalStatus: users.globalStatus,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  const user = rows[0];

  // Always run a hash verification to equalize timing, even with no user.
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(input.password, hashToCheck);

  if (!user || !user.passwordHash || !passwordOk) {
    throw new LoginError();
  }
  if (user.globalStatus !== "active") {
    throw new LoginError("Account is not active");
  }

  // Resolve the caller's branch (staff are tied to one; others have none).
  const staff = await db
    .select({ branchId: staffProfiles.branchId })
    .from(staffProfiles)
    .where(eq(staffProfiles.userId, user.id))
    .limit(1);
  const branchId = staff[0]?.branchId ?? null;

  const token = await signJwt(
    {
      sub: user.id,
      role: user.role as Role,
      orgId: user.orgId,
      branchId,
    },
    deps.secret,
    { nowSeconds: deps.nowSeconds, ttlSeconds: deps.ttlSeconds },
  );

  return {
    token,
    user: { id: user.id, role: user.role as Role, orgId: user.orgId, branchId },
    expiresInSeconds: deps.ttlSeconds,
  };
}

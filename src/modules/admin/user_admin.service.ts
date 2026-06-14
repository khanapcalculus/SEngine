/**
 * Module 1 — Super-admin user administration.
 *
 * Read + mutate the `users` table for the network User Management console:
 *  - listUsers: every account with the fields the admin UI needs (incl. whether
 *    a local password is set, so the "needs password" state is visible inline).
 *  - updateUserProfile: edit fullName/email, guarding the global email-uniqueness
 *    invariant before the write so a collision returns a clean 400 instead of a
 *    raw unique-violation 500. The update + its audit row commit together.
 *
 * RBAC is enforced at the route (super_admin only); these helpers are DB-injected
 * and stateless (Guideline #1). Password changes are intentionally NOT here —
 * they go through resetPassword in the auth service so hashing lives in one place.
 */
import { and, eq, ne, desc } from "drizzle-orm";
import type { DB } from "../../db/client";
import { users } from "../../db/schema";
import type { Role } from "../../lib/auth";
import type { UpdateUserProfileInput } from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { writeAudit } from "../audit/audit.service";

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  globalStatus: string;
  hasPassword: boolean;
  orgId: string | null;
  createdAt: Date; // serialized to ISO in the JSON response
}

/** List every user for the network admin console (newest first). */
export async function listUsers(db: DB): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      globalStatus: users.globalStatus,
      passwordHash: users.passwordHash,
      orgId: users.orgId,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return rows.map(({ passwordHash, ...u }) => ({
    ...u,
    role: u.role as Role,
    hasPassword: passwordHash !== null && passwordHash !== "",
  }));
}

/** Raised when the target user id does not exist (route maps to 404). */
export class UserNotFoundError extends Error {
  constructor() {
    super("User not found");
    this.name = "UserNotFoundError";
  }
}

export interface UpdatedUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

/** The authenticated super admin performing the edit (for the audit trail). */
export interface UserAdminActor {
  userId: string;
}

/**
 * Update a user's profile (fullName and/or email). Verifies the user exists and
 * that a new email isn't already taken by ANOTHER user before writing, so the
 * global unique-email invariant yields a 400 rather than a DB 500.
 */
export async function updateUserProfile(
  db: DB,
  userId: string,
  input: UpdateUserProfileInput,
  actor: UserAdminActor,
): Promise<UpdatedUser> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        orgId: users.orgId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!existing) throw new UserNotFoundError();

    // Email-uniqueness pre-check, but only when the email actually changes.
    if (input.email !== undefined && input.email !== existing.email) {
      const clash = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, input.email), ne(users.id, userId)))
        .limit(1);
      if (clash.length > 0) {
        throw new ValidationError("Email already in use", {
          email: "another account already uses this email",
        });
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.fullName !== undefined) patch.fullName = input.fullName;
    if (input.email !== undefined) patch.email = input.email;

    const [updated] = await tx
      .update(users)
      .set(patch)
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
      });

    // Record what changed (old -> new) without ever logging secrets.
    const changes: string[] = [];
    if (input.fullName !== undefined && input.fullName !== existing.fullName)
      changes.push(`name "${existing.fullName}" → "${input.fullName}"`);
    if (input.email !== undefined && input.email !== existing.email)
      changes.push(`email "${existing.email}" → "${input.email}"`);

    await writeAudit(tx, {
      actorId: actor.userId,
      orgId: existing.orgId,
      branchId: null,
      action: "user.profile.update",
      entityType: "user",
      entityId: userId,
      summary:
        changes.length > 0
          ? `Updated user ${updated.email}: ${changes.join("; ")}`
          : `Updated user ${updated.email} (no field changes)`,
    });

    return { ...updated, role: updated.role as Role };
  });
}

/**
 * Module 2 — HR & Staff Lifecycle: service layer.
 *
 * Pure, stateless functions (Guideline #1) that take a DB handle injected by
 * the caller. The route handlers pass the real Drizzle client; tests pass a
 * lightweight fake. All business rules live here so they're unit-testable
 * without a running edge runtime.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { users, staffProfiles } from "../../db/schema";
import type { OnboardStaffInput } from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { writeAudit } from "../audit/audit.service";

/** The authenticated caller performing a mutation (for the audit trail). */
export interface Actor {
  userId: string;
  orgId: string | null;
}

export interface OnboardedStaff {
  userId: string;
  staffProfileId: string;
  email: string;
  branchId: string;
}

/**
 * Create a User (role=teacher) and their Staff_Profile atomically.
 * Both rows commit together or neither does (transaction).
 *
 * @throws ValidationError(409-style) if the email already exists.
 */
export async function onboardStaff(
  db: DB,
  input: OnboardStaffInput,
  actor: Actor,
): Promise<OnboardedStaff> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (existing.length > 0) {
      throw new ValidationError("Email already registered", {
        email: "already in use",
      });
    }

    const [user] = await tx
      .insert(users)
      .values({
        orgId: input.orgId,
        email: input.email,
        fullName: input.fullName,
        role: "teacher",
        globalStatus: "active",
      })
      .returning({ id: users.id, email: users.email });

    const [profile] = await tx
      .insert(staffProfiles)
      .values({
        userId: user.id,
        branchId: input.branchId,
        department: input.department,
        employeeNumber: input.employeeNumber,
        hireDate: input.hireDate,
        status: "onboarding",
      })
      .returning({ id: staffProfiles.id });

    await writeAudit(tx, {
      actorId: actor.userId,
      orgId: input.orgId,
      branchId: input.branchId,
      action: "staff.onboard",
      entityType: "staff_profile",
      entityId: profile.id,
      summary: `Onboarded staff ${input.fullName} (${input.email}), ${input.department}`,
    });

    return {
      userId: user.id,
      staffProfileId: profile.id,
      email: user.email,
      branchId: input.branchId,
    };
  });
}

export interface BranchStaffRow {
  staffProfileId: string;
  userId: string;
  fullName: string;
  email: string;
  department: string;
  status: string;
  hireDate: string;
}

/**
 * Fetch the *active* staff for a branch, joined to their user identity.
 * Uses the (branch_id, status) index — the 20+ educator hot path.
 */
export async function getActiveStaffForBranch(
  db: DB,
  branchId: string,
): Promise<BranchStaffRow[]> {
  return db
    .select({
      staffProfileId: staffProfiles.id,
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      department: staffProfiles.department,
      status: staffProfiles.status,
      hireDate: staffProfiles.hireDate,
    })
    .from(staffProfiles)
    .innerJoin(users, eq(staffProfiles.userId, users.id))
    .where(
      and(
        eq(staffProfiles.branchId, branchId),
        eq(staffProfiles.status, "active"),
      ),
    );
}

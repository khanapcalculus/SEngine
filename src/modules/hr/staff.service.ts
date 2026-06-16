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
import type {
  OnboardStaffInput,
  ChangeStaffStatusInput,
} from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";
import { generateTemporaryPassword, hashPassword } from "../../lib/crypto";

/**
 * Legal staff lifecycle transitions (Module 2). Keys are the current status;
 * values are the statuses you may move TO. `retired` and `terminated` are
 * terminal. Enforced server-side so a hand-crafted request can't, say, jump a
 * terminated employee back to active.
 */
export const STAFF_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  onboarding: ["active", "terminated"],
  active: ["on_leave", "retired", "terminated"],
  on_leave: ["active", "retired", "terminated"],
  retired: [],
  terminated: [],
};

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
  temporaryPassword: string;
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

    // Generate a secure temporary password
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const [user] = await tx
      .insert(users)
      .values({
        orgId: input.orgId,
        email: input.email,
        fullName: input.fullName,
        role: "teacher",
        globalStatus: "active",
        passwordHash,
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
        // Omit when not provided so the column default (25.00) applies.
        ...(input.baseRate !== undefined ? { baseRate: input.baseRate.toFixed(2) } : {}),
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
      temporaryPassword,
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
  baseRate: string;
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
      baseRate: staffProfiles.baseRate,
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

/**
 * Fetch ALL staff for a branch regardless of lifecycle status, joined to their
 * user identity. Drives the management roster, where an admin must see (and act
 * on) onboarding/on-leave/retired members — not just the active ones.
 */
export async function listStaffForBranch(
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
      baseRate: staffProfiles.baseRate,
    })
    .from(staffProfiles)
    .innerJoin(users, eq(staffProfiles.userId, users.id))
    .where(eq(staffProfiles.branchId, branchId));
}

/**
 * Set a staff member's hourly base rate (the editing path). Branch-scoped +
 * audited; the new rate feeds the automated payroll engine for future runs.
 */
export async function setStaffBaseRate(
  db: DB,
  staffProfileId: string,
  baseRate: number,
  ctx: AuthContext,
): Promise<{ staffProfileId: string; baseRate: string }> {
  return db.transaction(async (tx) => {
    const [staff] = await tx
      .select({ id: staffProfiles.id, branchId: staffProfiles.branchId, baseRate: staffProfiles.baseRate })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, staffProfileId))
      .limit(1);
    if (!staff) {
      throw new ValidationError("Staff profile not found", { staffProfileId: "no such staff profile" });
    }
    assertBranchAccess(ctx, staff.branchId);

    const next = baseRate.toFixed(2);
    await tx
      .update(staffProfiles)
      .set({ baseRate: next, updatedAt: new Date() })
      .where(eq(staffProfiles.id, staffProfileId));

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: staff.branchId,
      action: "staff.rate.update",
      entityType: "staff_profile",
      entityId: staffProfileId,
      summary: `Hourly rate ${staff.baseRate} → ${next} for staff ${staffProfileId}`,
      metadata: { previous: staff.baseRate, next },
    });

    return { staffProfileId, baseRate: next };
  });
}

export interface StaffStatusResult {
  staffProfileId: string;
  status: string;
  branchId: string;
  retirementDate: string | null;
}

/**
 * Move a staff member through their employment lifecycle (Module 2).
 *
 * Loads the profile, enforces that the caller may act on its branch, validates
 * the transition against STAFF_STATUS_TRANSITIONS, stamps retirementDate on
 * offboarding, and records an immutable audit entry — all in one transaction.
 *
 * @throws ValidationError(404-style) if the profile is missing,
 *         ValidationError(400) on an illegal transition,
 *         AuthError(403) if the branch is outside the caller's scope.
 */
export async function changeStaffStatus(
  db: DB,
  input: ChangeStaffStatusInput,
  ctx: AuthContext,
): Promise<StaffStatusResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: staffProfiles.id,
        branchId: staffProfiles.branchId,
        status: staffProfiles.status,
        fullName: users.fullName,
        email: users.email,
      })
      .from(staffProfiles)
      .innerJoin(users, eq(staffProfiles.userId, users.id))
      .where(eq(staffProfiles.id, input.staffProfileId))
      .limit(1);

    if (!row) {
      throw new ValidationError("Staff profile not found", {
        staffProfileId: "no such staff profile",
      });
    }

    // Branch-scope guard: a branch_manager may only act on their own branch;
    // super_admin is unrestricted. The branch comes from the DB row, so this
    // check must live here (the route can't assert on an id it hasn't read).
    assertBranchAccess(ctx, row.branchId);

    const allowed = STAFF_STATUS_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ValidationError(
        `Cannot change staff status from ${row.status} to ${input.status}`,
        { status: `invalid transition from ${row.status}` },
      );
    }

    const offboarding =
      input.status === "retired" || input.status === "terminated";
    const retirementDate = offboarding
      ? (input.effectiveDate ?? new Date().toISOString().slice(0, 10))
      : null;

    await tx
      .update(staffProfiles)
      .set({ status: input.status, retirementDate, updatedAt: new Date() })
      .where(eq(staffProfiles.id, row.id));

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: row.branchId,
      action: "staff.status_change",
      entityType: "staff_profile",
      entityId: row.id,
      summary: `Changed ${row.fullName} (${row.email}) status ${row.status} -> ${input.status}`,
    });

    return {
      staffProfileId: row.id,
      status: input.status,
      branchId: row.branchId,
      retirementDate,
    };
  });
}

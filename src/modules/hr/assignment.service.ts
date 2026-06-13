/**
 * Module 2 — Assignment Routing: service layer.
 *
 * Stateless functions (Guideline #1) that link staff to class rosters. The
 * route handlers pass the real Drizzle client; tests pass an in-memory fake.
 * All business rules live here so they're unit-testable without a live edge
 * runtime.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  users,
  classes,
  staffProfiles,
  staffAssignments,
} from "../../db/schema";
import type { AssignStaffInput } from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

export interface AssignmentResult {
  assignmentId: string;
  staffId: string;
  classId: string;
  role: string;
}

/**
 * Assign a staff member to a class roster (create a Staff_Assignment).
 *
 * Rules enforced here:
 *  - staff + class must exist, and the caller must have access to the branch
 *  - the staff member must be `active` (you can't route an onboarding/retired
 *    educator to a roster)
 *  - staff and class must share a branch (tenant safety)
 *  - a staff member can't be assigned to the same class twice
 *  - a class has at most ONE `lead` (additional leads are rejected)
 *
 * @throws ValidationError(404-style) if staff/class missing,
 *         ValidationError(400) on inactive staff / cross-branch / duplicate /
 *         lead conflict, AuthError(403) if the branch is out of scope.
 */
export async function assignStaffToClass(
  db: DB,
  input: AssignStaffInput,
  ctx: AuthContext,
): Promise<AssignmentResult> {
  return db.transaction(async (tx) => {
    const [staff] = await tx
      .select({
        id: staffProfiles.id,
        branchId: staffProfiles.branchId,
        status: staffProfiles.status,
      })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, input.staffProfileId))
      .limit(1);
    if (!staff) {
      throw new ValidationError("Staff profile not found", {
        staffProfileId: "no such staff profile",
      });
    }

    const [klass] = await tx
      .select({ id: classes.id, branchId: classes.branchId })
      .from(classes)
      .where(eq(classes.id, input.classId))
      .limit(1);
    if (!klass) {
      throw new ValidationError("Class not found", {
        classId: "no such class",
      });
    }

    // Branch-scope guard: a branch_manager may only staff classes in their own
    // branch; super_admin is unrestricted.
    assertBranchAccess(ctx, klass.branchId);

    if (staff.status !== "active") {
      throw new ValidationError("Staff member is not active", {
        staffProfileId: `cannot assign ${staff.status} staff`,
      });
    }

    // Tenant safety: a staff member can't be assigned to a class at another branch.
    if (staff.branchId !== klass.branchId) {
      throw new ValidationError("Staff and class are at different branches", {
        classId: "branch mismatch",
      });
    }

    const dupe = await tx
      .select({ id: staffAssignments.id })
      .from(staffAssignments)
      .where(
        and(
          eq(staffAssignments.staffId, input.staffProfileId),
          eq(staffAssignments.classId, input.classId),
        ),
      )
      .limit(1);
    if (dupe.length > 0) {
      throw new ValidationError("Staff already assigned to this class", {
        classId: "already assigned",
      });
    }

    // At most one lead per class.
    if (input.role === "lead") {
      const existingLead = await tx
        .select({ id: staffAssignments.id })
        .from(staffAssignments)
        .where(
          and(
            eq(staffAssignments.classId, input.classId),
            eq(staffAssignments.role, "lead"),
          ),
        )
        .limit(1);
      if (existingLead.length > 0) {
        throw new ValidationError("Class already has a lead educator", {
          role: "class already has a lead",
        });
      }
    }

    const [row] = await tx
      .insert(staffAssignments)
      .values({
        staffId: input.staffProfileId,
        classId: input.classId,
        role: input.role,
      })
      .returning({ id: staffAssignments.id });

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: klass.branchId,
      action: "staff.assign",
      entityType: "staff_assignment",
      entityId: row.id,
      summary: `Assigned staff ${input.staffProfileId} to class ${input.classId} as ${input.role}`,
    });

    return {
      assignmentId: row.id,
      staffId: input.staffProfileId,
      classId: input.classId,
      role: input.role,
    };
  });
}

export interface BranchAssignmentRow {
  assignmentId: string;
  classId: string;
  staffProfileId: string;
  fullName: string;
  email: string;
  department: string;
  role: string;
}

/**
 * List every staff↔class assignment for a branch, joined to class + identity.
 * Scoped by the class's branch so it composes with the dashboard's branch view.
 */
export async function listAssignmentsForBranch(
  db: DB,
  branchId: string,
): Promise<BranchAssignmentRow[]> {
  return db
    .select({
      assignmentId: staffAssignments.id,
      classId: staffAssignments.classId,
      staffProfileId: staffProfiles.id,
      fullName: users.fullName,
      email: users.email,
      department: staffProfiles.department,
      role: staffAssignments.role,
    })
    .from(staffAssignments)
    .innerJoin(classes, eq(staffAssignments.classId, classes.id))
    .innerJoin(staffProfiles, eq(staffAssignments.staffId, staffProfiles.id))
    .innerJoin(users, eq(staffProfiles.userId, users.id))
    .where(eq(classes.branchId, branchId));
}

export interface StaffUserClassRow {
  classId: string;
  subject: string;
  term: string;
  credits: number;
  role: string;
}

/**
 * The classes a staff member works, resolved by their USER id (self-service).
 * Powers a teacher's "My Classes" — never takes a client-supplied staff id, so
 * a teacher can only ever see their own roster.
 */
export async function listClassesForStaffUser(
  db: DB,
  userId: string,
): Promise<StaffUserClassRow[]> {
  return db
    .select({
      classId: classes.id,
      subject: classes.subject,
      term: classes.term,
      credits: classes.credits,
      role: staffAssignments.role,
    })
    .from(staffAssignments)
    .innerJoin(staffProfiles, eq(staffAssignments.staffId, staffProfiles.id))
    .innerJoin(classes, eq(staffAssignments.classId, classes.id))
    .where(eq(staffProfiles.userId, userId));
}

export interface UnassignResult {
  assignmentId: string;
  classId: string;
}

/**
 * Remove a staff↔class assignment. Loads the assignment's class to enforce
 * branch scope before deleting, and records an audit entry.
 *
 * @throws ValidationError(404-style) if the assignment is missing,
 *         AuthError(403) if the branch is outside the caller's scope.
 */
export async function unassignStaff(
  db: DB,
  assignmentId: string,
  ctx: AuthContext,
): Promise<UnassignResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: staffAssignments.id,
        classId: staffAssignments.classId,
        staffId: staffAssignments.staffId,
        branchId: classes.branchId,
      })
      .from(staffAssignments)
      .innerJoin(classes, eq(staffAssignments.classId, classes.id))
      .where(eq(staffAssignments.id, assignmentId))
      .limit(1);

    if (!row) {
      throw new ValidationError("Assignment not found", {
        assignmentId: "no such assignment",
      });
    }

    assertBranchAccess(ctx, row.branchId);

    await tx
      .delete(staffAssignments)
      .where(eq(staffAssignments.id, assignmentId));

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: row.branchId,
      action: "staff.unassign",
      entityType: "staff_assignment",
      entityId: row.id,
      summary: `Unassigned staff ${row.staffId} from class ${row.classId}`,
    });

    return { assignmentId: row.id, classId: row.classId };
  });
}

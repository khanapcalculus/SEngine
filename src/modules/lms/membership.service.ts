/**
 * Module 4 — class membership guard.
 *
 * LMS content (assignments, submissions, discussions) is CLASS-scoped, not just
 * branch-scoped. This resolves whether the caller may access a class:
 *  - super_admin: always
 *  - branch_manager: the class must be in their branch
 *  - teacher: must have a staff_assignment to the class
 *  - student: must have an enrollment in the class
 * Throws AuthError(403) otherwise, ValidationError(404) if the class is missing.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  classes,
  enrollments,
  staffAssignments,
  staffProfiles,
  studentProfiles,
} from "../../db/schema";
import { AuthError, assertBranchAccess, type AuthContext } from "../../lib/auth";
import { ValidationError } from "../../lib/validation";

export interface ClassAccess {
  classId: string;
  branchId: string;
  memberRole: AuthContext["role"];
}

/** Anything with .select — the db handle or a transaction. */
type Reader = Pick<DB, "select">;

export async function assertClassAccess(
  db: Reader,
  ctx: AuthContext,
  classId: string,
): Promise<ClassAccess> {
  const [klass] = await db
    .select({ id: classes.id, branchId: classes.branchId })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);
  if (!klass) {
    throw new ValidationError("Class not found", { classId: "no such class" });
  }

  const access: ClassAccess = {
    classId: klass.id,
    branchId: klass.branchId,
    memberRole: ctx.role,
  };

  if (ctx.role === "super_admin") return access;

  if (ctx.role === "branch_manager") {
    assertBranchAccess(ctx, klass.branchId); // throws 403 on mismatch
    return access;
  }

  if (ctx.role === "teacher") {
    const rows = await db
      .select({ id: staffAssignments.id })
      .from(staffAssignments)
      .innerJoin(staffProfiles, eq(staffAssignments.staffId, staffProfiles.id))
      .where(
        and(
          eq(staffAssignments.classId, classId),
          eq(staffProfiles.userId, ctx.userId),
        ),
      )
      .limit(1);
    if (rows.length > 0) return access;
  }

  if (ctx.role === "student") {
    const rows = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .innerJoin(
        studentProfiles,
        eq(enrollments.studentId, studentProfiles.id),
      )
      .where(
        and(
          eq(enrollments.classId, classId),
          eq(studentProfiles.userId, ctx.userId),
        ),
      )
      .limit(1);
    if (rows.length > 0) return access;
  }

  throw new AuthError(403, "You are not a member of this class");
}

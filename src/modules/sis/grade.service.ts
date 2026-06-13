/**
 * Module 3 — Enrollment grading: service layer.
 *
 * Stateless functions (Guideline #1) that record final grades on enrollments
 * and list a branch's enrollments for the gradebook. Route handlers pass the
 * real Drizzle client; tests pass an in-memory fake.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  users,
  classes,
  enrollments,
  studentProfiles,
  staffProfiles,
  staffAssignments,
} from "../../db/schema";
import type { GradeEnrollmentInput } from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { AuthError, assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

export interface GradeResult {
  enrollmentId: string;
  finalGrade: string;
  status: string;
}

/**
 * Record a final grade on an enrollment, completing it.
 *
 * Rules: the enrollment must exist and the caller must have access to its
 * branch; a `teacher` may only grade classes they are assigned to (reuses
 * staff_assignments); a `withdrawn` enrollment cannot be graded. Re-grading a
 * `completed` enrollment is allowed (an authorized correction). Audited.
 *
 * @throws ValidationError(404-style) if the enrollment is missing,
 *         ValidationError(400) if it is withdrawn,
 *         AuthError(403) if the branch/class is outside the caller's scope.
 */
export async function gradeEnrollment(
  db: DB,
  input: GradeEnrollmentInput,
  ctx: AuthContext,
): Promise<GradeResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: enrollments.id,
        status: enrollments.status,
        classId: enrollments.classId,
        branchId: classes.branchId,
      })
      .from(enrollments)
      .innerJoin(classes, eq(enrollments.classId, classes.id))
      .where(eq(enrollments.id, input.enrollmentId))
      .limit(1);

    if (!row) {
      throw new ValidationError("Enrollment not found", {
        enrollmentId: "no such enrollment",
      });
    }

    assertBranchAccess(ctx, row.branchId);

    // Teachers may only grade classes they staff; managers/admins are exempt.
    if (ctx.role === "teacher") {
      const assigned = await tx
        .select({ id: staffAssignments.id })
        .from(staffAssignments)
        .innerJoin(
          staffProfiles,
          eq(staffAssignments.staffId, staffProfiles.id),
        )
        .where(
          and(
            eq(staffAssignments.classId, row.classId),
            eq(staffProfiles.userId, ctx.userId),
          ),
        )
        .limit(1);
      if (assigned.length === 0) {
        throw new AuthError(403, "You are not assigned to this class");
      }
    }

    if (row.status === "withdrawn") {
      throw new ValidationError("Cannot grade a withdrawn enrollment", {
        enrollmentId: "enrollment is withdrawn",
      });
    }

    await tx
      .update(enrollments)
      .set({
        finalGrade: input.finalGrade,
        status: "completed",
        updatedAt: new Date(),
      })
      .where(eq(enrollments.id, row.id));

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: row.branchId,
      action: "enrollment.grade",
      entityType: "enrollment",
      entityId: row.id,
      summary: `Graded enrollment ${row.id} as ${input.finalGrade}`,
    });

    return {
      enrollmentId: row.id,
      finalGrade: input.finalGrade,
      status: "completed",
    };
  });
}

export interface BranchEnrollmentRow {
  enrollmentId: string;
  classId: string;
  classSubject: string;
  term: string;
  credits: number;
  studentProfileId: string;
  studentName: string;
  status: string;
  finalGrade: string | null;
}

/**
 * Every enrollment for a branch, joined to class + student identity. Powers the
 * dashboard gradebook (grouped by class) and feeds nothing security-sensitive
 * back to the client beyond what the roster already shows.
 */
export async function listEnrollmentsForBranch(
  db: DB,
  branchId: string,
): Promise<BranchEnrollmentRow[]> {
  return db
    .select({
      enrollmentId: enrollments.id,
      classId: enrollments.classId,
      classSubject: classes.subject,
      term: classes.term,
      credits: classes.credits,
      studentProfileId: studentProfiles.id,
      studentName: users.fullName,
      status: enrollments.status,
      finalGrade: enrollments.finalGrade,
    })
    .from(enrollments)
    .innerJoin(classes, eq(enrollments.classId, classes.id))
    .innerJoin(studentProfiles, eq(enrollments.studentId, studentProfiles.id))
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .where(eq(classes.branchId, branchId));
}

/**
 * Gradebook for a TEACHER, resolved by their user id (self-service): every
 * enrollment in a class they are assigned to. Never takes a client branch/class
 * id, so a teacher only ever sees rosters for classes they actually staff.
 */
export async function listGradebookForStaffUser(
  db: DB,
  userId: string,
): Promise<BranchEnrollmentRow[]> {
  return db
    .select({
      enrollmentId: enrollments.id,
      classId: enrollments.classId,
      classSubject: classes.subject,
      term: classes.term,
      credits: classes.credits,
      studentProfileId: studentProfiles.id,
      studentName: users.fullName,
      status: enrollments.status,
      finalGrade: enrollments.finalGrade,
    })
    .from(enrollments)
    .innerJoin(classes, eq(enrollments.classId, classes.id))
    .innerJoin(staffAssignments, eq(staffAssignments.classId, classes.id))
    .innerJoin(staffProfiles, eq(staffAssignments.staffId, staffProfiles.id))
    .innerJoin(studentProfiles, eq(enrollments.studentId, studentProfiles.id))
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .where(eq(staffProfiles.userId, userId));
}

export interface StudentEnrollmentRow {
  classSubject: string;
  term: string;
  credits: number;
  status: string;
  finalGrade: string | null;
}

/**
 * A STUDENT's own enrollments, resolved by their user id (self-service). Powers
 * "My Enrollments" — keyed off the session user, never a client id.
 */
export async function listEnrollmentsForStudentUser(
  db: DB,
  userId: string,
): Promise<StudentEnrollmentRow[]> {
  return db
    .select({
      classSubject: classes.subject,
      term: classes.term,
      credits: classes.credits,
      status: enrollments.status,
      finalGrade: enrollments.finalGrade,
    })
    .from(enrollments)
    .innerJoin(classes, eq(enrollments.classId, classes.id))
    .innerJoin(studentProfiles, eq(enrollments.studentId, studentProfiles.id))
    .where(eq(studentProfiles.userId, userId));
}

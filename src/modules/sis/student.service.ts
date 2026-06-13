/**
 * Module 3 — Student Information System (SIS): service layer.
 *
 * Stateless functions taking an injected DB handle (Guideline #1). Route
 * handlers pass the real Drizzle client; tests pass an in-memory fake.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  users,
  studentProfiles,
  classes,
  enrollments,
} from "../../db/schema";
import type {
  EnrollStudentInput,
  AssignClassInput,
} from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { writeAudit } from "../audit/audit.service";
import { generateTemporaryPassword, hashPassword } from "../../lib/crypto";

/** The authenticated caller performing a mutation (for the audit trail). */
export interface Actor {
  userId: string;
  orgId: string | null;
}

export interface EnrolledStudent {
  userId: string;
  studentProfileId: string;
  email: string;
  cohortYear: number;
  temporaryPassword: string;
}

/**
 * Create a User (role=student) and their Student_Profile atomically.
 * @throws ValidationError if the email is already registered.
 */
export async function enrollStudent(
  db: DB,
  input: EnrollStudentInput,
  actor: Actor,
): Promise<EnrolledStudent> {
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
        role: "student",
        globalStatus: "active",
        passwordHash,
      })
      .returning({ id: users.id, email: users.email });

    const [profile] = await tx
      .insert(studentProfiles)
      .values({
        userId: user.id,
        branchId: input.branchId,
        enrollmentDate: input.enrollmentDate,
        cohortYear: input.cohortYear,
        status: "active",
      })
      .returning({ id: studentProfiles.id });

    await writeAudit(tx, {
      actorId: actor.userId,
      orgId: input.orgId,
      branchId: input.branchId,
      action: "student.enroll",
      entityType: "student_profile",
      entityId: profile.id,
      summary: `Enrolled student ${input.fullName} (${input.email}), cohort ${input.cohortYear}`,
    });

    return {
      userId: user.id,
      studentProfileId: profile.id,
      email: user.email,
      cohortYear: input.cohortYear,
      temporaryPassword,
    };
  });
}

export interface StudentRow {
  studentProfileId: string;
  userId: string;
  fullName: string;
  email: string;
  cohortYear: number;
  status: string;
}

/** Active students in a branch, joined to their user identity. */
export async function getActiveStudentsForBranch(
  db: DB,
  branchId: string,
): Promise<StudentRow[]> {
  return db
    .select({
      studentProfileId: studentProfiles.id,
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      cohortYear: studentProfiles.cohortYear,
      status: studentProfiles.status,
    })
    .from(studentProfiles)
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .where(
      and(
        eq(studentProfiles.branchId, branchId),
        eq(studentProfiles.status, "active"),
      ),
    );
}

export interface AssignmentResult {
  enrollmentId: string;
  studentId: string;
  classId: string;
}

/**
 * Link a student to a class (create an Enrollment row).
 * Validates that both the student and class exist and share a branch, and
 * rejects duplicate enrollment into the same class.
 *
 * @throws ValidationError(404-style) if student/class missing,
 *         (409-style) if already enrolled, or cross-branch mismatch.
 */
export async function assignStudentToClass(
  db: DB,
  input: AssignClassInput,
  actor: Actor,
): Promise<AssignmentResult> {
  return db.transaction(async (tx) => {
    const [student] = await tx
      .select({ id: studentProfiles.id, branchId: studentProfiles.branchId })
      .from(studentProfiles)
      .where(eq(studentProfiles.id, input.studentId))
      .limit(1);
    if (!student) {
      throw new ValidationError("Student not found", {
        studentId: "no such student",
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

    // Tenant safety: a student can't be assigned to a class at another branch.
    if (student.branchId !== klass.branchId) {
      throw new ValidationError("Student and class are at different branches", {
        classId: "branch mismatch",
      });
    }

    const dupe = await tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.studentId, input.studentId),
          eq(enrollments.classId, input.classId),
        ),
      )
      .limit(1);
    if (dupe.length > 0) {
      throw new ValidationError("Student already enrolled in this class", {
        classId: "already enrolled",
      });
    }

    const [row] = await tx
      .insert(enrollments)
      .values({
        studentId: input.studentId,
        classId: input.classId,
        status: "enrolled",
      })
      .returning({ id: enrollments.id });

    await writeAudit(tx, {
      actorId: actor.userId,
      orgId: actor.orgId,
      branchId: klass.branchId,
      action: "class.assign",
      entityType: "enrollment",
      entityId: row.id,
      summary: `Assigned student ${input.studentId} to class ${input.classId}`,
    });

    return {
      enrollmentId: row.id,
      studentId: input.studentId,
      classId: input.classId,
    };
  });
}

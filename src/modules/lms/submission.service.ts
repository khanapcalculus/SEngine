/**
 * Module 4 — Submissions: service layer.
 *
 * A student submits to a published assignment (one row per assignment+student);
 * staff grade; the owning student attaches files (metadata only — bytes live in
 * Vercel Blob). Class membership + ownership enforced here. Audited.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  assignments,
  submissions,
  submissionFiles,
  studentProfiles,
  users,
} from "../../db/schema";
import type {
  GradeSubmissionInput,
  RegisterFileInput,
} from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { AuthError, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";
import { getStudentProfileIdByUser } from "../sis/transcript.service";
import { assertClassAccess } from "./membership.service";

const STAFF_ROLES = new Set(["super_admin", "branch_manager", "teacher"]);

export interface SubmissionResult {
  submissionId: string;
  assignmentId: string;
  status: string;
}

/** A student submits (or re-submits) their work to a published assignment. */
export async function submitAssignment(
  db: DB,
  assignmentId: string,
  ctx: AuthContext,
): Promise<SubmissionResult> {
  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .select({
        id: assignments.id,
        classId: assignments.classId,
        status: assignments.status,
      })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    if (!assignment) {
      throw new ValidationError("Assignment not found", {
        assignmentId: "no such assignment",
      });
    }

    const access = await assertClassAccess(tx, ctx, assignment.classId);

    if (assignment.status !== "published") {
      throw new ValidationError("Assignment is not open for submissions", {
        assignmentId: `assignment is ${assignment.status}`,
      });
    }

    const studentId = await getStudentProfileIdByUser(tx, ctx.userId);
    if (!studentId) {
      throw new AuthError(403, "No student profile for this account");
    }

    const [existing] = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.assignmentId, assignmentId),
          eq(submissions.studentId, studentId),
        ),
      )
      .limit(1);

    let submissionId: string;
    if (existing) {
      await tx
        .update(submissions)
        .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(submissions.id, existing.id));
      submissionId = existing.id;
    } else {
      const [row] = await tx
        .insert(submissions)
        .values({
          assignmentId,
          studentId,
          status: "submitted",
          submittedAt: new Date(),
        })
        .returning({ id: submissions.id });
      submissionId = row.id;
    }

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: access.branchId,
      action: "submission.submit",
      entityType: "submission",
      entityId: submissionId,
      summary: `Submitted to assignment ${assignmentId}`,
    });

    return { submissionId, assignmentId, status: "submitted" };
  });
}

/** Staff grades a submission. Points are capped at the assignment's maxPoints. */
export async function gradeSubmission(
  db: DB,
  submissionId: string,
  input: GradeSubmissionInput,
  ctx: AuthContext,
): Promise<{ submissionId: string; pointsAwarded: number; status: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: submissions.id,
        assignmentId: submissions.assignmentId,
        classId: assignments.classId,
        maxPoints: assignments.maxPoints,
      })
      .from(submissions)
      .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (!row) {
      throw new ValidationError("Submission not found", {
        submissionId: "no such submission",
      });
    }

    const access = await assertClassAccess(tx, ctx, row.classId);
    if (!STAFF_ROLES.has(ctx.role)) {
      throw new AuthError(403, "Only staff may grade submissions");
    }

    if (input.pointsAwarded > row.maxPoints) {
      throw new ValidationError("Points exceed the assignment maximum", {
        pointsAwarded: `must be <= ${row.maxPoints}`,
      });
    }

    await tx
      .update(submissions)
      .set({
        pointsAwarded: input.pointsAwarded,
        feedback: input.feedback ?? null,
        status: "graded",
        gradedBy: ctx.userId,
        gradedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, submissionId));

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: access.branchId,
      action: "submission.grade",
      entityType: "submission",
      entityId: submissionId,
      summary: `Graded submission ${submissionId}: ${input.pointsAwarded}/${row.maxPoints}`,
    });

    return { submissionId, pointsAwarded: input.pointsAwarded, status: "graded" };
  });
}

export interface AssignmentSubmissionRow {
  submissionId: string;
  studentProfileId: string;
  studentName: string;
  status: string;
  pointsAwarded: number | null;
  submittedAt: Date | null;
}

/** Staff lists every submission for an assignment. */
export async function listSubmissionsForAssignment(
  db: DB,
  ctx: AuthContext,
  assignmentId: string,
): Promise<AssignmentSubmissionRow[]> {
  const [assignment] = await db
    .select({ classId: assignments.classId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) {
    throw new ValidationError("Assignment not found", {
      assignmentId: "no such assignment",
    });
  }
  await assertClassAccess(db, ctx, assignment.classId);
  if (!STAFF_ROLES.has(ctx.role)) {
    throw new AuthError(403, "Only staff may list submissions");
  }

  return db
    .select({
      submissionId: submissions.id,
      studentProfileId: studentProfiles.id,
      studentName: users.fullName,
      status: submissions.status,
      pointsAwarded: submissions.pointsAwarded,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(studentProfiles, eq(submissions.studentId, studentProfiles.id))
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .where(eq(submissions.assignmentId, assignmentId));
}

export interface StudentSubmissionRow {
  submissionId: string;
  assignmentId: string;
  status: string;
  pointsAwarded: number | null;
  submittedAt: Date | null;
}

/** A student's own submissions (self-service, keyed off userId). */
export async function listSubmissionsForStudentUser(
  db: DB,
  userId: string,
): Promise<StudentSubmissionRow[]> {
  return db
    .select({
      submissionId: submissions.id,
      assignmentId: submissions.assignmentId,
      status: submissions.status,
      pointsAwarded: submissions.pointsAwarded,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(studentProfiles, eq(submissions.studentId, studentProfiles.id))
    .where(eq(studentProfiles.userId, userId));
}

/**
 * Confirm the caller is the student who owns a submission. Used to authorize
 * file attach (register + Blob upload). Returns the submission id on success.
 */
export async function assertSubmissionOwner(
  db: Pick<DB, "select">,
  ctx: AuthContext,
  submissionId: string,
): Promise<{ submissionId: string }> {
  const [row] = await db
    .select({ id: submissions.id, studentId: submissions.studentId })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!row) {
    throw new ValidationError("Submission not found", {
      submissionId: "no such submission",
    });
  }
  const studentId = await getStudentProfileIdByUser(db as DB, ctx.userId);
  if (!studentId || studentId !== row.studentId) {
    throw new AuthError(403, "You do not own this submission");
  }
  return { submissionId: row.id };
}

/** Record a submission file's metadata (Blob callback OR explicit register). */
export async function recordSubmissionFile(
  db: DB,
  submissionId: string,
  meta: RegisterFileInput,
): Promise<{ fileId: string; url: string }> {
  const [row] = await db
    .insert(submissionFiles)
    .values({
      submissionId,
      fileName: meta.fileName,
      contentType: meta.contentType ?? null,
      sizeBytes: meta.sizeBytes ?? null,
      storageProvider: "vercel_blob",
      storageKey: meta.storageKey,
      url: meta.url,
    })
    .returning({ id: submissionFiles.id, url: submissionFiles.url });
  return { fileId: row.id, url: row.url };
}

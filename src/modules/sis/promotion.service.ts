/**
 * Module 3 — Term-over-term promotion: service layer.
 *
 * Closes out a term for a student: evaluates their graded coursework for that
 * term, advances/retains/graduates them, and records an append-only promotion
 * row (the transcript reads these). Stateless; DB handle is injected.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  classes,
  enrollments,
  studentProfiles,
  studentPromotions,
} from "../../db/schema";
import type { PromoteStudentInput } from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";
import { computeGpa } from "./grading";

export interface PromotionResult {
  studentProfileId: string;
  term: string;
  fromLevel: number;
  toLevel: number;
  outcome: string;
  termGpa: number | null;
}

/**
 * Apply a progression decision for a student's term.
 *
 * Rules: the student must exist, be in the caller's branch scope, and be
 * `active`. For `promoted`/`graduated` the term must have coursework and none
 * of it may be ungraded (still `enrolled`). `promoted` advances current_level;
 * `graduated` marks the profile graduated with today's date; `retained` holds
 * the level. The credit-weighted term GPA is snapshotted onto the record.
 *
 * @throws ValidationError(404-style) if the student is missing,
 *         ValidationError(400) on a non-active student, an empty term, or
 *         ungraded coursework; AuthError(403) if out of branch scope.
 */
export async function promoteStudent(
  db: DB,
  input: PromoteStudentInput,
  ctx: AuthContext,
): Promise<PromotionResult> {
  return db.transaction(async (tx) => {
    const [student] = await tx
      .select({
        id: studentProfiles.id,
        branchId: studentProfiles.branchId,
        status: studentProfiles.status,
        currentLevel: studentProfiles.currentLevel,
      })
      .from(studentProfiles)
      .where(eq(studentProfiles.id, input.studentProfileId))
      .limit(1);

    if (!student) {
      throw new ValidationError("Student profile not found", {
        studentProfileId: "no such student profile",
      });
    }

    assertBranchAccess(ctx, student.branchId);

    if (student.status !== "active") {
      throw new ValidationError("Only active students can be promoted", {
        studentProfileId: `student is ${student.status}`,
      });
    }

    const termEnrollments = await tx
      .select({
        status: enrollments.status,
        finalGrade: enrollments.finalGrade,
        credits: classes.credits,
      })
      .from(enrollments)
      .innerJoin(classes, eq(enrollments.classId, classes.id))
      .where(
        and(
          eq(enrollments.studentId, student.id),
          eq(classes.term, input.term),
        ),
      );

    if (input.outcome !== "retained") {
      if (termEnrollments.length === 0) {
        throw new ValidationError("No coursework recorded for this term", {
          term: "no enrollments in this term",
        });
      }
      if (termEnrollments.some((e) => e.status === "enrolled")) {
        throw new ValidationError("Term has ungraded coursework", {
          term: "grade all enrollments before promoting",
        });
      }
    }

    const termGpa = computeGpa(
      termEnrollments
        .filter((e) => e.finalGrade)
        .map((e) => ({ grade: e.finalGrade as string, credits: e.credits })),
    );

    const fromLevel = student.currentLevel;
    const toLevel =
      input.outcome === "promoted" ? fromLevel + 1 : fromLevel;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.outcome === "promoted") {
      set.currentLevel = toLevel;
    } else if (input.outcome === "graduated") {
      set.status = "graduated";
      set.graduationDate = new Date().toISOString().slice(0, 10);
    }
    await tx
      .update(studentProfiles)
      .set(set)
      .where(eq(studentProfiles.id, student.id));

    await tx.insert(studentPromotions).values({
      studentId: student.id,
      term: input.term,
      fromLevel,
      toLevel,
      termGpa: termGpa === null ? null : termGpa.toFixed(2),
      outcome: input.outcome,
      actorId: ctx.userId,
    });

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: student.branchId,
      action: "student.promote",
      entityType: "student_profile",
      entityId: student.id,
      summary: `Term ${input.term}: ${input.outcome} (level ${fromLevel} -> ${toLevel}, GPA ${
        termGpa === null ? "n/a" : termGpa.toFixed(2)
      })`,
    });

    return {
      studentProfileId: student.id,
      term: input.term,
      fromLevel,
      toLevel,
      outcome: input.outcome,
      termGpa,
    };
  });
}

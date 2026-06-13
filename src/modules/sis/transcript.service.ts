/**
 * Module 3 — Transcript generation: read-only assembly.
 *
 * Pulls a student's identity, their coursework grouped by term (with per-term
 * and cumulative credit-weighted GPA), and their progression history into a
 * single payload. Pure read; the branch-scope guard runs against the loaded
 * student's branch (the route can't assert on an id it hasn't read).
 */
import { asc, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  users,
  classes,
  enrollments,
  studentProfiles,
  studentPromotions,
} from "../../db/schema";
import { ValidationError } from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { computeGpa } from "./grading";

export interface TranscriptCourse {
  subject: string;
  credits: number;
  grade: string | null;
  status: string;
}

export interface TranscriptTerm {
  term: string;
  courses: TranscriptCourse[];
  termGpa: number | null;
  gradedCredits: number;
}

export interface TranscriptPromotion {
  term: string;
  fromLevel: number;
  toLevel: number;
  termGpa: string | null;
  outcome: string;
  createdAt: Date;
}

export interface Transcript {
  student: {
    studentProfileId: string;
    fullName: string;
    email: string;
    cohortYear: number;
    status: string;
    currentLevel: number;
    enrollmentDate: string;
    graduationDate: string | null;
  };
  terms: TranscriptTerm[];
  cumulativeGpa: number | null;
  totalGradedCredits: number;
  promotions: TranscriptPromotion[];
}

export async function getTranscript(
  db: DB,
  studentProfileId: string,
  ctx: AuthContext,
): Promise<Transcript> {
  const [student] = await db
    .select({
      id: studentProfiles.id,
      branchId: studentProfiles.branchId,
      fullName: users.fullName,
      email: users.email,
      cohortYear: studentProfiles.cohortYear,
      status: studentProfiles.status,
      currentLevel: studentProfiles.currentLevel,
      enrollmentDate: studentProfiles.enrollmentDate,
      graduationDate: studentProfiles.graduationDate,
    })
    .from(studentProfiles)
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .where(eq(studentProfiles.id, studentProfileId))
    .limit(1);

  if (!student) {
    throw new ValidationError("Student profile not found", {
      studentProfileId: "no such student profile",
    });
  }

  assertBranchAccess(ctx, student.branchId);

  const courseRows = await db
    .select({
      subject: classes.subject,
      term: classes.term,
      credits: classes.credits,
      status: enrollments.status,
      finalGrade: enrollments.finalGrade,
    })
    .from(enrollments)
    .innerJoin(classes, eq(enrollments.classId, classes.id))
    .where(eq(enrollments.studentId, student.id));

  const promotionRows = await db
    .select({
      term: studentPromotions.term,
      fromLevel: studentPromotions.fromLevel,
      toLevel: studentPromotions.toLevel,
      termGpa: studentPromotions.termGpa,
      outcome: studentPromotions.outcome,
      createdAt: studentPromotions.createdAt,
    })
    .from(studentPromotions)
    .where(eq(studentPromotions.studentId, student.id))
    .orderBy(asc(studentPromotions.createdAt));

  // Group coursework by term, preserving first-seen order.
  const byTerm = new Map<string, TranscriptCourse[]>();
  for (const c of courseRows) {
    const list = byTerm.get(c.term) ?? [];
    list.push({
      subject: c.subject,
      credits: c.credits,
      grade: c.finalGrade,
      status: c.status,
    });
    byTerm.set(c.term, list);
  }

  const terms: TranscriptTerm[] = [];
  for (const [term, courses] of byTerm) {
    const graded = courses.filter((c) => c.grade);
    terms.push({
      term,
      courses,
      termGpa: computeGpa(
        graded.map((c) => ({ grade: c.grade as string, credits: c.credits })),
      ),
      gradedCredits: graded.reduce((sum, c) => sum + c.credits, 0),
    });
  }

  const allGraded = courseRows.filter((c) => c.finalGrade);
  const cumulativeGpa = computeGpa(
    allGraded.map((c) => ({ grade: c.finalGrade as string, credits: c.credits })),
  );
  const totalGradedCredits = allGraded.reduce((sum, c) => sum + c.credits, 0);

  return {
    student: {
      studentProfileId: student.id,
      fullName: student.fullName,
      email: student.email,
      cohortYear: student.cohortYear,
      status: student.status,
      currentLevel: student.currentLevel,
      enrollmentDate: student.enrollmentDate,
      graduationDate: student.graduationDate,
    },
    terms,
    cumulativeGpa,
    totalGradedCredits,
    promotions: promotionRows,
  };
}

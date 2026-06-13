/**
 * Module 3 — Grading scale + GPA math.
 *
 * Pure, dependency-free helpers (Guideline #1) so the grade contract lives in
 * ONE place and is unit-testable in isolation. Standard 4.0 letter scale.
 */

/** Letter grade → grade points on a 4.0 scale. The keys are the valid grades. */
export const GRADE_POINTS: Record<string, number> = {
  "A+": 4.0,
  A: 4.0,
  "A-": 3.7,
  "B+": 3.3,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.3,
  C: 2.0,
  "C-": 1.7,
  "D+": 1.3,
  D: 1.0,
  "D-": 0.7,
  F: 0.0,
};

/** Every accepted letter grade, e.g. for building a <select> or validating input. */
export const VALID_GRADES = Object.keys(GRADE_POINTS);

export function isValidGrade(grade: unknown): grade is string {
  return typeof grade === "string" && grade in GRADE_POINTS;
}

/** Grade points for a letter, or null if it isn't a recognized grade. */
export function gradePoints(grade: string): number | null {
  return grade in GRADE_POINTS ? GRADE_POINTS[grade] : null;
}

/** One graded course's contribution to a GPA: its grade points and credit-hours. */
export interface GradedUnit {
  grade: string;
  credits: number;
}

/**
 * Credit-weighted GPA, rounded to 2 decimals.
 * GPA = Σ(points · credits) / Σ(credits) over the recognized graded units.
 * Returns null when there are no creditable graded units (an empty transcript
 * has no GPA rather than a misleading 0.00).
 */
export function computeGpa(units: GradedUnit[]): number | null {
  let totalPoints = 0;
  let totalCredits = 0;
  for (const u of units) {
    const pts = gradePoints(u.grade);
    if (pts === null || !Number.isFinite(u.credits) || u.credits <= 0) continue;
    totalPoints += pts * u.credits;
    totalCredits += u.credits;
  }
  if (totalCredits === 0) return null;
  return Math.round((totalPoints / totalCredits) * 100) / 100;
}

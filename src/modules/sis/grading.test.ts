/**
 * Unit tests for the grading scale + GPA math (Module 3).
 * Run: npx vitest run src/modules/sis/grading.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  GRADE_POINTS,
  VALID_GRADES,
  isValidGrade,
  gradePoints,
  computeGpa,
} from "./grading";

describe("grade scale", () => {
  it("exposes the standard 4.0 letter scale", () => {
    expect(GRADE_POINTS.A).toBe(4.0);
    expect(GRADE_POINTS["A-"]).toBe(3.7);
    expect(GRADE_POINTS.F).toBe(0.0);
    expect(VALID_GRADES).toContain("B+");
    expect(VALID_GRADES).toHaveLength(13);
  });

  it("validates letter grades", () => {
    expect(isValidGrade("A")).toBe(true);
    expect(isValidGrade("E")).toBe(false);
    expect(isValidGrade(4)).toBe(false);
    expect(isValidGrade(undefined)).toBe(false);
  });

  it("maps grades to points (null for unknown)", () => {
    expect(gradePoints("B")).toBe(3.0);
    expect(gradePoints("Z")).toBeNull();
  });
});

describe("computeGpa (credit-weighted)", () => {
  it("returns null with no creditable units", () => {
    expect(computeGpa([])).toBeNull();
    expect(computeGpa([{ grade: "X", credits: 3 }])).toBeNull();
    expect(computeGpa([{ grade: "A", credits: 0 }])).toBeNull();
  });

  it("weights by credit-hours", () => {
    // A(4.0)*4 + C(2.0)*1 = 18 over 5 credits = 3.6
    expect(
      computeGpa([
        { grade: "A", credits: 4 },
        { grade: "C", credits: 1 },
      ]),
    ).toBe(3.6);
  });

  it("rounds to two decimals and skips unrecognized grades", () => {
    // B+(3.3)*3 + B-(2.7)*3 = 18 over 6 = 3.0; the bad row is ignored.
    expect(
      computeGpa([
        { grade: "B+", credits: 3 },
        { grade: "B-", credits: 3 },
        { grade: "??", credits: 3 },
      ]),
    ).toBe(3.0);
  });
});

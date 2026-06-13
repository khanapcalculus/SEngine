/**
 * Schema contract tests for Module 1 (Identity & Multi-Tenant Routing).
 *
 * These are structural/unit tests — they assert the schema's shape without
 * requiring a live database, so they run in CI and at the edge build step.
 * They guard the invariants other modules will depend on:
 *  - UUID primary keys (Guideline: UUID keys)
 *  - RBAC role enum values (Guideline #4: Security First)
 *  - Tenant-scoping + routing indexes exist (the 20+ educator routing path)
 *
 * Run: npx vitest run src/db/schema.test.ts
 */

import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  organizations,
  branches,
  users,
  staffProfiles,
  staffAssignments,
  classes,
  studentProfiles,
  studentPromotions,
  assignments,
  submissions,
  submissionFiles,
  discussionThreads,
  discussionPosts,
  userRoleEnum,
  globalStatusEnum,
  branchStatusEnum,
  staffStatusEnum,
  staffAssignmentRoleEnum,
  promotionOutcomeEnum,
  assignmentStatusEnum,
  submissionStatusEnum,
} from "./schema";

/** Helper: map a drizzle table's columns by name for easy assertions. */
function columnsOf(table: Parameters<typeof getTableConfig>[0]) {
  const cfg = getTableConfig(table);
  return Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
}

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((i) => i.config.name);
}

function fkTargets(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      column: ref.columns[0]?.name,
      foreignTable: getTableConfig(ref.foreignTable).name,
    };
  });
}

describe("enums", () => {
  it("user_role contains exactly the five RBAC roles", () => {
    expect(userRoleEnum.enumValues).toEqual([
      "super_admin",
      "branch_manager",
      "teacher",
      "student",
      "parent",
    ]);
  });

  it("status enums expose their lifecycle values", () => {
    expect(globalStatusEnum.enumValues).toContain("suspended");
    expect(branchStatusEnum.enumValues).toContain("active");
    expect(staffStatusEnum.enumValues).toEqual([
      "onboarding",
      "active",
      "on_leave",
      "retired",
      "terminated",
    ]);
    expect(staffAssignmentRoleEnum.enumValues).toEqual(["lead", "assistant"]);
    expect(promotionOutcomeEnum.enumValues).toEqual([
      "promoted",
      "retained",
      "graduated",
    ]);
    expect(assignmentStatusEnum.enumValues).toEqual([
      "draft",
      "published",
      "closed",
    ]);
    expect(submissionStatusEnum.enumValues).toEqual([
      "draft",
      "submitted",
      "graded",
    ]);
  });
});

describe("Module 4 — LMS schema", () => {
  it("assignments belong to a class and carry status + max points", () => {
    const cols = columnsOf(assignments);
    expect(cols.class_id.notNull).toBe(true);
    expect(cols.max_points.notNull).toBe(true);
    expect(cols.status.columnType).toBe("PgEnumColumn");
    expect(fkTargets(assignments)).toContainEqual({
      column: "class_id",
      foreignTable: "classes",
    });
    expect(indexNames(assignments)).toContain("assignments_class_status_idx");
  });

  it("submissions are unique per (assignment, student)", () => {
    const cols = columnsOf(submissions);
    expect(cols.assignment_id.notNull).toBe(true);
    expect(cols.student_id.notNull).toBe(true);
    expect(cols.points_awarded.notNull).toBe(false);
    const fks = fkTargets(submissions);
    expect(fks).toContainEqual({
      column: "assignment_id",
      foreignTable: "assignments",
    });
    expect(fks).toContainEqual({
      column: "student_id",
      foreignTable: "student_profiles",
    });
    expect(indexNames(submissions)).toContain(
      "submissions_assignment_student_idx",
    );
  });

  it("submission_files store metadata + a storage key (no blobs)", () => {
    const cols = columnsOf(submissionFiles);
    expect(cols.storage_key.notNull).toBe(true);
    expect(cols.url.notNull).toBe(true);
    expect(fkTargets(submissionFiles)).toContainEqual({
      column: "submission_id",
      foreignTable: "submissions",
    });
  });

  it("discussion threads reference a class with a NULLABLE assignment link", () => {
    const cols = columnsOf(discussionThreads);
    expect(cols.class_id.notNull).toBe(true);
    expect(cols.assignment_id.notNull).toBe(false);
    const fks = fkTargets(discussionThreads);
    expect(fks).toContainEqual({ column: "class_id", foreignTable: "classes" });
    expect(fks).toContainEqual({
      column: "assignment_id",
      foreignTable: "assignments",
    });
  });

  it("discussion posts self-reference for threading", () => {
    const cols = columnsOf(discussionPosts);
    expect(cols.thread_id.notNull).toBe(true);
    expect(cols.parent_post_id.notNull).toBe(false);
    const fks = fkTargets(discussionPosts);
    expect(fks).toContainEqual({
      column: "thread_id",
      foreignTable: "discussion_threads",
    });
    expect(fks).toContainEqual({
      column: "parent_post_id",
      foreignTable: "discussion_posts",
    });
  });
});

describe("organizations", () => {
  const cols = columnsOf(organizations);
  it("has a UUID primary key", () => {
    expect(cols.id.primary).toBe(true);
    expect(cols.id.dataType).toBe("string"); // drizzle maps uuid -> string
    expect(cols.id.columnType).toBe("PgUUID");
  });
  it("stores global settings as jsonb and a required name", () => {
    expect(cols.global_settings.columnType).toBe("PgJsonb");
    expect(cols.name.notNull).toBe(true);
  });
});

describe("branches", () => {
  const cols = columnsOf(branches);
  it("has UUID PK and a NOT NULL org_id", () => {
    expect(cols.id.columnType).toBe("PgUUID");
    expect(cols.org_id.notNull).toBe(true);
  });
  it("references organizations for tenant ownership", () => {
    expect(fkTargets(branches)).toContainEqual({
      column: "org_id",
      foreignTable: "organizations",
    });
  });
  it("indexes org_id for tenant-scoped listing", () => {
    expect(indexNames(branches)).toContain("branches_org_id_idx");
  });
});

describe("users", () => {
  const cols = columnsOf(users);
  it("has a NOT NULL role enum column", () => {
    expect(cols.role.notNull).toBe(true);
    expect(cols.role.columnType).toBe("PgEnumColumn");
  });
  it("enforces a unique email and an org/role lookup index", () => {
    const idx = indexNames(users);
    expect(idx).toContain("users_email_idx");
    expect(idx).toContain("users_org_role_idx");
  });
});

describe("staff_profiles (educator routing pivot)", () => {
  const cols = columnsOf(staffProfiles);
  it("links one profile per user and to a branch", () => {
    expect(cols.user_id.notNull).toBe(true);
    expect(cols.branch_id.notNull).toBe(true);
    const fks = fkTargets(staffProfiles);
    expect(fks).toContainEqual({ column: "user_id", foreignTable: "users" });
    expect(fks).toContainEqual({
      column: "branch_id",
      foreignTable: "branches",
    });
  });

  it("tracks the employment lifecycle (hire required, retirement nullable)", () => {
    expect(cols.hire_date.notNull).toBe(true);
    expect(cols.retirement_date.notNull).toBe(false);
  });

  it("has the (branch, department) index that powers roster routing", () => {
    const idx = indexNames(staffProfiles);
    expect(idx).toContain("staff_profiles_branch_dept_idx");
    expect(idx).toContain("staff_profiles_user_id_idx");
  });
});

describe("staff_assignments (assignment routing)", () => {
  const cols = columnsOf(staffAssignments);

  it("links a staff profile to a class with a NOT NULL role", () => {
    expect(cols.staff_id.notNull).toBe(true);
    expect(cols.class_id.notNull).toBe(true);
    expect(cols.role.notNull).toBe(true);
    expect(cols.role.columnType).toBe("PgEnumColumn");
  });

  it("references staff_profiles and classes", () => {
    const fks = fkTargets(staffAssignments);
    expect(fks).toContainEqual({
      column: "staff_id",
      foreignTable: "staff_profiles",
    });
    expect(fks).toContainEqual({
      column: "class_id",
      foreignTable: "classes",
    });
  });

  it("has the unique (staff, class) pairing + roster lookup indexes", () => {
    const idx = indexNames(staffAssignments);
    expect(idx).toContain("staff_assignments_staff_class_idx");
    expect(idx).toContain("staff_assignments_class_id_idx");
    expect(idx).toContain("staff_assignments_staff_id_idx");
  });
});

describe("Module 3 — academic progression schema", () => {
  it("classes carry NOT NULL credit-hours for GPA weighting", () => {
    const cols = columnsOf(classes);
    expect(cols.credits.notNull).toBe(true);
    expect(cols.credits.columnType).toBe("PgInteger");
  });

  it("student_profiles track a NOT NULL current_level", () => {
    const cols = columnsOf(studentProfiles);
    expect(cols.current_level.notNull).toBe(true);
    expect(cols.current_level.columnType).toBe("PgInteger");
  });

  describe("student_promotions (append-only progression history)", () => {
    const cols = columnsOf(studentPromotions);

    it("records the level transition + a nullable term GPA", () => {
      expect(cols.from_level.notNull).toBe(true);
      expect(cols.to_level.notNull).toBe(true);
      expect(cols.outcome.notNull).toBe(true);
      expect(cols.term_gpa.notNull).toBe(false);
    });

    it("references student_profiles and (nullable) the acting user", () => {
      const fks = fkTargets(studentPromotions);
      expect(fks).toContainEqual({
        column: "student_id",
        foreignTable: "student_profiles",
      });
      expect(fks).toContainEqual({ column: "actor_id", foreignTable: "users" });
    });

    it("indexes (student, created_at) for the transcript history feed", () => {
      expect(indexNames(studentPromotions)).toContain(
        "student_promotions_student_created_idx",
      );
    });
  });
});

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
  userRoleEnum,
  globalStatusEnum,
  branchStatusEnum,
  staffStatusEnum,
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

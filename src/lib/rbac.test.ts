/**
 * Unit tests for the role → route access matrix (the sidebar + middleware truth).
 * Run: npx vitest run src/lib/rbac.test.ts
 */
import { describe, it, expect } from "vitest";
import { NAV_ITEMS, canAccess, navItemForPath } from "./rbac";

const labelsFor = (role: string) =>
  NAV_ITEMS.filter((n) => canAccess(role, n.allowedRoles)).map((n) => n.label);

describe("canAccess", () => {
  it("permits listed roles and rejects others / undefined", () => {
    expect(canAccess("super_admin", ["super_admin"])).toBe(true);
    expect(canAccess("teacher", ["super_admin", "branch_manager"])).toBe(false);
    expect(canAccess(undefined, ["student"])).toBe(false);
  });
});

describe("nav matrix per role", () => {
  it("a teacher never sees HR, Org, Students, or Settings", () => {
    const t = labelsFor("teacher");
    expect(t).toContain("My Classes");
    expect(t).toContain("AI Tutor");
    expect(t).toContain("Whiteboard");
    expect(t).not.toContain("Staff (HR)");
    expect(t).not.toContain("Students");
    expect(t).not.toContain("Organizations");
    expect(t).not.toContain("Platform Settings");
  });

  it("a student only sees Overview, My Transcript, Whiteboard", () => {
    expect(labelsFor("student").sort()).toEqual(
      ["My Transcript", "Overview", "Whiteboard"].sort(),
    );
  });

  it("a branch_manager sees HR/Students/Gradebook but not Org/Settings", () => {
    const m = labelsFor("branch_manager");
    expect(m).toContain("Staff (HR)");
    expect(m).toContain("Students");
    expect(m).toContain("Gradebook");
    expect(m).not.toContain("Organizations");
    expect(m).not.toContain("Platform Settings");
    expect(m).not.toContain("My Classes");
  });

  it("super_admin sees Organizations + Platform Settings (and not teacher/student views)", () => {
    const s = labelsFor("super_admin");
    expect(s).toContain("Organizations");
    expect(s).toContain("Platform Settings");
    expect(s).not.toContain("My Classes");
    expect(s).not.toContain("My Transcript");
  });
});

describe("navItemForPath", () => {
  it("resolves exact and nested paths to the governing rule", () => {
    expect(navItemForPath("/dashboard/staff")?.label).toBe("Staff (HR)");
    expect(navItemForPath("/dashboard/staff/abc")?.label).toBe("Staff (HR)");
    expect(navItemForPath("/dashboard/organizations")?.label).toBe(
      "Organizations",
    );
    expect(navItemForPath("/dashboard")?.label).toBe("Overview");
  });
});

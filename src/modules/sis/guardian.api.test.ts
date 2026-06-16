/**
 * Tests for the Guardianships service — the authorization + validation logic
 * that gates the Parent portal. Focuses on the security-critical paths:
 * `assertGuardianOfStudent` (the read gate) and `linkGuardian` (manager link,
 * incl. branch scope, parent-role, and dedupe rules). The list helpers are thin
 * query wrappers and are exercised via the route/build checks.
 *
 * Run: npx vitest run src/modules/sis/guardian.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";
import { AuthError } from "../../lib/auth";
import { ValidationError } from "../../lib/validation";

/* ── Mock drizzle eq/and into marker clauses ────────────────────── */
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __col: col?.name, __val: val }),
    and: (...clauses: Array<{ __col?: string; __val?: unknown }>) => ({ __and: clauses }),
  };
});

import {
  assertGuardianOfStudent,
  linkGuardian,
} from "./guardian.service";

/* ── In-memory fake DB ──────────────────────────────────────────── */
interface Row {
  id: string;
  [k: string]: unknown;
}
interface FakeState {
  users: Row[];
  student_profiles: Row[];
  guardianships: Row[];
  audit_logs: Row[];
}
let state: FakeState;

type Clause =
  | { __col?: string; __val?: unknown }
  | { __and: Array<{ __col?: string; __val?: unknown }> };

function tableName(table: unknown): keyof FakeState {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return String((table as Record<symbol, unknown>)[sym!]) as keyof FakeState;
}

function matches(row: Row, clause: Clause): boolean {
  if ("__and" in clause) return clause.__and.every((c) => matches(row, c));
  const col = clause.__col;
  if (!col) return true;
  const key = col === "id" ? "id" : col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return row[key] === clause.__val || row[col] === clause.__val;
}

function makeFakeDb() {
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        let clause: Clause = {};
        const chain: any = {
          where: (c: Clause) => {
            clause = c;
            return chain;
          },
          limit: () => state[name].filter((r) => matches(r, clause)),
          then: (res: (v: Row[]) => void) =>
            res(state[name].filter((r) => matches(r, clause))),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        // Push immediately so callers that AWAIT values() (e.g. writeAudit, which
        // omits .returning()) still persist the row; .returning() just reads back.
        const name = tableName(table);
        const row: Row = { id: `${name}-${state[name].length + 1}`, ...vals };
        state[name].push(row);
        return {
          returning: () => [row],
          then: (res: (v: Row[]) => void) => res([row]),
        };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx as any;
}

const BRANCH = "11111111-1111-1111-1111-111111111111";
const OTHER_BRANCH = "99999999-9999-9999-9999-999999999999";

const SUPER_ADMIN: AuthContext = {
  userId: "sa-1",
  role: "super_admin",
  orgId: null,
  branchId: null,
};
const MANAGER: AuthContext = {
  userId: "bm-1",
  role: "branch_manager",
  orgId: "org-1",
  branchId: BRANCH,
};

beforeEach(() => {
  state = {
    users: [
      { id: "parent-1", email: "mom@example.com", fullName: "Mom", role: "parent" },
      { id: "teacher-1", email: "teach@example.com", fullName: "Teach", role: "teacher" },
    ],
    student_profiles: [{ id: "sp-1", userId: "su-1", branchId: BRANCH }],
    guardianships: [],
    audit_logs: [],
  };
});

describe("assertGuardianOfStudent", () => {
  it("passes when a guardianship row links parent → student", async () => {
    state.guardianships.push({ id: "g-1", parentUserId: "parent-1", studentProfileId: "sp-1" });
    await expect(
      assertGuardianOfStudent(makeFakeDb(), "parent-1", "sp-1"),
    ).resolves.toBeUndefined();
  });

  it("throws 403 when no link exists", async () => {
    await expect(
      assertGuardianOfStudent(makeFakeDb(), "parent-1", "sp-1"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("linkGuardian", () => {
  it("links an existing parent to a student and writes an audit row", async () => {
    const res = await linkGuardian(
      makeFakeDb(),
      { parentEmail: "mom@example.com", studentProfileId: "sp-1", relationship: "mother" },
      SUPER_ADMIN,
    );
    expect(res.parentUserId).toBe("parent-1");
    expect(res.relationship).toBe("mother");
    expect(state.guardianships).toHaveLength(1);
    expect(state.audit_logs).toHaveLength(1);
    expect(state.audit_logs[0].action).toBe("guardian.link");
  });

  it("rejects a missing student", async () => {
    await expect(
      linkGuardian(
        makeFakeDb(),
        { parentEmail: "mom@example.com", studentProfileId: "nope", relationship: "guardian" },
        SUPER_ADMIN,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an unknown parent email", async () => {
    await expect(
      linkGuardian(
        makeFakeDb(),
        { parentEmail: "ghost@example.com", studentProfileId: "sp-1", relationship: "guardian" },
        SUPER_ADMIN,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an account that is not a parent", async () => {
    await expect(
      linkGuardian(
        makeFakeDb(),
        { parentEmail: "teach@example.com", studentProfileId: "sp-1", relationship: "guardian" },
        SUPER_ADMIN,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a duplicate link", async () => {
    state.guardianships.push({ id: "g-1", parentUserId: "parent-1", studentProfileId: "sp-1" });
    await expect(
      linkGuardian(
        makeFakeDb(),
        { parentEmail: "mom@example.com", studentProfileId: "sp-1", relationship: "guardian" },
        SUPER_ADMIN,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces branch scope (manager from another branch is refused)", async () => {
    const outsider: AuthContext = { ...MANAGER, branchId: OTHER_BRANCH };
    await expect(
      linkGuardian(
        makeFakeDb(),
        { parentEmail: "mom@example.com", studentProfileId: "sp-1", relationship: "guardian" },
        outsider,
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

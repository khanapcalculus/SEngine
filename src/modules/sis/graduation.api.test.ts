/**
 * Tests for the Graduation service — graduating a student flips status, issues a
 * credential with a serial, and audits; the guards (already-graduated, branch
 * scope, missing student) hold. verifyCredential's read joins are exercised by
 * the build/route layer.
 *
 * Run: npx vitest run src/modules/sis/graduation.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";
import { AuthError } from "../../lib/auth";
import { ValidationError } from "../../lib/validation";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __col: col?.name, __val: val }),
    and: (...clauses: Array<{ __col?: string; __val?: unknown }>) => ({ __and: clauses }),
    desc: (col: unknown) => col,
  };
});

import { graduateStudent } from "./graduation.service";

interface Row { id: string; [k: string]: unknown }
interface FakeState {
  student_profiles: Row[];
  credentials: Row[];
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
          where: (c: Clause) => { clause = c; return chain; },
          orderBy: () => chain,
          limit: () => state[name].filter((r) => matches(r, clause)),
          then: (res: (v: Row[]) => void) => res(state[name].filter((r) => matches(r, clause))),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const name = tableName(table);
        const row: Row = { id: `${name}-${state[name].length + 1}`, ...vals };
        state[name].push(row);
        return { returning: () => [row], then: (res: (v: Row[]) => void) => res([row]) };
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (clause: Clause) => {
          const apply = () => {
            const name = tableName(table);
            const hit = state[name].filter((r) => matches(r, clause));
            hit.forEach((r) => Object.assign(r, vals));
            return hit;
          };
          return { returning: apply, then: (res: (v: Row[]) => void) => res(apply()) };
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx as any;
}

const BRANCH = "11111111-1111-1111-1111-111111111111";
const OTHER = "99999999-9999-9999-9999-999999999999";
const SUPER: AuthContext = { userId: "sa", role: "super_admin", orgId: null, branchId: null };
const MGR: AuthContext = { userId: "bm", role: "branch_manager", orgId: "o", branchId: BRANCH };

beforeEach(() => {
  state = {
    student_profiles: [{ id: "sp-1", branchId: BRANCH, status: "active" }],
    credentials: [],
    audit_logs: [],
  };
});

describe("graduateStudent", () => {
  it("flips status to graduated and issues a serial'd credential + audit", async () => {
    const r = await graduateStudent(
      makeFakeDb(),
      "sp-1",
      { title: "High School Diploma", issuedDate: "2026-06-15" },
      SUPER,
    );
    expect(r.title).toBe("High School Diploma");
    expect(r.serial).toMatch(/^SE-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(state.student_profiles[0].status).toBe("graduated");
    expect(state.student_profiles[0].graduationDate).toBe("2026-06-15");
    expect(state.credentials).toHaveLength(1);
    expect(state.audit_logs[0].action).toBe("student.graduate");
  });

  it("refuses to graduate an already-graduated student", async () => {
    state.student_profiles[0].status = "graduated";
    await expect(
      graduateStudent(makeFakeDb(), "sp-1", { title: "Diploma", issuedDate: "2026-06-15" }, SUPER),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces branch scope", async () => {
    await expect(
      graduateStudent(
        makeFakeDb(),
        "sp-1",
        { title: "Diploma", issuedDate: "2026-06-15" },
        { ...MGR, branchId: OTHER },
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("404s a missing student", async () => {
    await expect(
      graduateStudent(makeFakeDb(), "nope", { title: "Diploma", issuedDate: "2026-06-15" }, SUPER),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

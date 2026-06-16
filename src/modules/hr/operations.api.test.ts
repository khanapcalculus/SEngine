/**
 * Tests for the HR Operations service — attendance, payroll, and performance.
 * Covers the security-critical paths: branch-scope enforcement, the
 * server-side payroll net computation, the attendance upsert, and the payroll
 * paid-state transition. Auth/db are faked so the service logic runs without a
 * live database.
 *
 * Run: npx vitest run src/modules/hr/operations.api.test.ts
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

import {
  recordAttendance,
  createPayroll,
  markPayrollPaid,
  createReview,
} from "./operations.service";

interface Row { id: string; [k: string]: unknown }
interface FakeState {
  staff_profiles: Row[];
  staff_attendance: Row[];
  payroll_records: Row[];
  performance_reviews: Row[];
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
        where: (clause: Clause) => ({
          returning: () => {
            const name = tableName(table);
            const hit = state[name].filter((r) => matches(r, clause));
            hit.forEach((r) => Object.assign(r, vals));
            return hit;
          },
        }),
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
    staff_profiles: [{ id: "stf-1", branchId: BRANCH }],
    staff_attendance: [],
    payroll_records: [],
    performance_reviews: [],
    audit_logs: [],
  };
});

describe("recordAttendance", () => {
  it("inserts a new day and audits", async () => {
    const r = await recordAttendance(
      makeFakeDb(),
      { staffProfileId: "stf-1", date: "2026-06-15", status: "present" },
      SUPER,
    );
    expect(r.status).toBe("present");
    expect(state.staff_attendance).toHaveLength(1);
    expect(state.audit_logs[0].action).toBe("hr.attendance.record");
  });

  it("updates the existing record for the same day (no duplicate)", async () => {
    state.staff_attendance.push({ id: "att-1", staffId: "stf-1", date: "2026-06-15", status: "present" });
    const r = await recordAttendance(
      makeFakeDb(),
      { staffProfileId: "stf-1", date: "2026-06-15", status: "late" },
      SUPER,
    );
    expect(r.status).toBe("late");
    expect(state.staff_attendance).toHaveLength(1);
  });

  it("refuses a manager from another branch", async () => {
    await expect(
      recordAttendance(
        makeFakeDb(),
        { staffProfileId: "stf-1", date: "2026-06-15", status: "present" },
        { ...MGR, branchId: OTHER },
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("createPayroll", () => {
  it("computes net = gross − deductions server-side", async () => {
    const r = await createPayroll(
      makeFakeDb(),
      { staffProfileId: "stf-1", periodStart: "2026-06-01", periodEnd: "2026-06-30", grossAmount: 5000, deductions: 750 },
      SUPER,
    );
    expect(r.netAmount).toBe("4250.00");
    expect(r.grossAmount).toBe("5000.00");
    expect(state.audit_logs[0].action).toBe("hr.payroll.create");
  });

  it("rejects deductions exceeding gross", async () => {
    await expect(
      createPayroll(
        makeFakeDb(),
        { staffProfileId: "stf-1", periodStart: "2026-06-01", periodEnd: "2026-06-30", grossAmount: 100, deductions: 200 },
        SUPER,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("markPayrollPaid", () => {
  it("transitions a pending record to paid", async () => {
    state.payroll_records.push({ id: "pay-1", branchId: BRANCH, status: "pending" });
    const r = await markPayrollPaid(makeFakeDb(), "pay-1", SUPER);
    expect(r.status).toBe("paid");
    expect(state.payroll_records[0].paidAt).toBeInstanceOf(Date);
  });

  it("rejects an already-paid record", async () => {
    state.payroll_records.push({ id: "pay-1", branchId: BRANCH, status: "paid" });
    await expect(markPayrollPaid(makeFakeDb(), "pay-1", SUPER)).rejects.toBeInstanceOf(ValidationError);
  });

  it("404s a missing record", async () => {
    await expect(markPayrollPaid(makeFakeDb(), "nope", SUPER)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("createReview", () => {
  it("records a review with its rating and audits", async () => {
    const r = await createReview(
      makeFakeDb(),
      { staffProfileId: "stf-1", reviewDate: "2026-06-15", rating: 5, summary: "Excellent" },
      SUPER,
    );
    expect(r.rating).toBe(5);
    expect(state.performance_reviews).toHaveLength(1);
    expect(state.audit_logs[0].action).toBe("hr.review.create");
  });
});

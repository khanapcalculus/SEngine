/**
 * Tests for the automated payroll engine: the calculation (hours × rate − 15%),
 * the bulk run's idempotency (skip already-paid staff), and the transactional
 * ROLLBACK (a mid-run insert failure leaves NO partial payroll).
 *
 * Run: npx vitest run src/modules/hr/payroll.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __op: "eq", __col: col?.name, __val: val }),
    and: (...clauses: any[]) => ({ __and: clauses }),
    gte: (col: { name?: string }, val: unknown) => ({ __op: "gte", __col: col?.name, __val: val }),
    lt: (col: { name?: string }, val: unknown) => ({ __op: "lt", __col: col?.name, __val: val }),
  };
});

import { calculatePayroll, runPayroll, DEDUCTION_RATE } from "./payroll.service";

interface Row { id: string; [k: string]: unknown }
interface FakeState {
  staff_profiles: Row[];
  staff_assignments: Row[];
  class_sessions: Row[];
  payroll_records: Row[];
  audit_logs: Row[];
}
let state: FakeState;
let failOnStaff: string | null = null; // staffId whose payroll insert throws

function tableName(table: unknown): keyof FakeState {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) => s.toString().includes("Name"));
  return String((table as Record<symbol, unknown>)[sym!]) as keyof FakeState;
}
function clauseMatch(row: Row, clause: any): boolean {
  if (!clause) return true;
  if (clause.__and) return clause.__and.every((c: any) => clauseMatch(row, c));
  const key = clause.__col === "id" ? "id" : String(clause.__col ?? "").replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  if (clause.__op === "gte") return (row[key] as Date).getTime() >= (clause.__val as Date).getTime();
  if (clause.__op === "lt") return (row[key] as Date).getTime() < (clause.__val as Date).getTime();
  return row[key] === clause.__val;
}

function makeTx(working: FakeState) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        let clause: any = null;
        const chain: any = {
          innerJoin: () => chain, // sessions⋈assignments: the where carries staffId + time
          where: (c: any) => { clause = c; return chain; },
          limit: () => working[name].filter((r) => clauseMatch(r, clause)),
          then: (res: (v: Row[]) => void) => res(working[name].filter((r) => clauseMatch(r, clause))),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const name = tableName(table);
        if (name === "payroll_records" && failOnStaff && vals.staffId === failOnStaff) {
          throw new Error("ledger write failed");
        }
        const row: Row = { id: `${name}-${working[name].length + 1}`, ...vals };
        working[name].push(row);
        return { returning: () => [row], then: (res: (v: Row[]) => void) => res([row]) };
      },
    }),
  };
}
function makeDb() {
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const working: FakeState = structuredClone(state);
      const result = await fn(makeTx(working)); // throw → working discarded (rollback)
      state = working;
      return result;
    },
    // For calculatePayroll called standalone (no tx).
    select: () => makeTx(state).select(),
  } as any;
}

const BRANCH = "11111111-1111-1111-1111-111111111111";
const SUPER: AuthContext = { userId: "sa", role: "super_admin", orgId: null, branchId: null };
const P_START = "2026-06-01";
const P_END = "2026-07-01";

beforeEach(() => {
  failOnStaff = null;
  state = {
    staff_profiles: [
      { id: "t1", branchId: BRANCH, status: "active", baseRate: "40.00" },
      { id: "t2", branchId: BRANCH, status: "active", baseRate: "50.00" },
      { id: "t3", branchId: BRANCH, status: "retired", baseRate: "50.00" }, // inactive → skipped
    ],
    staff_assignments: [
      { id: "a1", staffId: "t1", classId: "cA" },
      { id: "a2", staffId: "t2", classId: "cB" },
    ],
    // staffId is denormalized here to stand in for the class_sessions ⋈
    // staff_assignments join (the real query joins on classId).
    class_sessions: [
      // t1: two 90-min sessions in June = 3.0h × 40 = 120 gross
      { id: "s1", classId: "cA", staffId: "t1", startsAt: new Date("2026-06-05T09:00:00Z"), durationMinutes: 90 },
      { id: "s2", classId: "cA", staffId: "t1", startsAt: new Date("2026-06-12T09:00:00Z"), durationMinutes: 90 },
      // t1 session OUTSIDE the period → excluded
      { id: "s3", classId: "cA", staffId: "t1", startsAt: new Date("2026-07-02T09:00:00Z"), durationMinutes: 90 },
      // t2: one 60-min session = 1.0h × 50 = 50 gross
      { id: "s4", classId: "cB", staffId: "t2", startsAt: new Date("2026-06-20T09:00:00Z"), durationMinutes: 60 },
    ],
    payroll_records: [],
    audit_logs: [],
  };
});

describe("calculatePayroll", () => {
  it("computes hours × rate − deductions from in-period sessions", async () => {
    const c = await calculatePayroll(makeDb(), "t1", P_START, P_END);
    expect(c.sessionsWorked).toBe(2);
    expect(c.hoursWorked).toBe(3);
    expect(c.gross).toBe(120);
    expect(c.deductions).toBe(round(120 * DEDUCTION_RATE)); // 18
    expect(c.netPay).toBe(102);
  });
});

describe("runPayroll", () => {
  it("creates one ledger row per ACTIVE staff and audits the run", async () => {
    const res = await runPayroll(makeDb(), BRANCH, P_START, P_END, SUPER);
    expect(res.created).toBe(2);        // t1 + t2 (t3 retired)
    expect(res.skipped).toBe(0);
    expect(res.totalNet).toBe(102 + round(50 * (1 - DEDUCTION_RATE))); // 102 + 42.5
    expect(state.payroll_records).toHaveLength(2);
    expect(state.audit_logs.some((a) => a.action === "hr.payroll.run")).toBe(true);
  });

  it("is idempotent: a second run for the same period skips already-paid staff", async () => {
    await runPayroll(makeDb(), BRANCH, P_START, P_END, SUPER);
    const res2 = await runPayroll(makeDb(), BRANCH, P_START, P_END, SUPER);
    expect(res2.created).toBe(0);
    expect(res2.skipped).toBe(2);
    expect(state.payroll_records).toHaveLength(2); // no duplicates
  });

  it("ROLLS BACK the entire run if one ledger insert fails (no partial payroll)", async () => {
    failOnStaff = "t2"; // second staff's insert throws mid-run
    await expect(runPayroll(makeDb(), BRANCH, P_START, P_END, SUPER)).rejects.toThrow(/ledger write failed/);
    expect(state.payroll_records).toHaveLength(0); // t1's row rolled back too
    expect(state.audit_logs).toHaveLength(0);
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }

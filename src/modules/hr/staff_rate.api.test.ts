/**
 * Tests for the staff hourly-rate path: parse validation + setStaffBaseRate
 * (branch-scoped, audited, persists the new rate).
 *
 * Run: npx vitest run src/modules/hr/staff_rate.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";
import { AuthError } from "../../lib/auth";
import { ValidationError, parseSetStaffRate, parseOnboardStaff } from "../../lib/validation";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __col: col?.name, __val: val }),
  };
});

import { setStaffBaseRate } from "./staff.service";

interface Row { id: string; [k: string]: unknown }
let state: { staff_profiles: Row[]; audit_logs: Row[] };

function tableName(table: unknown) {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) => s.toString().includes("Name"));
  return String((table as Record<symbol, unknown>)[sym!]);
}
function matches(row: Row, clause: any) {
  if (!clause?.__col) return true;
  const key = clause.__col === "id" ? "id" : String(clause.__col).replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  return row[key] === clause.__val;
}
function makeDb() {
  const tx = {
    select: () => ({
      from: (t: unknown) => {
        const name = tableName(t) as keyof typeof state;
        let clause: any = null;
        const chain: any = {
          where: (c: any) => { clause = c; return chain; },
          limit: () => state[name].filter((r) => matches(r, clause)),
        };
        return chain;
      },
    }),
    update: (t: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (clause: any) => {
          const name = tableName(t) as keyof typeof state;
          state[name].filter((r) => matches(r, clause)).forEach((r) => Object.assign(r, vals));
          return { then: (res: (v: unknown[]) => void) => res([]) };
        },
      }),
    }),
    insert: (t: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const name = tableName(t) as keyof typeof state;
        state[name].push({ id: `${name}-${state[name].length + 1}`, ...vals });
        return { then: (res: (v: unknown[]) => void) => res([]) };
      },
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
  state = { staff_profiles: [{ id: "stf-1", branchId: BRANCH, baseRate: "25.00" }], audit_logs: [] };
});

describe("parse validation", () => {
  it("parseSetStaffRate accepts a valid number and rejects junk", () => {
    expect(parseSetStaffRate({ baseRate: 42.5 })).toEqual({ baseRate: 42.5 });
    expect(() => parseSetStaffRate({})).toThrow(ValidationError);
    expect(() => parseSetStaffRate({ baseRate: -1 })).toThrow(ValidationError);
  });

  it("parseOnboardStaff makes baseRate optional but validates it when present", () => {
    const base = { email: "a@b.io", fullName: "A", branchId: BRANCH, orgId: BRANCH, department: "Math", hireDate: "2026-06-01" };
    expect(parseOnboardStaff(base).baseRate).toBeUndefined();
    expect(parseOnboardStaff({ ...base, baseRate: 30 }).baseRate).toBe(30);
    expect(() => parseOnboardStaff({ ...base, baseRate: 999999 })).toThrow(ValidationError);
  });
});

describe("setStaffBaseRate", () => {
  it("persists the new rate and writes an audit row", async () => {
    const r = await setStaffBaseRate(makeDb(), "stf-1", 55, SUPER);
    expect(r.baseRate).toBe("55.00");
    expect(state.staff_profiles[0].baseRate).toBe("55.00");
    expect(state.audit_logs[0].action).toBe("staff.rate.update");
  });

  it("refuses a manager from another branch", async () => {
    await expect(setStaffBaseRate(makeDb(), "stf-1", 55, { ...MGR, branchId: OTHER })).rejects.toBeInstanceOf(AuthError);
  });

  it("404s a missing staff profile", async () => {
    await expect(setStaffBaseRate(makeDb(), "nope", 55, SUPER)).rejects.toBeInstanceOf(ValidationError);
  });
});

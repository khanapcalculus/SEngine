/**
 * Tests for the two integrity mechanisms added for the due-diligence checklist:
 *  1. Tutor double-booking prevention in createSession (overlap → 409-style).
 *  2. The end-session composite transaction's ROLLBACK: when the payroll insert
 *     throws, the snapshot + attendance writes must not persist.
 *
 * Run: npx vitest run src/modules/lms/session_integrity.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";
import { ValidationError } from "../../lib/validation";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __op: "eq", __col: col?.name, __val: val }),
    ne: (col: { name?: string }, val: unknown) => ({ __op: "ne", __col: col?.name, __val: val }),
    and: (...clauses: any[]) => ({ __and: clauses }),
    inArray: (col: { name?: string }, vals: unknown[]) => ({ __op: "in", __col: col?.name, __vals: vals }),
    asc: (col: unknown) => col,
    gte: (col: unknown) => col,
  };
});

import { createSession } from "../sis/schedule.service";
import { endSession } from "./session_lifecycle.service";

interface Row { id: string; [k: string]: unknown }
interface FakeState {
  classes: Row[];
  class_sessions: Row[];
  staff_assignments: Row[];
  staff_profiles: Row[];
  staff_attendance: Row[];
  payroll_records: Row[];
  session_snapshots: Row[];
  audit_logs: Row[];
}
let state: FakeState;
/** When true, the payroll insert throws — to exercise rollback. */
let failPayroll = false;

function tableName(table: unknown): keyof FakeState {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) => s.toString().includes("Name"));
  return String((table as Record<symbol, unknown>)[sym!]) as keyof FakeState;
}
function clauseMatch(row: Row, clause: any): boolean {
  if (!clause) return true;
  if (clause.__and) return clause.__and.every((c: any) => clauseMatch(row, c));
  const key = clause.__col === "id" ? "id" : String(clause.__col ?? "").replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  if (clause.__op === "in") return clause.__vals.includes(row[key]);
  if (clause.__op === "ne") return row[key] !== clause.__val;
  return row[key] === clause.__val;
}

/** A working set committed only when the transaction callback resolves. */
function makeTx(working: FakeState) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        let clause: any = null;
        const chain: any = {
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
        if (name === "payroll_records" && failPayroll) {
          throw new Error("payroll upstream failure");
        }
        const row: Row = { id: `${name}-${working[name].length + 1}`, ...vals };
        working[name].push(row);
        return { returning: () => [row], then: (res: (v: Row[]) => void) => res([row]) };
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (clause: any) => {
          const name = tableName(table);
          const hit = working[name].filter((r) => clauseMatch(r, clause));
          hit.forEach((r) => Object.assign(r, vals));
          return { returning: () => hit, then: (res: (v: Row[]) => void) => res(hit) };
        },
      }),
    }),
  };
}

function makeDb() {
  return {
    // Snapshot the state, run the callback against the copy, commit on success.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const working: FakeState = structuredClone(state);
      const result = await fn(makeTx(working)); // throws → state NOT copied back (rollback)
      state = working; // commit
      return result;
    },
  } as any;
}

const BRANCH = "11111111-1111-1111-1111-111111111111";
const CLASS_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLASS_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SUPER: AuthContext = { userId: "sa", role: "super_admin", orgId: null, branchId: null };

beforeEach(() => {
  failPayroll = false;
  state = {
    classes: [
      { id: CLASS_A, branchId: BRANCH, subject: "Algebra" },
      { id: CLASS_B, branchId: BRANCH, subject: "Geometry" },
    ],
    class_sessions: [],
    staff_assignments: [
      // One tutor (stf-1) teaches BOTH classes → can clash across them.
      { id: "sa-1", staffId: "stf-1", classId: CLASS_A },
      { id: "sa-2", staffId: "stf-1", classId: CLASS_B },
    ],
    staff_profiles: [{ id: "stf-1", branchId: BRANCH, userId: "u-tutor" }],
    staff_attendance: [],
    payroll_records: [],
    session_snapshots: [],
    audit_logs: [],
  };
});

describe("tutor double-booking prevention", () => {
  it("allows a non-overlapping session", async () => {
    await createSession(
      makeDb(),
      { classId: CLASS_A, title: "AM", startsAt: "2026-06-20T09:00:00.000Z", durationMinutes: 60 },
      { userId: "sa", orgId: null },
    );
    // A later, non-overlapping session on the other class is fine.
    const ok = await createSession(
      makeDb(),
      { classId: CLASS_B, title: "PM", startsAt: "2026-06-20T11:00:00.000Z", durationMinutes: 60 },
      { userId: "sa", orgId: null },
    );
    expect(ok.classId).toBe(CLASS_B);
    expect(state.class_sessions).toHaveLength(2);
  });

  it("rejects an overlapping session for the same tutor on a different class", async () => {
    await createSession(
      makeDb(),
      { classId: CLASS_A, title: "AM", startsAt: "2026-06-20T09:00:00.000Z", durationMinutes: 60 },
      { userId: "sa", orgId: null },
    );
    // 09:30 on CLASS_B overlaps 09:00–10:00 on CLASS_A (same tutor stf-1).
    await expect(
      createSession(
        makeDb(),
        { classId: CLASS_B, title: "clash", startsAt: "2026-06-20T09:30:00.000Z", durationMinutes: 60 },
        { userId: "sa", orgId: null },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(state.class_sessions).toHaveLength(1); // the clashing insert did not commit
  });
});

describe("end-session composite transaction", () => {
  beforeEach(() => {
    state.class_sessions.push({
      id: "sess-1", classId: CLASS_A, branchId: BRANCH,
      startsAt: new Date("2026-06-20T09:00:00.000Z"),
    });
  });

  it("commits snapshot + attendance + payroll together on success", async () => {
    const r = await endSession(
      makeDb(),
      "sess-1",
      { snapshotUrl: "https://blob/s.png", snapshotKey: "s.png", payAmount: 120, staffProfileId: "stf-1" },
      SUPER,
    );
    expect(r.snapshotId).toBeDefined();
    expect(state.session_snapshots).toHaveLength(1);
    expect(state.staff_attendance).toHaveLength(1);
    expect(state.payroll_records).toHaveLength(1);
    expect(state.payroll_records[0].netAmount).toBe("120.00");
  });

  it("ROLLS BACK the snapshot + attendance when the payroll insert fails", async () => {
    failPayroll = true;
    await expect(
      endSession(
        makeDb(),
        "sess-1",
        { snapshotUrl: "https://blob/s.png", snapshotKey: "s.png", payAmount: 120, staffProfileId: "stf-1" },
        SUPER,
      ),
    ).rejects.toThrow(/payroll upstream failure/);

    // The whole transaction rolled back — nothing orphaned.
    expect(state.session_snapshots).toHaveLength(0);
    expect(state.staff_attendance).toHaveLength(0);
    expect(state.payroll_records).toHaveLength(0);
  });
});

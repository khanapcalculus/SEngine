/**
 * Tests for the HR documents service — metadata registration is branch-scoped
 * and audited.
 *
 * Run: npx vitest run src/modules/hr/documents.api.test.ts
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
    desc: (col: unknown) => col,
  };
});

import { recordStaffDocument } from "./documents.service";

interface Row { id: string; [k: string]: unknown }
interface FakeState { staff_profiles: Row[]; staff_documents: Row[]; audit_logs: Row[] }
let state: FakeState;

type Clause = { __col?: string; __val?: unknown };
function tableName(table: unknown): keyof FakeState {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) => s.toString().includes("Name"));
  return String((table as Record<symbol, unknown>)[sym!]) as keyof FakeState;
}
function matches(row: Row, clause: Clause): boolean {
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
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx as any;
}

const BRANCH = "11111111-1111-1111-1111-111111111111";
const OTHER = "99999999-9999-9999-9999-999999999999";
const SUPER: AuthContext = { userId: "sa", role: "super_admin", orgId: null, branchId: null };
const MGR: AuthContext = { userId: "bm", role: "branch_manager", orgId: "o", branchId: BRANCH };

beforeEach(() => {
  state = { staff_profiles: [{ id: "stf-1", branchId: BRANCH }], staff_documents: [], audit_logs: [] };
});

describe("recordStaffDocument", () => {
  it("stores metadata + audits", async () => {
    const r = await recordStaffDocument(
      makeFakeDb(),
      "stf-1",
      { fileName: "contract.pdf", url: "https://blob/contract.pdf", storageKey: "k", category: "contract" },
      SUPER,
    );
    expect(r.fileName).toBe("contract.pdf");
    expect(r.category).toBe("contract");
    expect(state.staff_documents).toHaveLength(1);
    expect(state.audit_logs[0].action).toBe("hr.document.add");
  });

  it("refuses a manager from another branch", async () => {
    await expect(
      recordStaffDocument(
        makeFakeDb(),
        "stf-1",
        { fileName: "x.pdf", url: "u", storageKey: "k" },
        { ...MGR, branchId: OTHER },
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("404s a missing staff member", async () => {
    await expect(
      recordStaffDocument(makeFakeDb(), "nope", { fileName: "x", url: "u", storageKey: "k" }, SUPER),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

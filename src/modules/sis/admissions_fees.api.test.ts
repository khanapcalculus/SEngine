/**
 * Tests for the Admissions funnel + Fees services. Covers the security/logic
 * that matters: branch scope, the application decision/enroll guards, and the
 * fee payment recomputation (partial → paid, overpayment + void rejections).
 *
 * Run: npx vitest run src/modules/sis/admissions_fees.api.test.ts
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

import { createApplication, decideApplication, enrollApplicant } from "./admissions.service";
import { createInvoice, recordPayment } from "./fees.service";

interface Row { id: string; [k: string]: unknown }
interface FakeState {
  branches: Row[];
  student_profiles: Row[];
  admission_applications: Row[];
  fee_invoices: Row[];
  fee_payments: Row[];
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
          then: (res: (v: Row[]) => void) => {
            const name = tableName(table);
            const hit = state[name].filter((r) => matches(r, clause));
            hit.forEach((r) => Object.assign(r, vals));
            res(hit);
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
    branches: [{ id: BRANCH, orgId: "o" }],
    student_profiles: [{ id: "sp-1", branchId: BRANCH }],
    admission_applications: [],
    fee_invoices: [],
    fee_payments: [],
    audit_logs: [],
  };
});

describe("admissions", () => {
  it("createApplication inserts + audits, respecting branch scope", async () => {
    const r = await createApplication(
      makeFakeDb(),
      { branchId: BRANCH, applicantName: "Ana", applicantEmail: "ana@x.io", cohortYear: 2027 },
      SUPER,
    );
    expect(r.applicantName).toBe("Ana");
    expect(state.admission_applications).toHaveLength(1);
    expect(state.audit_logs[0].action).toBe("admission.create");
  });

  it("createApplication refuses a manager from another branch", async () => {
    await expect(
      createApplication(
        makeFakeDb(),
        { branchId: BRANCH, applicantName: "Ana", applicantEmail: "ana@x.io", cohortYear: 2027 },
        { ...MGR, branchId: OTHER },
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("decideApplication moves status and blocks changing an enrolled app", async () => {
    state.admission_applications.push({ id: "app-1", branchId: BRANCH, status: "submitted" });
    const r = await decideApplication(makeFakeDb(), "app-1", { status: "accepted" }, SUPER);
    expect(r.status).toBe("accepted");

    state.admission_applications.push({ id: "app-2", branchId: BRANCH, status: "enrolled" });
    await expect(
      decideApplication(makeFakeDb(), "app-2", { status: "accepted" }, SUPER),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("enrollApplicant requires an accepted application", async () => {
    state.admission_applications.push({
      id: "app-3", branchId: BRANCH, status: "submitted",
      applicantName: "B", applicantEmail: "b@x.io", cohortYear: 2027,
    });
    await expect(
      enrollApplicant(makeFakeDb(), "app-3", { enrollmentDate: "2026-06-15" }, SUPER),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("fees", () => {
  it("createInvoice raises a charge + audits", async () => {
    const r = await createInvoice(
      makeFakeDb(),
      { studentProfileId: "sp-1", description: "Tuition", amountDue: 500 },
      SUPER,
    );
    expect(r.amountDue).toBe("500.00");
    expect(state.audit_logs[0].action).toBe("fee.invoice.create");
  });

  it("recordPayment goes unpaid → partial → paid and recomputes the balance", async () => {
    state.fee_invoices.push({
      id: "inv-1", branchId: BRANCH, amountDue: "100.00", amountPaid: "0", status: "unpaid",
    });
    const partial = await recordPayment(makeFakeDb(), "inv-1", { amount: 40 }, SUPER);
    expect(partial.status).toBe("partial");
    expect(partial.amountPaid).toBe("40.00");

    const paid = await recordPayment(makeFakeDb(), "inv-1", { amount: 60 }, SUPER);
    expect(paid.status).toBe("paid");
    expect(paid.amountPaid).toBe("100.00");
    expect(state.fee_payments).toHaveLength(2);
  });

  it("recordPayment rejects overpayment", async () => {
    state.fee_invoices.push({
      id: "inv-2", branchId: BRANCH, amountDue: "100.00", amountPaid: "0", status: "unpaid",
    });
    await expect(
      recordPayment(makeFakeDb(), "inv-2", { amount: 250 }, SUPER),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("recordPayment rejects a void invoice", async () => {
    state.fee_invoices.push({
      id: "inv-3", branchId: BRANCH, amountDue: "100.00", amountPaid: "0", status: "void",
    });
    await expect(
      recordPayment(makeFakeDb(), "inv-3", { amount: 10 }, SUPER),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

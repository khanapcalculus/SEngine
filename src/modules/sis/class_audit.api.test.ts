/**
 * Tests for the new dashboard backend: class management, student roster,
 * and the immutable audit trail.
 *
 * Uses an in-memory fake DB that records inserts into every table — including
 * audit_logs — so we can assert that mutations write the expected audit rows.
 *
 * Run: npx vitest run src/modules/sis/class_audit.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";
import { AuthError } from "../../lib/auth";

/* ── Mock auth ──────────────────────────────────────────────────── */
let currentCtx: AuthContext | AuthError;
vi.mock("../../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth")>();
  return {
    ...actual,
    getAuthContext: vi.fn(async () => {
      if (currentCtx instanceof actual.AuthError) throw currentCtx;
      return currentCtx;
    }),
  };
});

/* ── Mock drizzle-orm helpers into readable markers ─────────────── */
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __col: col?.name, __val: val }),
    and: (...cl: Array<{ __col?: string; __val?: unknown }>) => ({ __and: cl }),
    desc: (col: { name?: string }) => ({ __desc: col?.name }),
  };
});

/* ── In-memory fake DB ──────────────────────────────────────────── */
interface Row { id: string; [k: string]: unknown }
type State = Record<string, Row[]>;
let state: State;
let auditInsertError: Error | null;

function tableName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return String((table as Record<symbol, unknown>)[sym!]);
}

type Clause =
  | { __col?: string; __val?: unknown }
  | { __and: Array<{ __col?: string; __val?: unknown }> };

function matches(row: Row, clause: Clause): boolean {
  if ("__and" in clause) return clause.__and.every((c) => matches(row, c));
  const col = clause.__col;
  if (!col) return true;
  const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return row[camel] === clause.__val || row[col] === clause.__val;
}

function makeFakeDb() {
  const exec = {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        let clause: Clause = {};
        let joined = false;
        const resolve = (): Row[] => {
          const rows = state[name].filter((r) => matches(r, clause));
          // Emulate the student roster join+projection (student_profiles ⨝ users).
          if (name === "student_profiles" && joined) {
            return rows.map((s) => {
              const u = state.users.find((x) => x.id === s.userId) ?? ({} as Row);
              return {
                id: s.id,
                studentProfileId: s.id,
                userId: u.id,
                fullName: u.fullName,
                email: u.email,
                cohortYear: s.cohortYear,
                status: s.status,
              } as Row;
            });
          }
          return rows;
        };
        const chain: any = {
          where: (c: Clause) => ((clause = c), chain),
          innerJoin: () => ((joined = true), chain),
          orderBy: () => chain,
          limit: () => resolve(),
          then: (res: (v: Row[]) => void) => res(resolve()),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const name = tableName(table);
        if (name === "audit_logs" && auditInsertError) {
          throw auditInsertError;
        }
        (state[name] ||= []).push({
          id: `${name}-${state[name].length + 1}`,
          ...vals,
        });
        const last = state[name][state[name].length - 1];
        return {
          // Return the full inserted row so callers reading any projected
          // column (subject, term, email, …) see real values.
          returning: () => [last],
          then: (res: (v: unknown) => void) => res(undefined),
        };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(exec),
  };
  return exec;
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));

/* ── Fixtures ───────────────────────────────────────────────────── */
const ORG = "22222222-2222-2222-2222-222222222222";
const BRANCH = "11111111-1111-1111-1111-111111111111";
const OTHER_BRANCH = "99999999-9999-9999-9999-999999999999";
const SUPER_ADMIN: AuthContext = { userId: "sa-1", role: "super_admin", orgId: ORG, branchId: BRANCH };
const BRANCH_MGR: AuthContext = {
  userId: "bm-1",
  role: "branch_manager",
  orgId: ORG,
  branchId: BRANCH,
};
const TEACHER: AuthContext = { userId: "t-1", role: "teacher", orgId: ORG, branchId: BRANCH };

function post(body: unknown): Request {
  return new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  state = {
    users: [],
    staff_profiles: [],
    student_profiles: [],
    classes: [],
    enrollments: [],
    audit_logs: [],
  };
  auditInsertError = null;
});

/* ── Class creation ─────────────────────────────────────────────── */
describe("POST /api/classes/create", () => {
  const body = { subject: "Algebra 2", term: "Fall 2026", branchId: BRANCH };

  it("401 unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/classes/create/route");
    expect((await POST(post(body))).status).toBe(401);
  });

  it("403 for a teacher (only admins/managers create classes)", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/classes/create/route");
    expect((await POST(post(body))).status).toBe(403);
  });

  it("400 on missing subject", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/classes/create/route");
    const res = await POST(post({ term: "Fall 2026", branchId: BRANCH }));
    expect(res.status).toBe(400);
  });

  it("403 when branch_manager creates a class in another branch", async () => {
    currentCtx = BRANCH_MGR;
    const { POST } = await import("../../app/api/classes/create/route");
    const res = await POST(post({ ...body, branchId: OTHER_BRANCH }));
    expect(res.status).toBe(403);
  });

  it("201 creates the class AND writes an audit row", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/classes/create/route");
    const res = await POST(post(body));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.subject).toBe("Algebra 2");
    // class persisted
    expect(state.classes).toHaveLength(1);
    // audit trail recorded
    expect(state.audit_logs).toHaveLength(1);
    expect(state.audit_logs[0].action).toBe("class.create");
    expect(state.audit_logs[0].actorId).toBe("sa-1");
    expect(state.audit_logs[0].branchId).toBe(BRANCH);
  });

  it("500 with actionable message when the audit table is missing", async () => {
    currentCtx = SUPER_ADMIN;
    auditInsertError = Object.assign(
      new Error('relation "audit_logs" does not exist'),
      { code: "42P01" },
    );
    const { POST } = await import("../../app/api/classes/create/route");
    const res = await POST(post(body));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(
      "Database schema is out of date. Apply the latest migrations and redeploy.",
    );
  });
});

/* ── Class listing ──────────────────────────────────────────────── */
describe("GET /api/classes/branch/[branchId]", () => {
  it("200 lists classes for the branch", async () => {
    currentCtx = TEACHER;
    state.classes.push(
      { id: "c1", branchId: BRANCH, subject: "Algebra 2", term: "Fall" },
      { id: "c2", branchId: "other", subject: "Chem", term: "Fall" },
    );
    const { GET } = await import("../../app/api/classes/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId: BRANCH }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.classes[0].subject).toBe("Algebra 2");
  });

  it("400 on non-UUID branchId", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/classes/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("403 when a teacher requests classes for another branch", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/classes/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId: OTHER_BRANCH }),
    });
    expect(res.status).toBe(403);
  });
});

/* ── Student roster ─────────────────────────────────────────────── */
describe("GET /api/students/branch/[branchId]", () => {
  it("200 returns active students only", async () => {
    currentCtx = SUPER_ADMIN;
    state.users.push(
      { id: "u1", fullName: "Raj Patel", email: "raj@s.edu" },
      { id: "u2", fullName: "Gone Grad", email: "grad@s.edu" },
    );
    state.student_profiles.push(
      { id: "sp1", userId: "u1", branchId: BRANCH, cohortYear: 2030, status: "active" },
      { id: "sp2", userId: "u2", branchId: BRANCH, cohortYear: 2026, status: "graduated" },
    );
    const { GET } = await import("../../app/api/students/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId: BRANCH }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.students[0].fullName).toBe("Raj Patel");
  });

  it("403 when a teacher requests another branch's students", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/students/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId: OTHER_BRANCH }),
    });
    expect(res.status).toBe(403);
  });
});

/* ── Audit feed RBAC ────────────────────────────────────────────── */
describe("GET /api/audit/branch/[branchId]", () => {
  it("403 for a teacher (audit is admin/manager only)", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/audit/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId: BRANCH }),
    });
    expect(res.status).toBe(403);
  });

  it("200 returns the branch audit feed for an admin", async () => {
    currentCtx = SUPER_ADMIN;
    state.audit_logs.push({
      id: "a1", branchId: BRANCH, action: "staff.onboard",
      entityType: "staff_profile", summary: "Onboarded X", createdAt: new Date(0),
    });
    const { GET } = await import("../../app/api/audit/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId: BRANCH }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });

  it("403 when a branch_manager requests another branch's audit feed", async () => {
    currentCtx = BRANCH_MGR;
    const { GET } = await import("../../app/api/audit/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId: OTHER_BRANCH }),
    });
    expect(res.status).toBe(403);
  });
});

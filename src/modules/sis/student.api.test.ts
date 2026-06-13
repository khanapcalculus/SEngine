/**
 * API tests for Module 3 (SIS Lifecycle) endpoints.
 *
 * Scenario: branch "Lincoln High" runs an Algebra 2 section (taught by staff
 * member Meghan Meyer). We enroll a new student, Raj Patel, then assign him to
 * the Algebra 2 class. Auth + db are mocked so the full route -> RBAC ->
 * validation -> service path runs without a live database.
 *
 * Run: npx vitest run src/modules/sis/student.api.test.ts
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

/* ── Mock drizzle-orm eq/and into readable marker clauses ───────── */
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({
      __col: col?.name,
      __val: val,
    }),
    and: (...clauses: Array<{ __col?: string; __val?: unknown }>) => ({
      __and: clauses,
    }),
  };
});

/* ── In-memory fake DB ──────────────────────────────────────────── */
interface Row {
  id: string;
  [k: string]: unknown;
}
interface FakeState {
  users: Row[];
  student_profiles: Row[];
  classes: Row[];
  enrollments: Row[];
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
  // map snake_case column -> our camelCase row keys where needed
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
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          const name = tableName(table);
          const row: Row = { id: `${name}-${state[name].length + 1}`, ...vals };
          state[name].push(row);
          return [{ id: row.id, email: row.email }];
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx;
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));

/* ── Fixtures (realistic scenario) ──────────────────────────────── */
const ORG = "22222222-2222-2222-2222-222222222222";
const BRANCH = "11111111-1111-1111-1111-111111111111";
const OTHER_BRANCH = "99999999-9999-9999-9999-999999999999";

const SUPER_ADMIN: AuthContext = {
  userId: "sa-1",
  role: "super_admin",
  orgId: null,
  branchId: null,
};
const BRANCH_MGR: AuthContext = {
  userId: "bm-1",
  role: "branch_manager",
  orgId: ORG,
  branchId: BRANCH,
};
const TEACHER: AuthContext = {
  userId: "meghan",
  role: "teacher",
  orgId: ORG,
  branchId: BRANCH,
};
const PARENT: AuthContext = {
  userId: "p-1",
  role: "parent",
  orgId: ORG,
  branchId: BRANCH,
};

const RAJ = {
  email: "raj.patel@lincolnhigh.edu",
  fullName: "Raj Patel",
  branchId: BRANCH,
  orgId: ORG,
  enrollmentDate: "2026-08-20",
  cohortYear: 2030,
};

function req(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  state = { users: [], student_profiles: [], classes: [], enrollments: [] };
});

/* ── POST /api/students/enroll ──────────────────────────────────── */
describe("POST /api/students/enroll", () => {
  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/students/enroll/route");
    expect((await POST(req("http://x", RAJ))).status).toBe(401);
  });

  it("403 when a parent attempts enrollment (RBAC)", async () => {
    currentCtx = PARENT;
    const { POST } = await import("../../app/api/students/enroll/route");
    expect((await POST(req("http://x", RAJ))).status).toBe(403);
  });

  it("400 on invalid cohortYear", async () => {
    currentCtx = BRANCH_MGR;
    const { POST } = await import("../../app/api/students/enroll/route");
    const res = await POST(req("http://x", { ...RAJ, cohortYear: "soon" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.cohortYear).toBeDefined();
  });

  it("403 when branch_manager enrolls outside their org", async () => {
    currentCtx = BRANCH_MGR;
    const { POST } = await import("../../app/api/students/enroll/route");
    const res = await POST(
      req("http://x", { ...RAJ, orgId: "33333333-3333-3333-3333-333333333333" }),
    );
    expect(res.status).toBe(403);
  });

  it("403 when branch_manager enrolls into another branch", async () => {
    currentCtx = BRANCH_MGR;
    const { POST } = await import("../../app/api/students/enroll/route");
    const res = await POST(
      req("http://x", {
        ...RAJ,
        branchId: OTHER_BRANCH,
      }),
    );
    expect(res.status).toBe(403);
  });

  it("201 enrolls Raj Patel as a student", async () => {
    currentCtx = BRANCH_MGR;
    const { POST } = await import("../../app/api/students/enroll/route");
    const res = await POST(req("http://x", RAJ));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.studentProfileId).toBeTruthy();
    expect(data.cohortYear).toBe(2030);
    expect(state.users[0].role).toBe("student");
    expect(state.users[0].fullName).toBe("Raj Patel");
  });

  it("400 on duplicate email", async () => {
    currentCtx = BRANCH_MGR;
    state.users.push({ id: "u0", email: RAJ.email });
    const { POST } = await import("../../app/api/students/enroll/route");
    const res = await POST(req("http://x", RAJ));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.email).toBe("already in use");
  });
});

/* ── POST /api/classes/assign ───────────────────────────────────── */
describe("POST /api/classes/assign", () => {
  const studentId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const classId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  function seedRajAndAlgebra2() {
    // Raj already enrolled as a student profile at Lincoln High.
    state.student_profiles.push({
      id: studentId,
      userId: "u-raj",
      branchId: BRANCH,
      status: "active",
    });
    // Algebra 2, taught by Meghan Meyer, same branch.
    state.classes.push({
      id: classId,
      branchId: BRANCH,
      subject: "Algebra 2",
      term: "Fall 2026",
    });
  }

  it("403 when a student tries to self-assign (RBAC)", async () => {
    currentCtx = {
      userId: "u-raj",
      role: "student",
      orgId: ORG,
      branchId: BRANCH,
    };
    seedRajAndAlgebra2();
    const { POST } = await import("../../app/api/classes/assign/route");
    const res = await POST(req("http://x", { studentId, classId }));
    expect(res.status).toBe(403);
  });

  it("400 on non-UUID ids", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/classes/assign/route");
    const res = await POST(req("http://x", { studentId: "x", classId: "y" }));
    expect(res.status).toBe(400);
  });

  it("400 when the class does not exist", async () => {
    currentCtx = TEACHER;
    state.student_profiles.push({ id: studentId, branchId: BRANCH });
    const { POST } = await import("../../app/api/classes/assign/route");
    const res = await POST(req("http://x", { studentId, classId }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.classId).toBe("no such class");
  });

  it("400 on cross-branch assignment", async () => {
    currentCtx = TEACHER;
    state.student_profiles.push({ id: studentId, branchId: BRANCH });
    state.classes.push({ id: classId, branchId: OTHER_BRANCH, subject: "Algebra 2" });
    const { POST } = await import("../../app/api/classes/assign/route");
    const res = await POST(req("http://x", { studentId, classId }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.classId).toBe("branch mismatch");
  });

  it("201 assigns Raj to Meghan Meyer's Algebra 2", async () => {
    currentCtx = TEACHER;
    seedRajAndAlgebra2();
    const { POST } = await import("../../app/api/classes/assign/route");
    const res = await POST(req("http://x", { studentId, classId }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.enrollmentId).toBeTruthy();
    expect(state.enrollments).toHaveLength(1);
  });

  it("400 when Raj is already enrolled in that class", async () => {
    currentCtx = TEACHER;
    seedRajAndAlgebra2();
    state.enrollments.push({ id: "e0", studentId, classId });
    const { POST } = await import("../../app/api/classes/assign/route");
    const res = await POST(req("http://x", { studentId, classId }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.classId).toBe("already enrolled");
  });
});

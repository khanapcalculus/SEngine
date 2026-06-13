/**
 * API tests for Module 4 assignments: create / list / status.
 * Verifies class-membership RBAC, staff-only mutations, and student
 * draft-invisibility. Fake-DB style of the other module tests.
 *
 * Run: npx vitest run src/modules/lms/assignment.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";
import { AuthError } from "../../lib/auth";

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

interface FakeState {
  classes: any[];
  staff_profiles: any[];
  staff_assignments: any[];
  student_profiles: any[];
  enrollments: any[];
  assignments: any[];
  audit_logs: any[];
}
let state: FakeState;

function tableName(t: unknown): string {
  const sym = Object.getOwnPropertySymbols(t as object).find((s) =>
    s.toString().includes("Name"),
  );
  return sym ? String((t as Record<symbol, unknown>)[sym]) : "";
}
function valOf(clause: any, col: string): any {
  if (!clause) return undefined;
  if (clause.__and) return clause.__and.find((c: any) => c.__col === col)?.__val;
  return clause.__col === col ? clause.__val : undefined;
}

function makeFakeDb() {
  function builder() {
    const ctx = { table: "", clause: null as any, joins: [] as string[] };
    const chain: any = {
      from: (t: unknown) => ((ctx.table = tableName(t)), chain),
      innerJoin: (t: unknown) => (ctx.joins.push(tableName(t)), chain),
      where: (c: any) => ((ctx.clause = c), chain),
      orderBy: () => resolve(ctx),
      limit: () => resolve(ctx),
      then: (r: (v: unknown[]) => void) => r(resolve(ctx)),
    };
    return chain;
  }

  function resolve(ctx: { table: string; clause: any; joins: string[] }): unknown[] {
    const { table, clause, joins } = ctx;
    if (table === "classes") {
      const id = valOf(clause, "id");
      return state.classes
        .filter((c) => c.id === id)
        .map((c) => ({ id: c.id, branchId: c.branchId }));
    }
    if (table === "staff_assignments" && joins.includes("staff_profiles")) {
      const classId = valOf(clause, "class_id");
      const userId = valOf(clause, "user_id");
      return state.staff_assignments
        .filter((a) => {
          const sp = state.staff_profiles.find((x) => x.id === a.staffId);
          return a.classId === classId && sp?.userId === userId;
        })
        .map((a) => ({ id: a.id }));
    }
    if (table === "enrollments" && joins.includes("student_profiles")) {
      const classId = valOf(clause, "class_id");
      const userId = valOf(clause, "user_id");
      return state.enrollments
        .filter((e) => {
          const sp = state.student_profiles.find((x) => x.id === e.studentId);
          return e.classId === classId && sp?.userId === userId;
        })
        .map((e) => ({ id: e.id }));
    }
    if (table === "assignments") {
      const id = valOf(clause, "id");
      if (id) return state.assignments.filter((a) => a.id === id);
      const classId = valOf(clause, "class_id");
      return state.assignments.filter((a) => a.classId === classId);
    }
    return [];
  }

  const exec: any = {
    select: () => builder(),
    insert: (t: unknown) => ({
      values: (vals: Record<string, any>) => ({
        returning: () => {
          const name = tableName(t) as keyof FakeState;
          const row = {
            id: `${name}-${state[name].length + 1}`,
            description: null,
            dueDate: null,
            createdAt: new Date(0),
            ...vals,
          };
          state[name].push(row);
          return [row];
        },
        then: (r: (v: unknown) => void) => r(undefined),
      }),
    }),
    update: (t: unknown) => ({
      set: (vals: Record<string, any>) => ({
        where: (clause: any) => ({
          returning: () => {
            const name = tableName(t) as keyof FakeState;
            const id = valOf(clause, "id");
            const row = state[name].find((r: any) => r.id === id);
            if (row) Object.assign(row, vals);
            return row ? [row] : [];
          },
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(exec),
  };
  return exec;
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __col: col?.name, __val: val }),
    and: (...c: unknown[]) => ({ __and: c }),
    desc: (col: { name?: string }) => ({ __desc: col?.name }),
  };
});

const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "22222222-2222-2222-2222-222222222222";
const CLASS = "c1111111-1111-1111-1111-111111111111";

const SUPER: AuthContext = { userId: "sa", role: "super_admin", orgId: null, branchId: null };
const MGR_A: AuthContext = { userId: "bm", role: "branch_manager", orgId: "o", branchId: BRANCH_A };
const MGR_B: AuthContext = { userId: "bm2", role: "branch_manager", orgId: "o", branchId: BRANCH_B };
const TEACHER: AuthContext = { userId: "u-teach", role: "teacher", orgId: "o", branchId: BRANCH_A };
const TEACHER2: AuthContext = { userId: "u-teach2", role: "teacher", orgId: "o", branchId: BRANCH_A };
const STUDENT: AuthContext = { userId: "u-stu", role: "student", orgId: "o", branchId: BRANCH_A };

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  state = {
    classes: [{ id: CLASS, branchId: BRANCH_A }],
    staff_profiles: [{ id: "sp-t", userId: "u-teach", branchId: BRANCH_A }],
    staff_assignments: [{ id: "asg-1", staffId: "sp-t", classId: CLASS, role: "lead" }],
    student_profiles: [{ id: "sp-s", userId: "u-stu", branchId: BRANCH_A }],
    enrollments: [{ id: "e-1", studentId: "sp-s", classId: CLASS }],
    assignments: [],
    audit_logs: [],
  };
  vi.resetModules();
});

describe("POST /api/assignments", () => {
  const url = "http://x/api/assignments";
  const body = { classId: CLASS, title: "Essay 1", maxPoints: 50 };

  it("401 unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/assignments/route");
    expect((await POST(post(url, body))).status).toBe(401);
  });
  it("403 for a student (staff-only)", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/assignments/route");
    expect((await POST(post(url, body))).status).toBe(403);
  });
  it("403 for a teacher not assigned to the class", async () => {
    currentCtx = TEACHER2;
    const { POST } = await import("../../app/api/assignments/route");
    expect((await POST(post(url, body))).status).toBe(403);
  });
  it("403 for a manager in another branch", async () => {
    currentCtx = MGR_B;
    const { POST } = await import("../../app/api/assignments/route");
    expect((await POST(post(url, body))).status).toBe(403);
  });
  it("400 on invalid body", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/assignments/route");
    expect((await POST(post(url, { classId: "nope", title: "x" }))).status).toBe(400);
  });
  it("201 when an assigned teacher creates it (status draft)", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/assignments/route");
    const res = await POST(post(url, body));
    expect(res.status).toBe(201);
    const d = await res.json();
    expect(d.status).toBe("draft");
    expect(state.assignments).toHaveLength(1);
  });
  it("201 for a super_admin", async () => {
    currentCtx = SUPER;
    const { POST } = await import("../../app/api/assignments/route");
    expect((await POST(post(url, body))).status).toBe(201);
  });
});

describe("GET /api/assignments/class/[classId]", () => {
  beforeEach(() => {
    state.assignments.push(
      { id: "a-draft", classId: CLASS, title: "Draft", status: "draft", maxPoints: 100, description: null, dueDate: null, createdAt: new Date(0) },
      { id: "a-pub", classId: CLASS, title: "Pub", status: "published", maxPoints: 100, description: null, dueDate: null, createdAt: new Date(0) },
    );
  });
  it("403 for a non-member student", async () => {
    currentCtx = { userId: "u-nobody", role: "student", orgId: "o", branchId: BRANCH_A };
    const { GET } = await import("../../app/api/assignments/class/[classId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ classId: CLASS }) });
    expect(res.status).toBe(403);
  });
  it("200 a member student sees only published", async () => {
    currentCtx = STUDENT;
    const { GET } = await import("../../app/api/assignments/class/[classId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ classId: CLASS }) });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.count).toBe(1);
    expect(d.assignments[0].status).toBe("published");
  });
  it("200 staff see all statuses", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/assignments/class/[classId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ classId: CLASS }) });
    expect((await res.json()).count).toBe(2);
  });
});

describe("POST /api/assignments/[assignmentId]/status", () => {
  const ASSIGN = "a1111111-1111-1111-1111-111111111111";
  beforeEach(() => {
    state.assignments.push({
      id: ASSIGN, classId: CLASS, title: "T", status: "draft", maxPoints: 100,
      description: null, dueDate: null, createdAt: new Date(0),
    });
  });
  it("200 an assigned teacher publishes", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/assignments/[assignmentId]/status/route");
    const res = await POST(post("http://x", { status: "published" }), {
      params: Promise.resolve({ assignmentId: ASSIGN }),
    });
    expect(res.status).toBe(200);
    expect(state.assignments[0].status).toBe("published");
  });
  it("400 on an invalid status", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/assignments/[assignmentId]/status/route");
    const res = await POST(post("http://x", { status: "haunted" }), {
      params: Promise.resolve({ assignmentId: ASSIGN }),
    });
    expect(res.status).toBe(400);
  });
  it("403 for a student", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/assignments/[assignmentId]/status/route");
    const res = await POST(post("http://x", { status: "closed" }), {
      params: Promise.resolve({ assignmentId: ASSIGN }),
    });
    expect(res.status).toBe(403);
  });
});

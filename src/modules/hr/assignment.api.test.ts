/**
 * API tests for Module 2 assignment routing:
 *   POST /api/staff/assign
 *   POST /api/staff/unassign
 *   GET  /api/staff/assignments/branch/[branchId]
 *
 * Mocks the auth context (RBAC) and the db client (an in-memory fake of the
 * Drizzle query shapes the service uses). No live database required.
 *
 * Run: npx vitest run src/modules/hr/assignment.api.test.ts
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

/* ── In-memory fake db ──────────────────────────────────────────── */
interface FakeState {
  users: Array<Record<string, any>>;
  staff: Array<Record<string, any>>;
  classes: Array<Record<string, any>>;
  assignments: Array<Record<string, any>>;
}
let state: FakeState;

function tableName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return sym ? String((table as Record<symbol, unknown>)[sym]) : "";
}

/** Pull a column's value out of an eq() / and() clause marker. */
function valOf(
  clause: { __col?: string; __val?: any; __and?: Array<{ __col?: string; __val?: any }> } | null,
  col: string,
): any {
  if (!clause) return undefined;
  if (clause.__and) return clause.__and.find((c) => c.__col === col)?.__val;
  return clause.__col === col ? clause.__val : undefined;
}

function makeFakeDb() {
  function selectBuilder() {
    const ctx = { table: "", clause: null as any, joins: [] as string[] };
    const chain: any = {
      from: (t: unknown) => ((ctx.table = tableName(t)), chain),
      innerJoin: (t: unknown) => (ctx.joins.push(tableName(t)), chain),
      where: (c: any) => ((ctx.clause = c), chain),
      limit: () => resolve(ctx),
      orderBy: () => resolve(ctx),
      then: (res: (v: unknown[]) => void) => res(resolve(ctx)),
    };
    return chain;
  }

  function resolve(ctx: { table: string; clause: any; joins: string[] }): unknown[] {
    const { table, clause, joins } = ctx;

    if (table === "staff_profiles" && joins.length === 0) {
      const id = valOf(clause, "id");
      return state.staff
        .filter((s) => s.id === id)
        .map((s) => ({ id: s.id, branchId: s.branchId, status: s.status }));
    }

    if (table === "classes" && joins.length === 0) {
      const id = valOf(clause, "id");
      return state.classes
        .filter((c) => c.id === id)
        .map((c) => ({ id: c.id, branchId: c.branchId }));
    }

    if (table === "staff_assignments" && joins.length === 0) {
      const staffId = valOf(clause, "staff_id");
      const classId = valOf(clause, "class_id");
      const role = valOf(clause, "role");
      if (staffId && classId) {
        return state.assignments
          .filter((a) => a.staffId === staffId && a.classId === classId)
          .map((a) => ({ id: a.id }));
      }
      if (classId && role) {
        return state.assignments
          .filter((a) => a.classId === classId && a.role === role)
          .map((a) => ({ id: a.id }));
      }
      return [];
    }

    if (table === "staff_assignments" && joins.includes("users")) {
      const branchId = valOf(clause, "branch_id");
      return state.assignments
        .filter((a) => {
          const c = state.classes.find((x) => x.id === a.classId);
          return c && c.branchId === branchId;
        })
        .map((a) => {
          const sp = state.staff.find((x) => x.id === a.staffId);
          const u = state.users.find((x) => x.id === sp?.userId) ?? {};
          return {
            assignmentId: a.id,
            classId: a.classId,
            staffProfileId: a.staffId,
            fullName: u.fullName,
            email: u.email,
            department: sp?.department,
            role: a.role,
          };
        });
    }

    if (table === "staff_assignments" && joins.includes("classes")) {
      const id = valOf(clause, "id");
      const a = state.assignments.find((x) => x.id === id);
      if (!a) return [];
      const c = state.classes.find((x) => x.id === a.classId);
      return [{ id: a.id, classId: a.classId, staffId: a.staffId, branchId: c?.branchId }];
    }

    return [];
  }

  const exec: any = {
    select: () => selectBuilder(),
    insert: (table: unknown) => ({
      values: (vals: Record<string, any>) => ({
        returning: () => {
          if (tableName(table) === "staff_assignments") {
            const row = { id: `asg-${state.assignments.length + 1}`, ...vals };
            state.assignments.push(row);
            return [row];
          }
          return [{ id: "audit" }];
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (clause: any) => {
        if (tableName(table) === "staff_assignments") {
          const id = valOf(clause, "id");
          state.assignments = state.assignments.filter((a) => a.id !== id);
        }
        return Promise.resolve();
      },
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
    and: (...clauses: unknown[]) => ({ __and: clauses }),
  };
});

/* ── Fixtures ───────────────────────────────────────────────────── */
const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "44444444-4444-4444-4444-444444444444";
const STAFF_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STAFF_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CLASS_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const SUPER_ADMIN: AuthContext = { userId: "sa-1", role: "super_admin", orgId: null, branchId: null };
const BRANCH_MGR: AuthContext = { userId: "bm-1", role: "branch_manager", orgId: "o-1", branchId: BRANCH_A };
const TEACHER: AuthContext = { userId: "t-1", role: "teacher", orgId: "o-1", branchId: BRANCH_A };

function postReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function seed() {
  state.users.push(
    { id: "u-a", fullName: "Ada Lead", email: "ada@s.edu" },
    { id: "u-b", fullName: "Ben Assist", email: "ben@s.edu" },
  );
  state.staff.push(
    { id: STAFF_A, userId: "u-a", branchId: BRANCH_A, status: "active", department: "Math" },
    { id: STAFF_B, userId: "u-b", branchId: BRANCH_A, status: "active", department: "Math" },
  );
  state.classes.push({ id: CLASS_A, branchId: BRANCH_A });
}

beforeEach(() => {
  state = { users: [], staff: [], classes: [], assignments: [] };
  vi.resetModules();
});

describe("POST /api/staff/assign", () => {
  const url = "http://x/api/staff/assign";

  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/staff/assign/route");
    expect((await POST(postReq(url, { staffProfileId: STAFF_A, classId: CLASS_A }))).status).toBe(401);
  });

  it("403 for a teacher (RBAC)", async () => {
    currentCtx = TEACHER;
    seed();
    const { POST } = await import("../../app/api/staff/assign/route");
    expect((await POST(postReq(url, { staffProfileId: STAFF_A, classId: CLASS_A }))).status).toBe(403);
  });

  it("400 on invalid body", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(postReq(url, { staffProfileId: "nope", classId: CLASS_A }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.staffProfileId).toBeDefined();
  });

  it("400 when staff not found", async () => {
    currentCtx = SUPER_ADMIN;
    state.classes.push({ id: CLASS_A, branchId: BRANCH_A });
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(postReq(url, { staffProfileId: STAFF_A, classId: CLASS_A }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.staffProfileId).toBe("no such staff profile");
  });

  it("400 when class not found", async () => {
    currentCtx = SUPER_ADMIN;
    state.staff.push({ id: STAFF_A, userId: "u-a", branchId: BRANCH_A, status: "active", department: "Math" });
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(postReq(url, { staffProfileId: STAFF_A, classId: CLASS_A }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.classId).toBe("no such class");
  });

  it("400 when staff is not active", async () => {
    currentCtx = SUPER_ADMIN;
    seed();
    state.staff[0].status = "onboarding";
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(postReq(url, { staffProfileId: STAFF_A, classId: CLASS_A }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.staffProfileId).toContain("onboarding");
  });

  it("400 on a cross-branch class", async () => {
    currentCtx = SUPER_ADMIN;
    seed();
    state.classes.push({ id: "dddddddd-dddd-dddd-dddd-dddddddddddd", branchId: BRANCH_B });
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(
      postReq(url, { staffProfileId: STAFF_A, classId: "dddddddd-dddd-dddd-dddd-dddddddddddd" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fields.classId).toBe("branch mismatch");
  });

  it("201 assigns a lead", async () => {
    currentCtx = SUPER_ADMIN;
    seed();
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(postReq(url, { staffProfileId: STAFF_A, classId: CLASS_A, role: "lead" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.role).toBe("lead");
    expect(state.assignments).toHaveLength(1);
  });

  it("400 on a duplicate assignment", async () => {
    currentCtx = SUPER_ADMIN;
    seed();
    state.assignments.push({ id: "asg-x", staffId: STAFF_A, classId: CLASS_A, role: "lead" });
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(postReq(url, { staffProfileId: STAFF_A, classId: CLASS_A, role: "assistant" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.classId).toBe("already assigned");
  });

  it("400 when the class already has a lead", async () => {
    currentCtx = SUPER_ADMIN;
    seed();
    state.assignments.push({ id: "asg-x", staffId: STAFF_A, classId: CLASS_A, role: "lead" });
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(postReq(url, { staffProfileId: STAFF_B, classId: CLASS_A, role: "lead" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.role).toBe("class already has a lead");
  });

  it("201 allows an assistant even when a lead exists", async () => {
    currentCtx = SUPER_ADMIN;
    seed();
    state.assignments.push({ id: "asg-x", staffId: STAFF_A, classId: CLASS_A, role: "lead" });
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(postReq(url, { staffProfileId: STAFF_B, classId: CLASS_A, role: "assistant" }));
    expect(res.status).toBe(201);
    expect(state.assignments).toHaveLength(2);
  });

  it("403 when a branch_manager assigns into another branch", async () => {
    currentCtx = { ...BRANCH_MGR, branchId: BRANCH_B };
    seed();
    const { POST } = await import("../../app/api/staff/assign/route");
    const res = await POST(postReq(url, { staffProfileId: STAFF_A, classId: CLASS_A }));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/staff/assignments/branch/[branchId]", () => {
  it("200 lists assignments for the branch", async () => {
    currentCtx = SUPER_ADMIN;
    seed();
    state.assignments.push({ id: "asg-1", staffId: STAFF_A, classId: CLASS_A, role: "lead" });
    const { GET } = await import("../../app/api/staff/assignments/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ branchId: BRANCH_A }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.assignments[0].fullName).toBe("Ada Lead");
    expect(data.assignments[0].role).toBe("lead");
  });

  it("403 when a branch_manager reads another branch", async () => {
    currentCtx = BRANCH_MGR;
    const { GET } = await import("../../app/api/staff/assignments/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ branchId: BRANCH_B }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/staff/unassign", () => {
  const url = "http://x/api/staff/unassign";

  it("200 removes an assignment", async () => {
    currentCtx = SUPER_ADMIN;
    seed();
    const ASG = "55555555-5555-5555-5555-555555555555";
    state.assignments.push({ id: ASG, staffId: STAFF_A, classId: CLASS_A, role: "lead" });
    const { POST } = await import("../../app/api/staff/unassign/route");
    const res = await POST(postReq(url, { assignmentId: ASG }));
    expect(res.status).toBe(200);
    expect((await res.json()).assignmentId).toBe(ASG);
    expect(state.assignments).toHaveLength(0);
  });

  it("400 when the assignment does not exist", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/staff/unassign/route");
    const res = await POST(postReq(url, { assignmentId: "55555555-5555-5555-5555-555555555555" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.assignmentId).toBe("no such assignment");
  });

  it("403 when a branch_manager unassigns in another branch", async () => {
    currentCtx = BRANCH_MGR;
    seed();
    state.classes.push({ id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", branchId: BRANCH_B });
    state.assignments.push({
      id: "66666666-6666-6666-6666-666666666666",
      staffId: STAFF_A,
      classId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      role: "lead",
    });
    const { POST } = await import("../../app/api/staff/unassign/route");
    const res = await POST(postReq(url, { assignmentId: "66666666-6666-6666-6666-666666666666" }));
    expect(res.status).toBe(403);
    expect(state.assignments).toHaveLength(1);
  });
});

/**
 * API tests for Module 4 discussions: threads + posts.
 * Verifies class-membership RBAC for create/list/read/reply.
 *
 * Run: npx vitest run src/modules/lms/discussion.api.test.ts
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
  discussion_threads: any[];
  discussion_posts: any[];
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
      leftJoin: (t: unknown) => (ctx.joins.push(tableName(t)), chain),
      where: (c: any) => ((ctx.clause = c), chain),
      orderBy: () => resolve(ctx),
      limit: () => resolve(ctx),
      then: (r: (v: unknown[]) => void) => r(resolve(ctx)),
    };
    return chain;
  }

  function resolve(c: { table: string; clause: any; joins: string[] }): unknown[] {
    const { table, clause, joins } = c;
    if (table === "classes") {
      const id = valOf(clause, "id");
      return state.classes.filter((x) => x.id === id).map((x) => ({ id: x.id, branchId: x.branchId }));
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
    if (table === "discussion_threads") {
      const id = valOf(clause, "id");
      if (id) return state.discussion_threads.filter((t) => t.id === id);
      const classId = valOf(clause, "class_id");
      return state.discussion_threads.filter((t) => t.classId === classId);
    }
    if (table === "discussion_posts") {
      const threadId = valOf(clause, "thread_id");
      return state.discussion_posts
        .filter((p) => p.threadId === threadId)
        .map((p) => ({
          id: p.id,
          threadId: p.threadId,
          parentPostId: p.parentPostId ?? null,
          authorId: p.authorId ?? null,
          authorName: null,
          body: p.body,
          createdAt: p.createdAt ?? new Date(0),
        }));
    }
    return [];
  }

  const exec: any = {
    select: () => builder(),
    insert: (t: unknown) => ({
      values: (vals: Record<string, any>) => ({
        returning: () => {
          const name = tableName(t) as keyof FakeState;
          const row = { id: `${name}-${state[name].length + 1}`, createdAt: new Date(0), assignmentId: null, parentPostId: null, ...vals };
          state[name].push(row);
          return [row];
        },
        then: (r: (v: unknown) => void) => {
          const name = tableName(t) as keyof FakeState;
          const row = { id: `${name}-${state[name].length + 1}`, createdAt: new Date(0), parentPostId: null, ...vals };
          state[name].push(row);
          r(undefined);
        },
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
    asc: (col: { name?: string }) => ({ __asc: col?.name }),
  };
});

const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const CLASS = "c1111111-1111-1111-1111-111111111111";
const THREAD = "70000000-0000-0000-0000-000000000001";

const TEACHER: AuthContext = { userId: "u-teach", role: "teacher", orgId: "o", branchId: BRANCH_A };
const STUDENT: AuthContext = { userId: "u-stu", role: "student", orgId: "o", branchId: BRANCH_A };
const OUTSIDER: AuthContext = { userId: "u-out", role: "student", orgId: "o", branchId: BRANCH_A };

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
    staff_assignments: [{ id: "asg", staffId: "sp-t", classId: CLASS }],
    student_profiles: [
      { id: "sp-s", userId: "u-stu", branchId: BRANCH_A },
      { id: "sp-out", userId: "u-out", branchId: BRANCH_A },
    ],
    enrollments: [{ id: "e", studentId: "sp-s", classId: CLASS }],
    discussion_threads: [],
    discussion_posts: [],
    audit_logs: [],
  };
  vi.resetModules();
});

describe("POST /api/discussions/threads", () => {
  const url = "http://x/api/discussions/threads";
  const body = { classId: CLASS, title: "Q about HW", body: "How do I start?" };

  it("401 unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/discussions/threads/route");
    expect((await POST(post(url, body))).status).toBe(401);
  });
  it("403 for a non-member", async () => {
    currentCtx = OUTSIDER;
    const { POST } = await import("../../app/api/discussions/threads/route");
    expect((await POST(post(url, body))).status).toBe(403);
  });
  it("400 on invalid body", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/discussions/threads/route");
    expect((await POST(post(url, { classId: "nope", title: "x", body: "y" }))).status).toBe(400);
  });
  it("201 an enrolled student opens a thread + first post", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/discussions/threads/route");
    const res = await POST(post(url, body));
    expect(res.status).toBe(201);
    expect(state.discussion_threads).toHaveLength(1);
    expect(state.discussion_posts).toHaveLength(1);
  });
  it("201 a teacher opens a thread", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/discussions/threads/route");
    expect((await POST(post(url, body))).status).toBe(201);
  });
});

describe("GET /api/discussions/class/[classId]", () => {
  beforeEach(() => {
    state.discussion_threads.push({ id: THREAD, classId: CLASS, title: "T", authorId: "u-teach", assignmentId: null, createdAt: new Date(0) });
  });
  it("200 a member lists threads", async () => {
    currentCtx = STUDENT;
    const { GET } = await import("../../app/api/discussions/class/[classId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ classId: CLASS }) });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });
  it("403 for a non-member", async () => {
    currentCtx = OUTSIDER;
    const { GET } = await import("../../app/api/discussions/class/[classId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ classId: CLASS }) });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/discussions/threads/[threadId] + reply", () => {
  beforeEach(() => {
    state.discussion_threads.push({ id: THREAD, classId: CLASS, title: "T", authorId: "u-teach", assignmentId: null, createdAt: new Date(0) });
    state.discussion_posts.push({ id: "p-1", threadId: THREAD, authorId: "u-teach", body: "first", parentPostId: null, createdAt: new Date(0) });
  });
  it("200 a member reads the thread + posts", async () => {
    currentCtx = STUDENT;
    const { GET } = await import("../../app/api/discussions/threads/[threadId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ threadId: THREAD }) });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.posts).toHaveLength(1);
  });
  it("400 when the thread does not exist", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/discussions/threads/[threadId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ threadId: "70000000-0000-0000-0000-000000000099" }),
    });
    expect(res.status).toBe(400);
  });
  it("201 a member replies", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/discussions/threads/[threadId]/posts/route");
    const res = await POST(post("http://x", { body: "my reply" }), {
      params: Promise.resolve({ threadId: THREAD }),
    });
    expect(res.status).toBe(201);
    expect(state.discussion_posts).toHaveLength(2);
  });
  it("403 a non-member cannot reply", async () => {
    currentCtx = OUTSIDER;
    const { POST } = await import("../../app/api/discussions/threads/[threadId]/posts/route");
    const res = await POST(post("http://x", { body: "intrude" }), {
      params: Promise.resolve({ threadId: THREAD }),
    });
    expect(res.status).toBe(403);
  });
});

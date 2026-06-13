/**
 * API tests for Module 4 submissions: submit / grade / list / me / file-register.
 * Verifies membership + ownership RBAC, draft-not-open, and the points cap.
 * (The Vercel Blob upload route shares assertSubmissionOwner, covered here.)
 *
 * Run: npx vitest run src/modules/lms/submission.api.test.ts
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
  submissions: any[];
  submission_files: any[];
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
    if (table === "student_profiles") {
      const userId = valOf(clause, "user_id");
      const sp = state.student_profiles.find((x) => x.userId === userId);
      return sp ? [{ id: sp.id }] : [];
    }
    if (table === "assignments") {
      const id = valOf(clause, "id");
      return state.assignments.filter((a) => a.id === id);
    }
    if (table === "submissions") {
      if (joins.includes("assignments")) {
        const id = valOf(clause, "id");
        const s = state.submissions.find((x) => x.id === id);
        if (!s) return [];
        const a = state.assignments.find((x) => x.id === s.assignmentId);
        return [{ id: s.id, assignmentId: s.assignmentId, classId: a?.classId, maxPoints: a?.maxPoints }];
      }
      if (joins.includes("users")) {
        const assignmentId = valOf(clause, "assignment_id");
        return state.submissions
          .filter((s) => s.assignmentId === assignmentId)
          .map((s) => {
            const sp = state.student_profiles.find((x) => x.id === s.studentId);
            const u = (state as any).users?.find?.((x: any) => x.id === sp?.userId) ?? {};
            return {
              submissionId: s.id,
              studentProfileId: sp?.id,
              studentName: u.fullName,
              status: s.status,
              pointsAwarded: s.pointsAwarded ?? null,
              submittedAt: s.submittedAt ?? null,
            };
          });
      }
      if (joins.includes("student_profiles")) {
        const userId = valOf(clause, "user_id");
        const sp = state.student_profiles.find((x) => x.userId === userId);
        if (!sp) return [];
        return state.submissions
          .filter((s) => s.studentId === sp.id)
          .map((s) => ({
            submissionId: s.id,
            assignmentId: s.assignmentId,
            status: s.status,
            pointsAwarded: s.pointsAwarded ?? null,
            submittedAt: s.submittedAt ?? null,
          }));
      }
      if (clause?.__and) {
        const assignmentId = valOf(clause, "assignment_id");
        const studentId = valOf(clause, "student_id");
        return state.submissions
          .filter((s) => s.assignmentId === assignmentId && s.studentId === studentId)
          .map((s) => ({ id: s.id }));
      }
      const id = valOf(clause, "id");
      return state.submissions
        .filter((s) => s.id === id)
        .map((s) => ({ id: s.id, studentId: s.studentId }));
    }
    return [];
  }

  const exec: any = {
    select: () => builder(),
    insert: (t: unknown) => ({
      values: (vals: Record<string, any>) => ({
        returning: () => {
          const name = tableName(t) as keyof FakeState;
          const row = { id: `${name}-${state[name].length + 1}`, ...vals };
          state[name].push(row);
          return [row];
        },
        then: (r: (v: unknown) => void) => r(undefined),
      }),
    }),
    update: (t: unknown) => ({
      set: (vals: Record<string, any>) => ({
        where: (clause: any) => {
          const name = tableName(t) as keyof FakeState;
          const id = valOf(clause, "id");
          const row = state[name].find((r: any) => r.id === id);
          if (row) Object.assign(row, vals);
          return Promise.resolve();
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(exec),
  };
  return exec;
}
// users table lives alongside but isn't keyed in FakeState; expose via closure.
(makeFakeDb as any);

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
const CLASS = "c1111111-1111-1111-1111-111111111111";
const A_PUB = "a1111111-1111-1111-1111-111111111111";
const A_DRAFT = "a2222222-2222-2222-2222-222222222222";
const SUB = "50000000-0000-0000-0000-000000000001";

const TEACHER: AuthContext = { userId: "u-teach", role: "teacher", orgId: "o", branchId: BRANCH_A };
const TEACHER2: AuthContext = { userId: "u-teach2", role: "teacher", orgId: "o", branchId: BRANCH_A };
const STUDENT: AuthContext = { userId: "u-stu", role: "student", orgId: "o", branchId: BRANCH_A };
const STUDENT2: AuthContext = { userId: "u-stu2", role: "student", orgId: "o", branchId: BRANCH_A };

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
      { id: "sp-s2", userId: "u-stu2", branchId: BRANCH_A },
    ],
    enrollments: [{ id: "e", studentId: "sp-s", classId: CLASS }],
    assignments: [
      { id: A_PUB, classId: CLASS, status: "published", maxPoints: 100 },
      { id: A_DRAFT, classId: CLASS, status: "draft", maxPoints: 100 },
    ],
    submissions: [],
    submission_files: [],
    audit_logs: [],
  };
  (state as any).users = [{ id: "u-stu", fullName: "Sky Student" }];
  vi.resetModules();
});

describe("POST /api/submissions", () => {
  const url = "http://x/api/submissions";
  it("403 for a teacher (students only)", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/submissions/route");
    expect((await POST(post(url, { assignmentId: A_PUB }))).status).toBe(403);
  });
  it("400 on invalid body", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/submissions/route");
    expect((await POST(post(url, { assignmentId: "nope" }))).status).toBe(400);
  });
  it("400 submitting to a draft assignment", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/submissions/route");
    const res = await POST(post(url, { assignmentId: A_DRAFT }));
    expect(res.status).toBe(400);
  });
  it("403 for a student not enrolled in the class", async () => {
    currentCtx = STUDENT2;
    const { POST } = await import("../../app/api/submissions/route");
    expect((await POST(post(url, { assignmentId: A_PUB }))).status).toBe(403);
  });
  it("201 an enrolled student submits a published assignment", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/submissions/route");
    const res = await POST(post(url, { assignmentId: A_PUB }));
    expect(res.status).toBe(201);
    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0].status).toBe("submitted");
  });
});

describe("POST /api/submissions/[id]/grade", () => {
  beforeEach(() => {
    state.submissions.push({ id: SUB, assignmentId: A_PUB, studentId: "sp-s", status: "submitted" });
  });
  it("200 an assigned teacher grades within the cap", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/submissions/[submissionId]/grade/route");
    const res = await POST(post("http://x", { pointsAwarded: 90 }), {
      params: Promise.resolve({ submissionId: SUB }),
    });
    expect(res.status).toBe(200);
    expect(state.submissions[0].status).toBe("graded");
    expect(state.submissions[0].pointsAwarded).toBe(90);
  });
  it("400 when points exceed the assignment max", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/submissions/[submissionId]/grade/route");
    const res = await POST(post("http://x", { pointsAwarded: 150 }), {
      params: Promise.resolve({ submissionId: SUB }),
    });
    expect(res.status).toBe(400);
  });
  it("403 for a student", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/submissions/[submissionId]/grade/route");
    const res = await POST(post("http://x", { pointsAwarded: 50 }), {
      params: Promise.resolve({ submissionId: SUB }),
    });
    expect(res.status).toBe(403);
  });
  it("403 for a teacher not assigned to the class", async () => {
    currentCtx = TEACHER2;
    const { POST } = await import("../../app/api/submissions/[submissionId]/grade/route");
    const res = await POST(post("http://x", { pointsAwarded: 50 }), {
      params: Promise.resolve({ submissionId: SUB }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/submissions/assignment/[assignmentId] + /api/me/submissions", () => {
  beforeEach(() => {
    state.submissions.push({ id: SUB, assignmentId: A_PUB, studentId: "sp-s", status: "submitted" });
  });
  it("200 staff list submissions for the assignment", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/submissions/assignment/[assignmentId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ assignmentId: A_PUB }) });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });
  it("403 a student listing an assignment's submissions", async () => {
    currentCtx = STUDENT;
    const { GET } = await import("../../app/api/submissions/assignment/[assignmentId]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ assignmentId: A_PUB }) });
    expect(res.status).toBe(403);
  });
  it("200 a student lists their own submissions", async () => {
    currentCtx = STUDENT;
    const { GET } = await import("../../app/api/me/submissions/route");
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });
  it("403 a teacher hitting /api/me/submissions", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/me/submissions/route");
    expect((await GET(new Request("http://x"))).status).toBe(403);
  });
});

describe("POST /api/submissions/[id]/files", () => {
  beforeEach(() => {
    state.submissions.push({ id: SUB, assignmentId: A_PUB, studentId: "sp-s", status: "submitted" });
  });
  const fileBody = {
    fileName: "essay.pdf",
    url: "https://blob.example/essay.pdf",
    storageKey: "subs/essay.pdf",
    contentType: "application/pdf",
  };
  it("201 the owning student registers a file", async () => {
    currentCtx = STUDENT;
    const { POST } = await import("../../app/api/submissions/[submissionId]/files/route");
    const res = await POST(post("http://x", fileBody), {
      params: Promise.resolve({ submissionId: SUB }),
    });
    expect(res.status).toBe(201);
    expect(state.submission_files).toHaveLength(1);
  });
  it("403 a different student cannot attach to someone else's submission", async () => {
    currentCtx = STUDENT2;
    const { POST } = await import("../../app/api/submissions/[submissionId]/files/route");
    const res = await POST(post("http://x", fileBody), {
      params: Promise.resolve({ submissionId: SUB }),
    });
    expect(res.status).toBe(403);
    expect(state.submission_files).toHaveLength(0);
  });
});

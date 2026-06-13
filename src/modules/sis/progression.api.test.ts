/**
 * API tests for Module 3 — academic progression:
 *   POST /api/enrollments/grade
 *   POST /api/students/promote
 *   GET  /api/students/[studentProfileId]/transcript
 *
 * Mocks the auth context (RBAC) and the db client (an in-memory fake of the
 * Drizzle query shapes the services use). No live database required.
 *
 * Run: npx vitest run src/modules/sis/progression.api.test.ts
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
  users: any[];
  staff_profiles: any[];
  staff_assignments: any[];
  classes: any[];
  enrollments: any[];
  student_profiles: any[];
  student_promotions: any[];
  audit_logs: any[];
}
let state: FakeState;

function tableName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return sym ? String((table as Record<symbol, unknown>)[sym]) : "";
}

function valOf(clause: any, col: string): any {
  if (!clause) return undefined;
  if (clause.__and) return clause.__and.find((c: any) => c.__col === col)?.__val;
  return clause.__col === col ? clause.__val : undefined;
}

function makeFakeDb() {
  function selectBuilder() {
    const ctx = { table: "", clause: null as any, joins: [] as string[] };
    const chain: any = {
      from: (t: unknown) => ((ctx.table = tableName(t)), chain),
      innerJoin: (t: unknown) => (ctx.joins.push(tableName(t)), chain),
      where: (c: any) => ((ctx.clause = c), chain),
      orderBy: () => resolve(ctx),
      limit: () => resolve(ctx),
      then: (res: (v: unknown[]) => void) => res(resolve(ctx)),
    };
    return chain;
  }

  function resolve(ctx: { table: string; clause: any; joins: string[] }): unknown[] {
    const { table, clause, joins } = ctx;

    if (table === "enrollments") {
      if (joins.includes("users")) {
        // listEnrollmentsForBranch: enrollments ⨝ classes ⨝ student_profiles ⨝ users
        const branchId = valOf(clause, "branch_id");
        return state.enrollments
          .filter((e) => {
            const c = state.classes.find((x) => x.id === e.classId);
            return c && c.branchId === branchId;
          })
          .map((e) => {
            const c = state.classes.find((x) => x.id === e.classId);
            const sp = state.student_profiles.find((x) => x.id === e.studentId);
            const u = state.users.find((x) => x.id === sp?.userId) ?? {};
            return {
              enrollmentId: e.id,
              classId: e.classId,
              classSubject: c?.subject,
              term: c?.term,
              credits: c?.credits,
              studentProfileId: sp?.id,
              studentName: u.fullName,
              status: e.status,
              finalGrade: e.finalGrade ?? null,
            };
          });
      }
      // enrollments ⨝ classes
      if (clause?.__and) {
        // promote: and(studentId, term)
        const studentId = valOf(clause, "student_id");
        const term = valOf(clause, "term");
        return state.enrollments
          .filter((e) => {
            const c = state.classes.find((x) => x.id === e.classId);
            return e.studentId === studentId && c?.term === term;
          })
          .map((e) => {
            const c = state.classes.find((x) => x.id === e.classId);
            return { status: e.status, finalGrade: e.finalGrade ?? null, credits: c?.credits };
          });
      }
      if (clause?.__col === "student_id") {
        // transcript courses
        return state.enrollments
          .filter((e) => e.studentId === clause.__val)
          .map((e) => {
            const c = state.classes.find((x) => x.id === e.classId);
            return {
              subject: c?.subject,
              term: c?.term,
              credits: c?.credits,
              status: e.status,
              finalGrade: e.finalGrade ?? null,
            };
          });
      }
      // grade lookup by enrollment id
      const id = valOf(clause, "id");
      return state.enrollments
        .filter((e) => e.id === id)
        .map((e) => {
          const c = state.classes.find((x) => x.id === e.classId);
          return { id: e.id, status: e.status, classId: e.classId, branchId: c?.branchId };
        });
    }

    if (table === "staff_assignments") {
      const classId = valOf(clause, "class_id");
      const userId = valOf(clause, "user_id");
      return state.staff_assignments
        .filter((a) => {
          if (a.classId !== classId) return false;
          const sp = state.staff_profiles.find((x) => x.id === a.staffId);
          return sp?.userId === userId;
        })
        .map((a) => ({ id: a.id }));
    }

    if (table === "student_profiles") {
      const id = valOf(clause, "id");
      const sp = state.student_profiles.find((x) => x.id === id);
      if (!sp) return [];
      if (joins.includes("users")) {
        const u = state.users.find((x) => x.id === sp.userId) ?? {};
        return [
          {
            id: sp.id,
            branchId: sp.branchId,
            fullName: u.fullName,
            email: u.email,
            cohortYear: sp.cohortYear,
            status: sp.status,
            currentLevel: sp.currentLevel,
            enrollmentDate: sp.enrollmentDate,
            graduationDate: sp.graduationDate ?? null,
          },
        ];
      }
      return [
        {
          id: sp.id,
          branchId: sp.branchId,
          status: sp.status,
          currentLevel: sp.currentLevel,
        },
      ];
    }

    if (table === "student_promotions") {
      const studentId = valOf(clause, "student_id");
      return state.student_promotions
        .filter((p) => p.studentId === studentId)
        .map((p) => ({
          term: p.term,
          fromLevel: p.fromLevel,
          toLevel: p.toLevel,
          termGpa: p.termGpa ?? null,
          outcome: p.outcome,
          createdAt: p.createdAt ?? new Date(0),
        }));
    }

    return [];
  }

  const exec: any = {
    select: () => selectBuilder(),
    insert: (table: unknown) => ({
      values: (vals: Record<string, any>) => {
        const name = tableName(table) as keyof FakeState;
        const row = { id: `${name}-${state[name].length + 1}`, ...vals };
        state[name].push(row);
        return { returning: () => [row], then: (r: (v: unknown) => void) => r(undefined) };
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, any>) => ({
        where: (clause: any) => {
          const name = tableName(table) as keyof FakeState;
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

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __col: col?.name, __val: val }),
    and: (...clauses: unknown[]) => ({ __and: clauses }),
    asc: (col: { name?: string }) => ({ __asc: col?.name }),
    desc: (col: { name?: string }) => ({ __desc: col?.name }),
  };
});

/* ── Fixtures ───────────────────────────────────────────────────── */
const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "44444444-4444-4444-4444-444444444444";
const STUDENT = "55555555-5555-5555-5555-555555555555";
const ENR_1 = "66666666-6666-6666-6666-666666666666";
const ENR_2 = "77777777-7777-7777-7777-777777777777";

const SUPER_ADMIN: AuthContext = { userId: "sa-1", role: "super_admin", orgId: null, branchId: null };
const BRANCH_MGR: AuthContext = { userId: "bm-1", role: "branch_manager", orgId: "o-1", branchId: BRANCH_A };
const TEACHER: AuthContext = { userId: "u-teach", role: "teacher", orgId: "o-1", branchId: BRANCH_A };
const STUDENT_ROLE: AuthContext = { userId: "st-1", role: "student", orgId: "o-1", branchId: BRANCH_A };

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A student in BRANCH_A with two graded-capable Fall classes (3cr each). */
function seedStudentWithTerm() {
  state.users.push({ id: "u-s", fullName: "Sky Student", email: "sky@s.edu" });
  state.student_profiles.push({
    id: STUDENT,
    userId: "u-s",
    branchId: BRANCH_A,
    status: "active",
    currentLevel: 1,
    cohortYear: 2030,
    enrollmentDate: "2026-09-01",
    graduationDate: null,
  });
  state.classes.push(
    { id: "c-1", branchId: BRANCH_A, subject: "Algebra", term: "Fall 2026", credits: 4 },
    { id: "c-2", branchId: BRANCH_A, subject: "History", term: "Fall 2026", credits: 2 },
  );
  state.enrollments.push(
    { id: ENR_1, studentId: STUDENT, classId: "c-1", status: "enrolled", finalGrade: null },
    { id: ENR_2, studentId: STUDENT, classId: "c-2", status: "enrolled", finalGrade: null },
  );
}

beforeEach(() => {
  state = {
    users: [],
    staff_profiles: [],
    staff_assignments: [],
    classes: [],
    enrollments: [],
    student_profiles: [],
    student_promotions: [],
    audit_logs: [],
  };
  vi.resetModules();
});

/* ── Grading ────────────────────────────────────────────────────── */
describe("POST /api/enrollments/grade", () => {
  const url = "http://x/api/enrollments/grade";

  it("401 unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/enrollments/grade/route");
    expect((await POST(post(url, { enrollmentId: ENR_1, finalGrade: "A" }))).status).toBe(401);
  });

  it("403 for a student role", async () => {
    currentCtx = STUDENT_ROLE;
    const { POST } = await import("../../app/api/enrollments/grade/route");
    expect((await POST(post(url, { enrollmentId: ENR_1, finalGrade: "A" }))).status).toBe(403);
  });

  it("400 on an invalid grade", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/enrollments/grade/route");
    const res = await POST(post(url, { enrollmentId: ENR_1, finalGrade: "E" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.finalGrade).toBeDefined();
  });

  it("400 when the enrollment is missing", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/enrollments/grade/route");
    const res = await POST(post(url, { enrollmentId: ENR_1, finalGrade: "A" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.enrollmentId).toBe("no such enrollment");
  });

  it("200 super_admin grades and completes the enrollment", async () => {
    currentCtx = SUPER_ADMIN;
    seedStudentWithTerm();
    const { POST } = await import("../../app/api/enrollments/grade/route");
    const res = await POST(post(url, { enrollmentId: ENR_1, finalGrade: "A-" }));
    expect(res.status).toBe(200);
    const e = state.enrollments.find((x) => x.id === ENR_1);
    expect(e.status).toBe("completed");
    expect(e.finalGrade).toBe("A-");
  });

  it("403 when a teacher is not assigned to the class", async () => {
    currentCtx = TEACHER;
    seedStudentWithTerm();
    const { POST } = await import("../../app/api/enrollments/grade/route");
    const res = await POST(post(url, { enrollmentId: ENR_1, finalGrade: "B" }));
    expect(res.status).toBe(403);
  });

  it("200 when a teacher IS assigned to the class", async () => {
    currentCtx = TEACHER;
    seedStudentWithTerm();
    state.staff_profiles.push({ id: "sp-t", userId: "u-teach", branchId: BRANCH_A });
    state.staff_assignments.push({ id: "asg-1", staffId: "sp-t", classId: "c-1", role: "lead" });
    const { POST } = await import("../../app/api/enrollments/grade/route");
    const res = await POST(post(url, { enrollmentId: ENR_1, finalGrade: "B" }));
    expect(res.status).toBe(200);
    expect(state.enrollments.find((x) => x.id === ENR_1).finalGrade).toBe("B");
  });

  it("400 when grading a withdrawn enrollment", async () => {
    currentCtx = SUPER_ADMIN;
    seedStudentWithTerm();
    state.enrollments[0].status = "withdrawn";
    const { POST } = await import("../../app/api/enrollments/grade/route");
    const res = await POST(post(url, { enrollmentId: ENR_1, finalGrade: "A" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.enrollmentId).toBe("enrollment is withdrawn");
  });
});

/* ── Promotion ──────────────────────────────────────────────────── */
describe("POST /api/students/promote", () => {
  const url = "http://x/api/students/promote";

  it("403 for a teacher (managers/admins only)", async () => {
    currentCtx = TEACHER;
    seedStudentWithTerm();
    const { POST } = await import("../../app/api/students/promote/route");
    expect((await POST(post(url, { studentProfileId: STUDENT, term: "Fall 2026" }))).status).toBe(403);
  });

  it("400 when the student is missing", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/students/promote/route");
    const res = await POST(post(url, { studentProfileId: STUDENT, term: "Fall 2026" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.studentProfileId).toBe("no such student profile");
  });

  it("400 when the term still has ungraded coursework (promote)", async () => {
    currentCtx = SUPER_ADMIN;
    seedStudentWithTerm();
    const { POST } = await import("../../app/api/students/promote/route");
    const res = await POST(post(url, { studentProfileId: STUDENT, term: "Fall 2026" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.term).toContain("grade all enrollments");
  });

  it("400 when the term has no coursework (promote)", async () => {
    currentCtx = SUPER_ADMIN;
    seedStudentWithTerm();
    const { POST } = await import("../../app/api/students/promote/route");
    const res = await POST(post(url, { studentProfileId: STUDENT, term: "Spring 2099" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.term).toBe("no enrollments in this term");
  });

  it("200 promotes, advances level, snapshots the credit-weighted GPA", async () => {
    currentCtx = SUPER_ADMIN;
    seedStudentWithTerm();
    // A(4.0)*4cr + C(2.0)*2cr = 20 / 6 = 3.33
    state.enrollments[0] = { ...state.enrollments[0], status: "completed", finalGrade: "A" };
    state.enrollments[1] = { ...state.enrollments[1], status: "completed", finalGrade: "C" };
    const { POST } = await import("../../app/api/students/promote/route");
    const res = await POST(post(url, { studentProfileId: STUDENT, term: "Fall 2026" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.toLevel).toBe(2);
    expect(data.termGpa).toBe(3.33);
    expect(state.student_profiles[0].currentLevel).toBe(2);
    expect(state.student_promotions).toHaveLength(1);
  });

  it("200 graduates the student", async () => {
    currentCtx = SUPER_ADMIN;
    seedStudentWithTerm();
    state.enrollments[0] = { ...state.enrollments[0], status: "completed", finalGrade: "A" };
    state.enrollments[1] = { ...state.enrollments[1], status: "completed", finalGrade: "B" };
    const { POST } = await import("../../app/api/students/promote/route");
    const res = await POST(post(url, { studentProfileId: STUDENT, term: "Fall 2026", outcome: "graduated" }));
    expect(res.status).toBe(200);
    expect(state.student_profiles[0].status).toBe("graduated");
    expect(state.student_profiles[0].graduationDate).toBeTruthy();
  });

  it("200 retains even with ungraded/empty coursework", async () => {
    currentCtx = SUPER_ADMIN;
    seedStudentWithTerm();
    const { POST } = await import("../../app/api/students/promote/route");
    const res = await POST(post(url, { studentProfileId: STUDENT, term: "Fall 2026", outcome: "retained" }));
    expect(res.status).toBe(200);
    expect(state.student_profiles[0].currentLevel).toBe(1);
    expect((await res.json()).outcome).toBe("retained");
  });

  it("403 when a branch_manager promotes a student in another branch", async () => {
    currentCtx = BRANCH_MGR;
    seedStudentWithTerm();
    state.student_profiles[0].branchId = BRANCH_B;
    const { POST } = await import("../../app/api/students/promote/route");
    const res = await POST(post(url, { studentProfileId: STUDENT, term: "Fall 2026", outcome: "retained" }));
    expect(res.status).toBe(403);
  });
});

/* ── Transcript ─────────────────────────────────────────────────── */
describe("GET /api/students/[studentProfileId]/transcript", () => {
  it("403 for a teacher", async () => {
    currentCtx = TEACHER;
    seedStudentWithTerm();
    const { GET } = await import("../../app/api/students/[studentProfileId]/transcript/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ studentProfileId: STUDENT }) });
    expect(res.status).toBe(403);
  });

  it("400 when the student is missing", async () => {
    currentCtx = SUPER_ADMIN;
    const { GET } = await import("../../app/api/students/[studentProfileId]/transcript/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ studentProfileId: STUDENT }) });
    expect(res.status).toBe(400);
  });

  it("200 assembles coursework, GPAs, and promotion history", async () => {
    currentCtx = SUPER_ADMIN;
    seedStudentWithTerm();
    state.enrollments[0] = { ...state.enrollments[0], status: "completed", finalGrade: "A" };
    state.enrollments[1] = { ...state.enrollments[1], status: "completed", finalGrade: "C" };
    state.student_promotions.push({
      id: "p1", studentId: STUDENT, term: "Fall 2026", fromLevel: 1, toLevel: 2,
      termGpa: "3.33", outcome: "promoted", createdAt: new Date(0),
    });
    const { GET } = await import("../../app/api/students/[studentProfileId]/transcript/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ studentProfileId: STUDENT }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.student.fullName).toBe("Sky Student");
    expect(data.cumulativeGpa).toBe(3.33);
    expect(data.totalGradedCredits).toBe(6);
    expect(data.terms).toHaveLength(1);
    expect(data.terms[0].courses).toHaveLength(2);
    expect(data.promotions).toHaveLength(1);
  });

  it("403 when a branch_manager reads a student in another branch", async () => {
    currentCtx = BRANCH_MGR;
    seedStudentWithTerm();
    state.student_profiles[0].branchId = BRANCH_B;
    const { GET } = await import("../../app/api/students/[studentProfileId]/transcript/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ studentProfileId: STUDENT }) });
    expect(res.status).toBe(403);
  });
});

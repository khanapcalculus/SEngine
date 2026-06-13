/**
 * API tests for the self-service endpoints (/api/me/*) that back the Teacher
 * and Student views. Verifies RBAC and that every route is scoped to the
 * session user (ctx.userId) — never a client-supplied id.
 *
 * Run: npx vitest run src/modules/me/self_service.api.test.ts
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
  users: any[];
  staff_profiles: any[];
  staff_assignments: any[];
  classes: any[];
  enrollments: any[];
  student_profiles: any[];
  student_promotions: any[];
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

    if (table === "staff_assignments") {
      const userId = valOf(clause, "user_id");
      return state.staff_assignments
        .filter((a) => {
          const sp = state.staff_profiles.find((x) => x.id === a.staffId);
          return sp?.userId === userId;
        })
        .map((a) => {
          const c = state.classes.find((x) => x.id === a.classId);
          return {
            classId: c?.id,
            subject: c?.subject,
            term: c?.term,
            credits: c?.credits,
            role: a.role,
          };
        });
    }

    if (table === "enrollments") {
      if (joins.includes("staff_assignments")) {
        const userId = valOf(clause, "user_id");
        const myClassIds = new Set(
          state.staff_assignments
            .filter((a) => {
              const sp = state.staff_profiles.find((x) => x.id === a.staffId);
              return sp?.userId === userId;
            })
            .map((a) => a.classId),
        );
        return state.enrollments
          .filter((e) => myClassIds.has(e.classId))
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
      if (joins.includes("student_profiles")) {
        const userId = valOf(clause, "user_id");
        const sp = state.student_profiles.find((x) => x.userId === userId);
        if (!sp) return [];
        return state.enrollments
          .filter((e) => e.studentId === sp.id)
          .map((e) => {
            const c = state.classes.find((x) => x.id === e.classId);
            return {
              classSubject: c?.subject,
              term: c?.term,
              credits: c?.credits,
              status: e.status,
              finalGrade: e.finalGrade ?? null,
            };
          });
      }
      // assembleTranscript courses: where student_id
      const studentId = valOf(clause, "student_id");
      return state.enrollments
        .filter((e) => e.studentId === studentId)
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

    if (table === "student_profiles") {
      if (joins.includes("users")) {
        const id = valOf(clause, "id");
        const sp = state.student_profiles.find((x) => x.id === id);
        if (!sp) return [];
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
      const userId = valOf(clause, "user_id");
      const sp = state.student_profiles.find((x) => x.userId === userId);
      return sp ? [{ id: sp.id }] : [];
    }

    if (table === "student_promotions") return [];
    return [];
  }

  return { select: () => builder() };
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __col: col?.name, __val: val }),
    and: (...c: unknown[]) => ({ __and: c }),
    asc: (col: { name?: string }) => ({ __asc: col?.name }),
    desc: (col: { name?: string }) => ({ __desc: col?.name }),
  };
});

const BRANCH = "11111111-1111-1111-1111-111111111111";
const TEACHER: AuthContext = { userId: "u-teach", role: "teacher", orgId: "o", branchId: BRANCH };
const STUDENT: AuthContext = { userId: "u-stu", role: "student", orgId: "o", branchId: BRANCH };
const STUDENT_NO_PROFILE: AuthContext = { userId: "u-none", role: "student", orgId: "o", branchId: BRANCH };

beforeEach(() => {
  state = {
    users: [
      { id: "u-teach", fullName: "Tess Teacher", email: "tess@s.edu" },
      { id: "u-stu", fullName: "Sky Student", email: "sky@s.edu" },
    ],
    staff_profiles: [{ id: "sp-t", userId: "u-teach", branchId: BRANCH }],
    staff_assignments: [{ id: "a-1", staffId: "sp-t", classId: "c-1", role: "lead" }],
    classes: [
      { id: "c-1", branchId: BRANCH, subject: "Algebra", term: "Fall 2026", credits: 3 },
    ],
    enrollments: [
      { id: "e-1", studentId: "sp-s", classId: "c-1", status: "enrolled", finalGrade: null },
    ],
    student_profiles: [
      {
        id: "sp-s",
        userId: "u-stu",
        branchId: BRANCH,
        status: "active",
        currentLevel: 1,
        cohortYear: 2030,
        enrollmentDate: "2026-09-01",
        graduationDate: null,
      },
    ],
    student_promotions: [],
  };
  vi.resetModules();
});

describe("GET /api/me/classes", () => {
  it("401 unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { GET } = await import("../../app/api/me/classes/route");
    expect((await GET(new Request("http://x"))).status).toBe(401);
  });
  it("403 for a student", async () => {
    currentCtx = STUDENT;
    const { GET } = await import("../../app/api/me/classes/route");
    expect((await GET(new Request("http://x"))).status).toBe(403);
  });
  it("200 returns only the teacher's assigned classes", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/me/classes/route");
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.count).toBe(1);
    expect(d.classes[0].subject).toBe("Algebra");
  });
});

describe("GET /api/me/gradebook", () => {
  it("403 for a student", async () => {
    currentCtx = STUDENT;
    const { GET } = await import("../../app/api/me/gradebook/route");
    expect((await GET(new Request("http://x"))).status).toBe(403);
  });
  it("200 returns enrollments for the teacher's classes only", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/me/gradebook/route");
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.count).toBe(1);
    expect(d.enrollments[0].studentName).toBe("Sky Student");
  });
});

describe("GET /api/me/transcript", () => {
  it("403 for a teacher", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/me/transcript/route");
    expect((await GET(new Request("http://x"))).status).toBe(403);
  });
  it("404 when the student has no profile", async () => {
    currentCtx = STUDENT_NO_PROFILE;
    const { GET } = await import("../../app/api/me/transcript/route");
    expect((await GET(new Request("http://x"))).status).toBe(404);
  });
  it("200 returns the caller's own transcript", async () => {
    currentCtx = STUDENT;
    const { GET } = await import("../../app/api/me/transcript/route");
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.student.fullName).toBe("Sky Student");
  });
});

describe("GET /api/me/enrollments", () => {
  it("403 for a teacher", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/me/enrollments/route");
    expect((await GET(new Request("http://x"))).status).toBe(403);
  });
  it("200 returns the student's own enrollments", async () => {
    currentCtx = STUDENT;
    const { GET } = await import("../../app/api/me/enrollments/route");
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.count).toBe(1);
    expect(d.enrollments[0].classSubject).toBe("Algebra");
  });
});

/**
 * API tests for the staff lifecycle endpoint: POST /api/staff/status
 * (Module 2 — activate / leave / retire / terminate).
 *
 * Strategy mirrors the other API tests: mock the auth context (to drive RBAC)
 * and the db client (an in-memory fake of the slice of Drizzle the service
 * uses: select+innerJoin+where+limit, update+set+where, transaction).
 *
 * Run: npx vitest run src/modules/hr/staff_status.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthContext } from "../../lib/auth";
import { AuthError } from "../../lib/auth";

/* ── Mock auth: each test sets `currentCtx` (or an error) ────────── */
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

/* ── Mock db client with a minimal in-memory fake ───────────────── */
interface StaffRow {
  id: string;
  userId: string;
  branchId: string;
  status: string;
  retirementDate?: string | null;
  [k: string]: unknown;
}
interface FakeState {
  users: Array<Record<string, unknown>>;
  staff: StaffRow[];
}
let state: FakeState;

function makeFakeDb() {
  const tx = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (clause: { __val?: string }) => ({
            limit: () => {
              const s = state.staff.find((x) => x.id === clause?.__val);
              if (!s) return [];
              const u =
                state.users.find((x) => x.id === s.userId) ??
                ({} as Record<string, unknown>);
              return [
                {
                  id: s.id,
                  branchId: s.branchId,
                  status: s.status,
                  fullName: u.fullName,
                  email: u.email,
                },
              ];
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: (clause: { __val?: string }) => {
          const s = state.staff.find((x) => x.id === clause?.__val);
          if (s) Object.assign(s, vals);
          return Promise.resolve();
        },
      }),
    }),
    // writeAudit calls insert().values() without .returning().
    insert: () => ({ values: () => ({ returning: () => [{ id: "audit" }] }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx;
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));

// Intercept the service's eq() with a simple marker our fake reads.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({
      __col: col?.name,
      __val: val,
    }),
  };
});

const STAFF_ID = "55555555-5555-5555-5555-555555555555";
const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "44444444-4444-4444-4444-444444444444";

const SUPER_ADMIN: AuthContext = {
  userId: "sa-1",
  role: "super_admin",
  orgId: null,
  branchId: null,
};
const BRANCH_MGR: AuthContext = {
  userId: "bm-1",
  role: "branch_manager",
  orgId: "22222222-2222-2222-2222-222222222222",
  branchId: BRANCH_A,
};
const TEACHER: AuthContext = {
  userId: "t-1",
  role: "teacher",
  orgId: "22222222-2222-2222-2222-222222222222",
  branchId: BRANCH_A,
};

function postReq(body: unknown): Request {
  return new Request("http://x/api/staff/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function seedStaff(status: string, branchId = BRANCH_A) {
  state.users.push({ id: "u1", fullName: "Pat Educator", email: "pat@s.edu" });
  state.staff.push({ id: STAFF_ID, userId: "u1", branchId, status });
}

beforeEach(() => {
  state = { users: [], staff: [] };
  vi.resetModules();
});

describe("POST /api/staff/status", () => {
  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/staff/status/route");
    const res = await POST(postReq({ staffProfileId: STAFF_ID, status: "active" }));
    expect(res.status).toBe(401);
  });

  it("403 for a teacher (RBAC)", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/staff/status/route");
    const res = await POST(postReq({ staffProfileId: STAFF_ID, status: "active" }));
    expect(res.status).toBe(403);
  });

  it("400 on an invalid status value", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/staff/status/route");
    const res = await POST(postReq({ staffProfileId: STAFF_ID, status: "ghost" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.status).toBeDefined();
  });

  it("400 when the staff profile does not exist", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/staff/status/route");
    const res = await POST(postReq({ staffProfileId: STAFF_ID, status: "active" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.staffProfileId).toBe("no such staff profile");
  });

  it("200 activates an onboarding staff member", async () => {
    currentCtx = SUPER_ADMIN;
    seedStaff("onboarding");
    const { POST } = await import("../../app/api/staff/status/route");
    const res = await POST(postReq({ staffProfileId: STAFF_ID, status: "active" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("active");
    expect(state.staff[0].status).toBe("active");
  });

  it("400 on an illegal transition (terminated -> active)", async () => {
    currentCtx = SUPER_ADMIN;
    seedStaff("terminated");
    const { POST } = await import("../../app/api/staff/status/route");
    const res = await POST(postReq({ staffProfileId: STAFF_ID, status: "active" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.status).toContain("invalid transition");
    expect(state.staff[0].status).toBe("terminated");
  });

  it("200 retiring an active member stamps a retirementDate", async () => {
    currentCtx = SUPER_ADMIN;
    seedStaff("active");
    const { POST } = await import("../../app/api/staff/status/route");
    const res = await POST(
      postReq({
        staffProfileId: STAFF_ID,
        status: "retired",
        effectiveDate: "2026-06-30",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).retirementDate).toBe("2026-06-30");
    expect(state.staff[0].retirementDate).toBe("2026-06-30");
  });

  it("403 when a branch_manager acts on staff in another branch", async () => {
    currentCtx = BRANCH_MGR;
    seedStaff("onboarding", BRANCH_B);
    const { POST } = await import("../../app/api/staff/status/route");
    const res = await POST(postReq({ staffProfileId: STAFF_ID, status: "active" }));
    expect(res.status).toBe(403);
    expect(state.staff[0].status).toBe("onboarding");
  });

  it("200 when a branch_manager acts on staff in their OWN branch", async () => {
    currentCtx = BRANCH_MGR;
    seedStaff("onboarding", BRANCH_A);
    const { POST } = await import("../../app/api/staff/status/route");
    const res = await POST(postReq({ staffProfileId: STAFF_ID, status: "active" }));
    expect(res.status).toBe(200);
    expect(state.staff[0].status).toBe("active");
  });
});

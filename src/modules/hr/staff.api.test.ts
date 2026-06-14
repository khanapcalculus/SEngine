/**
 * API tests for Module 2 (HR & Staff) endpoints.
 *
 * Strategy: mock the auth context (to drive RBAC paths) and the db client
 * (an in-memory fake that mimics the tiny slice of the Drizzle query builder
 * the service uses). This exercises the full route -> RBAC -> validation ->
 * service path without a live database, so it runs in CI and at the edge.
 *
 * Run: npx vitest run src/modules/hr/staff.api.test.ts
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
interface FakeState {
  users: Array<Record<string, unknown>>;
  staff: Array<Record<string, unknown>>;
}
let state: FakeState;

function makeFakeDb() {
  // select().from().where().limit() and innerJoin chains resolve to arrays.
  const tx = {
    select: (_cols?: unknown) => ({
      from: (table: { _name?: string }) => {
        const tableName = fakeTableName(table);
        const chain = {
          _filterEmail: undefined as string | undefined,
          _branchActive: undefined as string | undefined,
          _branchAll: undefined as string | undefined,
          where: (clause: {
            __email?: string;
            __branch?: string;
            __col?: string;
            __val?: string;
          }) => {
            if (clause?.__email) chain._filterEmail = clause.__email;
            if (clause?.__branch) chain._branchActive = clause.__branch;
            if (clause?.__col === "branch_id") chain._branchAll = clause.__val;
            return chain;
          },
          innerJoin: () => chain,
          limit: () => resolve(),
          then: (res: (v: unknown[]) => void) => res(resolve()),
        };
        function rowFor(s: Record<string, unknown>) {
          const u = state.users.find((x) => x.id === s.userId)!;
          return {
            staffProfileId: s.id,
            userId: u.id,
            fullName: u.fullName,
            email: u.email,
            department: s.department,
            status: s.status,
            hireDate: s.hireDate,
          };
        }
        function resolve(): unknown[] {
          if (tableName === "users" && chain._filterEmail) {
            return state.users
              .filter((u) => u.email === chain._filterEmail)
              .map((u) => ({ id: u.id }));
          }
          if (tableName === "staff_profiles" && chain._branchActive) {
            return state.staff
              .filter(
                (s) =>
                  s.branchId === chain._branchActive && s.status === "active",
              )
              .map(rowFor);
          }
          if (tableName === "staff_profiles" && chain._branchAll) {
            // listStaffForBranch: all statuses for the branch.
            return state.staff
              .filter((s) => s.branchId === chain._branchAll)
              .map(rowFor);
          }
          return [];
        }
        return chain;
      },
    }),
    insert: (table: { _name?: string }) => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          const tableName = fakeTableName(table);
          if (tableName === "users") {
            const row = { id: `user-${state.users.length + 1}`, ...vals };
            state.users.push(row);
            return [{ id: row.id, email: vals.email }];
          }
          const row = { id: `staff-${state.staff.length + 1}`, ...vals };
          state.staff.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx;
}

// drizzle table objects carry their SQL name on a symbol; the service passes
// the real schema tables, so we sniff a stable marker we control in the mock.
function fakeTableName(table: unknown): string {
  const name = (table as { _name?: string })?._name;
  if (name) return name;
  // Fall back to the real drizzle table name symbol.
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return sym
    ? String((table as Record<symbol, unknown>)[sym])
    : "";
}

vi.mock("../../db/client", () => ({
  getDb: () => makeFakeDb(),
}));

// The where() clauses in the service are drizzle SQL objects; intercept the
// service's eq/and by re-mocking them to the simple markers our fake reads.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => {
      const c = col?.name;
      if (c === "email") return { __email: val };
      return { __col: c, __val: val };
    },
    and: (...clauses: Array<Record<string, unknown>>) => {
      // staff branch+status filter -> mark branch lookup
      const branch = clauses.find((c) => c.__col === "branch_id");
      if (branch) return { __branch: branch.__val };
      return Object.assign({}, ...clauses);
    },
  };
});

const VALID_BODY = {
  email: "jane@school.edu",
  fullName: "Jane Educator",
  branchId: "11111111-1111-1111-1111-111111111111",
  orgId: "22222222-2222-2222-2222-222222222222",
  department: "Mathematics",
  hireDate: "2026-01-15",
};

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
  branchId: "11111111-1111-1111-1111-111111111111",
};
const TEACHER: AuthContext = {
  userId: "t-1",
  role: "teacher",
  orgId: "22222222-2222-2222-2222-222222222222",
  branchId: "11111111-1111-1111-1111-111111111111",
};

function postReq(body: unknown): Request {
  return new Request("http://x/api/staff/onboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  state = { users: [], staff: [] };
  vi.resetModules();
});

describe("POST /api/staff/onboard", () => {
  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/staff/onboard/route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("403 when role is a teacher (RBAC)", async () => {
    currentCtx = TEACHER;
    const { POST } = await import("../../app/api/staff/onboard/route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it("400 on invalid JSON body fields", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/staff/onboard/route");
    const res = await POST(postReq({ ...VALID_BODY, email: "nope" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields.email).toBeDefined();
  });

  it("400 on malformed JSON", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/staff/onboard/route");
    const res = await POST(postReq("{not json"));
    expect(res.status).toBe(400);
  });

  it("403 when branch_manager onboards outside their org", async () => {
    currentCtx = BRANCH_MGR;
    const { POST } = await import("../../app/api/staff/onboard/route");
    const res = await POST(
      postReq({ ...VALID_BODY, orgId: "33333333-3333-3333-3333-333333333333" }),
    );
    expect(res.status).toBe(403);
  });

  it("403 when branch_manager onboards into another branch", async () => {
    currentCtx = BRANCH_MGR;
    const { POST } = await import("../../app/api/staff/onboard/route");
    const res = await POST(
      postReq({
        ...VALID_BODY,
        branchId: "44444444-4444-4444-4444-444444444444",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("201 creates user + profile for super_admin", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/staff/onboard/route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.userId).toBeTruthy();
    expect(data.staffProfileId).toBeTruthy();
    expect(state.users).toHaveLength(1);
    expect(state.staff).toHaveLength(1);
    expect(state.users[0].role).toBe("teacher");
  });

  it("409-style 400 on duplicate email", async () => {
    currentCtx = SUPER_ADMIN;
    state.users.push({ id: "u0", email: VALID_BODY.email });
    const { POST } = await import("../../app/api/staff/onboard/route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields.email).toBe("already in use");
  });
});

describe("GET /api/staff/branch/[branchId]", () => {
  const branchId = VALID_BODY.branchId;

  it("403 for non-privileged role", async () => {
    currentCtx = TEACHER;
    const { GET } = await import("../../app/api/staff/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId }),
    });
    expect(res.status).toBe(403);
  });

  it("400 when branchId is not a UUID", async () => {
    currentCtx = BRANCH_MGR;
    const { GET } = await import("../../app/api/staff/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("200 returns ALL staff for the branch (any lifecycle status)", async () => {
    currentCtx = SUPER_ADMIN;
    state.users.push(
      { id: "u1", fullName: "Active One", email: "a@s.edu" },
      { id: "u2", fullName: "Onboarding Two", email: "b@s.edu" },
    );
    state.staff.push(
      {
        id: "s1",
        userId: "u1",
        branchId,
        department: "Math",
        status: "active",
        hireDate: "2026-01-01",
      },
      {
        id: "s2",
        userId: "u2",
        branchId,
        department: "Science",
        status: "onboarding",
        hireDate: "2026-02-01",
      },
    );
    const { GET } = await import("../../app/api/staff/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ branchId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(2);
    const statuses = data.staff.map((s: { status: string }) => s.status).sort();
    expect(statuses).toEqual(["active", "onboarding"]);
  });

  it("403 when branch_manager reads another branch roster", async () => {
    currentCtx = BRANCH_MGR;
    const { GET } = await import("../../app/api/staff/branch/[branchId]/route");
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({
        branchId: "44444444-4444-4444-4444-444444444444",
      }),
    });
    expect(res.status).toBe(403);
  });
});

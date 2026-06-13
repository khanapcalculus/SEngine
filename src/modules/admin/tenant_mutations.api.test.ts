/**
 * API tests for the super admin tenant provisioning endpoints:
 *   POST /api/admin/organizations
 *   POST /api/admin/branches
 *
 * Strategy mirrors the HR tests: mock the auth context (to drive RBAC) and the
 * db client (an in-memory fake of the slice of Drizzle the services use). This
 * exercises route -> RBAC -> validation -> service without a live database.
 *
 * Run: npx vitest run src/modules/admin/tenant_mutations.api.test.ts
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
  organizations: Array<Record<string, unknown>>;
  branches: Array<Record<string, unknown>>;
}
let state: FakeState;

function makeFakeDb() {
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        const tableName = fakeTableName(table);
        const chain = {
          _orgId: undefined as string | undefined,
          where: (clause: { __col?: string; __val?: string }) => {
            if (clause?.__col === "id") chain._orgId = clause.__val;
            return chain;
          },
          limit: () => resolve(),
          then: (res: (v: unknown[]) => void) => res(resolve()),
        };
        function resolve(): unknown[] {
          if (tableName === "organizations" && chain._orgId) {
            return state.organizations
              .filter((o) => o.id === chain._orgId)
              .map((o) => ({ id: o.id }));
          }
          return [];
        }
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => ({
        // writeAudit calls .values() without .returning(); awaiting the object
        // is a harmless no-op, so audit rows are simply not tracked here.
        returning: () => {
          const tableName = fakeTableName(table);
          if (tableName === "organizations") {
            const row = { id: `org-${state.organizations.length + 1}`, ...vals };
            state.organizations.push(row);
            return [row];
          }
          if (tableName === "branches") {
            const row = { id: `branch-${state.branches.length + 1}`, ...vals };
            state.branches.push(row);
            return [row];
          }
          return [{ id: "audit-x" }];
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx;
}

function fakeTableName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return sym ? String((table as Record<symbol, unknown>)[sym]) : "";
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));

// Intercept the service's eq() with a simple marker our fake select reads.
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

const ORG_UUID = "22222222-2222-2222-2222-222222222222";

function postReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  state = { organizations: [], branches: [] };
  vi.resetModules();
});

describe("POST /api/admin/organizations", () => {
  const url = "http://x/api/admin/organizations";

  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/admin/organizations/route");
    expect((await POST(postReq(url, { name: "West Network" }))).status).toBe(
      401,
    );
  });

  it("403 for a branch manager (RBAC)", async () => {
    currentCtx = BRANCH_MGR;
    const { POST } = await import("../../app/api/admin/organizations/route");
    expect((await POST(postReq(url, { name: "West Network" }))).status).toBe(
      403,
    );
  });

  it("400 on empty name", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/admin/organizations/route");
    const res = await POST(postReq(url, { name: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.name).toBeDefined();
  });

  it("201 creates an organization for a super admin", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/admin/organizations/route");
    const res = await POST(postReq(url, { name: "West Network" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.name).toBe("West Network");
    expect(state.organizations).toHaveLength(1);
  });
});

describe("POST /api/admin/branches", () => {
  const url = "http://x/api/admin/branches";

  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { POST } = await import("../../app/api/admin/branches/route");
    const res = await POST(
      postReq(url, { orgId: ORG_UUID, location: "Riverside Campus" }),
    );
    expect(res.status).toBe(401);
  });

  it("403 for a branch manager (RBAC)", async () => {
    currentCtx = BRANCH_MGR;
    const { POST } = await import("../../app/api/admin/branches/route");
    const res = await POST(
      postReq(url, { orgId: ORG_UUID, location: "Riverside Campus" }),
    );
    expect(res.status).toBe(403);
  });

  it("400 when orgId is not a UUID", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/admin/branches/route");
    const res = await POST(
      postReq(url, { orgId: "nope", location: "Riverside Campus" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fields.orgId).toBeDefined();
  });

  it("400 when the organization does not exist", async () => {
    currentCtx = SUPER_ADMIN;
    const { POST } = await import("../../app/api/admin/branches/route");
    const res = await POST(
      postReq(url, { orgId: ORG_UUID, location: "Riverside Campus" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fields.orgId).toBe("unknown organization");
  });

  it("201 creates a branch in an existing org (defaults status to active)", async () => {
    currentCtx = SUPER_ADMIN;
    state.organizations.push({ id: ORG_UUID, name: "East Network" });
    const { POST } = await import("../../app/api/admin/branches/route");
    const res = await POST(
      postReq(url, { orgId: ORG_UUID, location: "Riverside Campus" }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.orgId).toBe(ORG_UUID);
    expect(data.status).toBe("active");
    expect(state.branches).toHaveLength(1);
  });

  it("400 on an invalid status value", async () => {
    currentCtx = SUPER_ADMIN;
    state.organizations.push({ id: ORG_UUID, name: "East Network" });
    const { POST } = await import("../../app/api/admin/branches/route");
    const res = await POST(
      postReq(url, {
        orgId: ORG_UUID,
        location: "Riverside Campus",
        status: "haunted",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fields.status).toBeDefined();
  });
});

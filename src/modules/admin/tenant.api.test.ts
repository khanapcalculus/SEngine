/**
 * API tests for the super admin tenant-tree endpoint.
 *
 * The route returns the organization -> branch hierarchy the dashboard uses to
 * let a super admin switch between managed branches without typing ids by hand.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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

interface Row {
  id: string;
  [k: string]: unknown;
}
interface FakeState {
  organizations: Row[];
  branches: Row[];
}
let state: FakeState;

function tableName(table: unknown): keyof FakeState {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return String((table as Record<symbol, unknown>)[sym!]) as keyof FakeState;
}

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        const rows = state[name];
        return {
          then: (resolve: (v: Row[]) => void) => resolve(rows),
        };
      },
    }),
  };
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));

const SUPER_ADMIN: AuthContext = {
  userId: "sa-1",
  role: "super_admin",
  orgId: null,
  branchId: null,
};

const BRANCH_MANAGER: AuthContext = {
  userId: "bm-1",
  role: "branch_manager",
  orgId: "org-1",
  branchId: "branch-1",
};

beforeEach(() => {
  state = {
    organizations: [],
    branches: [],
  };
});

describe("GET /api/admin/tenant-tree", () => {
  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { GET } = await import("../../app/api/admin/tenant-tree/route");
    expect((await GET(new Request("http://x"))).status).toBe(401);
  });

  it("403 for a branch manager", async () => {
    currentCtx = BRANCH_MANAGER;
    const { GET } = await import("../../app/api/admin/tenant-tree/route");
    expect((await GET(new Request("http://x"))).status).toBe(403);
  });

  it("200 returns the organization tree for a super admin", async () => {
    currentCtx = SUPER_ADMIN;
    state.organizations.push(
      { id: "org-2", name: "West Network" },
      { id: "org-1", name: "East Network" },
    );
    state.branches.push(
      { id: "branch-2", orgId: "org-1", location: "Beta Campus", status: "pending" },
      { id: "branch-3", orgId: "org-2", location: "Gamma Campus", status: "inactive" },
      { id: "branch-1", orgId: "org-1", location: "Alpha Campus", status: "active" },
    );

    const { GET } = await import("../../app/api/admin/tenant-tree/route");
    const res = await GET(new Request("http://x"));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(2);
    expect(data.organizations[0].name).toBe("East Network");
    expect(data.organizations[0].branches).toHaveLength(2);
    expect(data.organizations[0].branches[0].location).toBe("Alpha Campus");
    expect(data.organizations[1].branches[0].status).toBe("inactive");
  });
});

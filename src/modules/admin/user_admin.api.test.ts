/**
 * API tests for the super-admin User Management endpoints:
 *   GET   /api/admin/users
 *   PATCH /api/admin/users/[userId]
 *
 * Same strategy as tenant_mutations.api.test.ts: mock the auth context (to drive
 * RBAC) and the db client (an in-memory fake of the slice of Drizzle the service
 * uses). Exercises route -> RBAC -> validation -> service without a live DB.
 *
 * Run: npx vitest run src/modules/admin/user_admin.api.test.ts
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

/* ── Mock db client ─────────────────────────────────────────────── */
interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  globalStatus: string;
  passwordHash: string | null;
  orgId: string | null;
  createdAt: Date;
}
interface FakeState {
  users: UserRow[];
  audit: Array<Record<string, unknown>>;
}
let state: FakeState;

type Clause =
  | { __op: "eq"; col: string; val: unknown }
  | { __op: "ne"; col: string; val: unknown }
  | { __op: "and"; clauses: Clause[] }
  | undefined;

function matches(row: Record<string, unknown>, clause: Clause): boolean {
  if (!clause) return true;
  if (clause.__op === "and") return clause.clauses.every((c) => matches(row, c));
  if (clause.__op === "eq") return row[clause.col] === clause.val;
  if (clause.__op === "ne") return row[clause.col] !== clause.val;
  return true;
}

function fakeTableName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return sym ? String((table as Record<symbol, unknown>)[sym]) : "";
}

function makeFakeDb() {
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        const name = fakeTableName(table);
        let clause: Clause;
        const rowsFor = () =>
          name === "users"
            ? state.users
                .filter((r) => matches(r as unknown as Record<string, unknown>, clause))
                .map((r) => ({ ...r }))
            : [];
        const chain = {
          where: (c: Clause) => ((clause = c), chain),
          orderBy: () => rowsFor(),
          limit: () => rowsFor(),
          then: (res: (v: unknown[]) => void) => res(rowsFor()),
        };
        return chain;
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (clause: Clause) => ({
          returning: () => {
            if (fakeTableName(table) !== "users") return [];
            const updated: UserRow[] = [];
            for (const r of state.users) {
              if (matches(r as unknown as Record<string, unknown>, clause)) {
                Object.assign(r, vals);
                updated.push({ ...r });
              }
            }
            return updated;
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (fakeTableName(table) === "audit_logs") state.audit.push(vals);
        return undefined;
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx;
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));

// Replace the real drizzle operators with markers our fake interprets.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({
      __op: "eq",
      col: col?.name,
      val,
    }),
    ne: (col: { name?: string }, val: unknown) => ({
      __op: "ne",
      col: col?.name,
      val,
    }),
    and: (...clauses: unknown[]) => ({ __op: "and", clauses }),
    desc: (col: unknown) => col,
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

const U1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function seedUsers() {
  state.users = [
    {
      id: U1,
      email: "ada@school.test",
      fullName: "Ada Lovelace",
      role: "teacher",
      globalStatus: "active",
      passwordHash: "pbkdf2$1$x$y",
      orgId: "22222222-2222-2222-2222-222222222222",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: U2,
      email: "grace@school.test",
      fullName: "Grace Hopper",
      role: "student",
      globalStatus: "active",
      passwordHash: null,
      orgId: "22222222-2222-2222-2222-222222222222",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    },
  ];
}

function patchReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  state = { users: [], audit: [] };
  vi.resetModules();
});

describe("GET /api/admin/users", () => {
  const url = "http://x/api/admin/users";

  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { GET } = await import("../../app/api/admin/users/route");
    expect((await GET(new Request(url))).status).toBe(401);
  });

  it("403 for a branch manager (RBAC)", async () => {
    currentCtx = BRANCH_MGR;
    const { GET } = await import("../../app/api/admin/users/route");
    expect((await GET(new Request(url))).status).toBe(403);
  });

  it("200 returns users with a hasPassword flag (no hash leaked)", async () => {
    currentCtx = SUPER_ADMIN;
    seedUsers();
    const { GET } = await import("../../app/api/admin/users/route");
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(2);
    const ada = data.users.find((u: { id: string }) => u.id === U1);
    expect(ada.hasPassword).toBe(true);
    expect(ada.passwordHash).toBeUndefined();
    const grace = data.users.find((u: { id: string }) => u.id === U2);
    expect(grace.hasPassword).toBe(false);
  });
});

describe("PATCH /api/admin/users/[userId]", () => {
  const url = `http://x/api/admin/users/${U1}`;
  const params = { params: Promise.resolve({ userId: U1 }) };

  it("401 when unauthenticated", async () => {
    currentCtx = new AuthError(401, "no auth");
    const { PATCH } = await import("../../app/api/admin/users/[userId]/route");
    const res = await PATCH(patchReq(url, { fullName: "X" }), params);
    expect(res.status).toBe(401);
  });

  it("403 for a branch manager (RBAC)", async () => {
    currentCtx = BRANCH_MGR;
    const { PATCH } = await import("../../app/api/admin/users/[userId]/route");
    const res = await PATCH(patchReq(url, { fullName: "X" }), params);
    expect(res.status).toBe(403);
  });

  it("400 when userId is not a UUID", async () => {
    currentCtx = SUPER_ADMIN;
    const { PATCH } = await import("../../app/api/admin/users/[userId]/route");
    const res = await PATCH(patchReq("http://x/api/admin/users/nope", {
      fullName: "X",
    }), { params: Promise.resolve({ userId: "nope" }) });
    expect(res.status).toBe(400);
  });

  it("400 when the body has no updatable fields", async () => {
    currentCtx = SUPER_ADMIN;
    seedUsers();
    const { PATCH } = await import("../../app/api/admin/users/[userId]/route");
    const res = await PATCH(patchReq(url, {}), params);
    expect(res.status).toBe(400);
  });

  it("404 when the user does not exist", async () => {
    currentCtx = SUPER_ADMIN;
    seedUsers();
    const missing = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const { PATCH } = await import("../../app/api/admin/users/[userId]/route");
    const res = await PATCH(
      patchReq(`http://x/api/admin/users/${missing}`, { fullName: "Nobody" }),
      { params: Promise.resolve({ userId: missing }) },
    );
    expect(res.status).toBe(404);
  });

  it("400 when the new email is already used by another user", async () => {
    currentCtx = SUPER_ADMIN;
    seedUsers();
    const { PATCH } = await import("../../app/api/admin/users/[userId]/route");
    const res = await PATCH(
      patchReq(url, { email: "grace@school.test" }),
      params,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fields.email).toBeDefined();
  });

  it("200 updates name + email and writes an audit row", async () => {
    currentCtx = SUPER_ADMIN;
    seedUsers();
    const { PATCH } = await import("../../app/api/admin/users/[userId]/route");
    const res = await PATCH(
      patchReq(url, { fullName: "Ada L.", email: "ada.l@school.test" }),
      params,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.fullName).toBe("Ada L.");
    expect(data.email).toBe("ada.l@school.test");
    expect(state.users[0].fullName).toBe("Ada L.");
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0].action).toBe("user.profile.update");
  });

  it("200 allows keeping the same email (no false self-collision)", async () => {
    currentCtx = SUPER_ADMIN;
    seedUsers();
    const { PATCH } = await import("../../app/api/admin/users/[userId]/route");
    const res = await PATCH(
      patchReq(url, { fullName: "Ada Byron", email: "ada@school.test" }),
      params,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).fullName).toBe("Ada Byron");
  });
});

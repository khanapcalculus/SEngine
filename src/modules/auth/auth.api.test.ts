/**
 * API tests for the login route + getAuthContext verification.
 *
 * The DB is mocked; real crypto/JWT run (they're edge-portable and fast). This
 * proves: tokens are issued on valid creds, rejected on bad creds without
 * account enumeration, the cookie is hardened, and a freshly-issued token is
 * accepted by getAuthContext while a forged one is not.
 *
 * Run: npx vitest run src/modules/auth/auth.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { hashPassword } from "../../lib/crypto";
import { getAuthContext, AuthError } from "../../lib/auth";

/* ── Mock drizzle-orm eq into a readable marker ─────────────────── */
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __col: col?.name, __val: val }),
  };
});

/* ── In-memory fake DB ──────────────────────────────────────────── */
interface Row { [k: string]: unknown }
let users: Row[];
let staff: Row[];

function tableName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    s.toString().includes("Name"),
  );
  return String((table as Record<symbol, unknown>)[sym!]);
}

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        let clause: { __col?: string; __val?: unknown } = {};
        const chain: any = {
          where: (c: { __col?: string; __val?: unknown }) => {
            clause = c;
            return chain;
          },
          limit: () => {
            if (name === "users")
              return users.filter((u) => u.email === clause.__val || u.id === clause.__val);
            return staff.filter((s) => s.userId === clause.__val);
          },
        };
        return chain;
      },
    }),
  };
}

vi.mock("../../db/client", () => ({ getDb: () => makeFakeDb() }));

const SECRET = "unit-test-secret-32-characters-long!!";

function loginReq(body: unknown): Request {
  return new Request("http://x/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  users = [];
  staff = [];
  process.env.AUTH_JWT_SECRET = SECRET;
  // Seed Meghan Meyer (teacher) with a real PBKDF2 hash.
  users.push({
    id: "11111111-1111-1111-1111-111111111111",
    email: "meghan@lincolnhigh.edu",
    role: "teacher",
    orgId: "22222222-2222-2222-2222-222222222222",
    globalStatus: "active",
    passwordHash: await hashPassword("Calculus#2026"),
  });
  staff.push({
    userId: "11111111-1111-1111-1111-111111111111",
    branchId: "33333333-3333-3333-3333-333333333333",
  });
});

describe("POST /api/auth/login", () => {
  it("200 issues a token + hardened cookie on valid credentials", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      loginReq({ email: "meghan@lincolnhigh.edu", password: "Calculus#2026" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token.split(".")).toHaveLength(3);
    expect(data.user.role).toBe("teacher");
    expect(data.user.branchId).toBe("33333333-3333-3333-3333-333333333333");

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("401 on wrong password (generic, non-enumerating)", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      loginReq({ email: "meghan@lincolnhigh.edu", password: "wrong" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid email or password");
  });

  it("401 on unknown email with the SAME generic error", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      loginReq({ email: "ghost@nowhere.edu", password: "whatever" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid email or password");
  });

  it("401 when the account is suspended", async () => {
    users[0].globalStatus = "suspended";
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      loginReq({ email: "meghan@lincolnhigh.edu", password: "Calculus#2026" }),
    );
    expect(res.status).toBe(401);
  });

  it("400 on invalid body", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    expect((await POST(loginReq({ email: "bad" }))).status).toBe(400);
  });

  it("500 when AUTH_JWT_SECRET is misconfigured", async () => {
    delete process.env.AUTH_JWT_SECRET;
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      loginReq({ email: "meghan@lincolnhigh.edu", password: "Calculus#2026" }),
    );
    expect(res.status).toBe(500);
  });
});

describe("getAuthContext end-to-end", () => {
  it("accepts a token freshly issued by login and rebuilds the context", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const loginRes = await POST(
      loginReq({ email: "meghan@lincolnhigh.edu", password: "Calculus#2026" }),
    );
    const { token } = await loginRes.json();

    const ctx = await getAuthContext(
      new Request("http://x/api/protected", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(ctx.userId).toBe("11111111-1111-1111-1111-111111111111");
    expect(ctx.role).toBe("teacher");
    expect(ctx.branchId).toBe("33333333-3333-3333-3333-333333333333");
  });

  it("reads the token from the session cookie too", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const loginRes = await POST(
      loginReq({ email: "meghan@lincolnhigh.edu", password: "Calculus#2026" }),
    );
    const { token } = await loginRes.json();

    const ctx = await getAuthContext(
      new Request("http://x/api/protected", {
        headers: { cookie: `sengine_session=${token}; other=1` },
      }),
    );
    expect(ctx.role).toBe("teacher");
  });

  it("401 when no token is present", async () => {
    await expect(
      getAuthContext(new Request("http://x/api/protected")),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("401 on a forged/garbage token", async () => {
    await expect(
      getAuthContext(
        new Request("http://x", { headers: { authorization: "Bearer a.b.c" } }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});

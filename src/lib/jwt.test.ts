/**
 * Tests for the HS256 JWT sign/verify implementation.
 * Run: npx vitest run src/lib/jwt.test.ts
 */
import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt, JwtVerifyError } from "./jwt";

const SECRET = "test-secret-at-least-16-chars-long";
const BASE = {
  sub: "user-1",
  role: "teacher" as const,
  orgId: "org-1",
  branchId: "branch-1",
};

describe("signJwt / verifyJwt", () => {
  it("round-trips claims and embeds id/role/org/branch", async () => {
    const token = await signJwt(BASE, SECRET, { nowSeconds: 1000, ttlSeconds: 3600 });
    const claims = await verifyJwt(token, SECRET, { nowSeconds: 1000 });
    expect(claims.sub).toBe("user-1");
    expect(claims.role).toBe("teacher");
    expect(claims.orgId).toBe("org-1");
    expect(claims.branchId).toBe("branch-1");
    expect(claims.exp).toBe(1000 + 3600);
  });

  it("rejects a tampered payload (bad signature)", async () => {
    const token = await signJwt(BASE, SECRET, { nowSeconds: 1000, ttlSeconds: 3600 });
    const [h, , s] = token.split(".");
    // Swap in a payload claiming super_admin.
    const forged = `${h}.${btoa(JSON.stringify({ ...BASE, role: "super_admin", iat: 1000, exp: 4600 })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.${s}`;
    await expect(verifyJwt(forged, SECRET, { nowSeconds: 1000 })).rejects.toBeInstanceOf(JwtVerifyError);
  });

  it("rejects a wrong secret", async () => {
    const token = await signJwt(BASE, SECRET, { nowSeconds: 1000, ttlSeconds: 3600 });
    await expect(
      verifyJwt(token, "another-secret-16chars", { nowSeconds: 1000 }),
    ).rejects.toMatchObject({ reason: "bad_signature" });
  });

  it("rejects an expired token", async () => {
    const token = await signJwt(BASE, SECRET, { nowSeconds: 1000, ttlSeconds: 100 });
    await expect(
      verifyJwt(token, SECRET, { nowSeconds: 2000 }),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("rejects a malformed token", async () => {
    await expect(verifyJwt("not.a.jwt.token", SECRET, { nowSeconds: 1 })).rejects.toBeInstanceOf(JwtVerifyError);
    await expect(verifyJwt("onlyonepart", SECRET, { nowSeconds: 1 })).rejects.toMatchObject({ reason: "malformed" });
  });

  it("rejects alg confusion (non-HS256 header)", async () => {
    const noneHeader = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
      .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const payload = btoa(JSON.stringify({ ...BASE, iat: 1, exp: 9999 }))
      .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    await expect(
      verifyJwt(`${noneHeader}.${payload}.`, SECRET, { nowSeconds: 2 }),
    ).rejects.toMatchObject({ reason: "wrong_alg" });
  });
});

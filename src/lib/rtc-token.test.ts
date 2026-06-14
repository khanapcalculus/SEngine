/**
 * Tests for the short-lived RTC handshake token (sign/verify).
 * Run: npx vitest run src/lib/rtc-token.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  signRtcToken,
  verifyRtcToken,
  RtcTokenVerifyError,
  RTC_TOKEN_TTL_SECONDS,
} from "./rtc-token";

const SECRET = "rtc-test-secret-at-least-16-chars";
const BASE = {
  sub: "user-1",
  classId: "11111111-1111-1111-1111-111111111111",
  role: "teacher" as const,
  canDraw: true,
};

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

describe("signRtcToken / verifyRtcToken", () => {
  it("round-trips claims and embeds classId + canDraw", async () => {
    const token = await signRtcToken(BASE, SECRET, { nowSeconds: 1000 });
    const claims = await verifyRtcToken(token, SECRET, { nowSeconds: 1000 });
    expect(claims.sub).toBe("user-1");
    expect(claims.classId).toBe(BASE.classId);
    expect(claims.role).toBe("teacher");
    expect(claims.canDraw).toBe(true);
    expect(claims.exp).toBe(1000 + RTC_TOKEN_TTL_SECONDS);
  });

  it("honours a custom ttl", async () => {
    const token = await signRtcToken(BASE, SECRET, {
      nowSeconds: 1000,
      ttlSeconds: 5,
    });
    const claims = await verifyRtcToken(token, SECRET, { nowSeconds: 1004 });
    expect(claims.exp).toBe(1005);
  });

  it("rejects a tampered payload claiming canDraw", async () => {
    const token = await signRtcToken(
      { ...BASE, role: "student", canDraw: false },
      SECRET,
      { nowSeconds: 1000 },
    );
    const [h, , s] = token.split(".");
    const forged = `${h}.${b64url({ ...BASE, canDraw: true, iat: 1000, exp: 1060 })}.${s}`;
    await expect(
      verifyRtcToken(forged, SECRET, { nowSeconds: 1000 }),
    ).rejects.toBeInstanceOf(RtcTokenVerifyError);
  });

  it("rejects a wrong secret", async () => {
    const token = await signRtcToken(BASE, SECRET, { nowSeconds: 1000 });
    await expect(
      verifyRtcToken(token, "different-secret-16chars", { nowSeconds: 1000 }),
    ).rejects.toMatchObject({ reason: "bad_signature" });
  });

  it("rejects an expired token", async () => {
    const token = await signRtcToken(BASE, SECRET, {
      nowSeconds: 1000,
      ttlSeconds: 30,
    });
    await expect(
      verifyRtcToken(token, SECRET, { nowSeconds: 2000 }),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("rejects a session JWT reused as a handshake token (wrong typ)", async () => {
    // A normal JWT header (typ:"JWT") must not pass the RTC gate.
    const header = b64url({ alg: "HS256", typ: "JWT" });
    const payload = b64url({ ...BASE, iat: 1000, exp: 9999 });
    // Sign with the real secret so only the typ check can reject it.
    const { hmacSign, bytesToBase64Url } = await import("./crypto");
    const sig = bytesToBase64Url(
      await hmacSign(`${header}.${payload}`, SECRET),
    );
    await expect(
      verifyRtcToken(`${header}.${payload}.${sig}`, SECRET, {
        nowSeconds: 1000,
      }),
    ).rejects.toMatchObject({ reason: "wrong_typ" });
  });

  it("rejects a malformed token", async () => {
    await expect(
      verifyRtcToken("onlyonepart", SECRET, { nowSeconds: 1 }),
    ).rejects.toMatchObject({ reason: "malformed" });
  });
});

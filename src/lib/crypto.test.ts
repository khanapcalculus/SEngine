/**
 * Tests for the edge crypto primitives (WebCrypto-based).
 * Run: npx vitest run src/lib/crypto.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  timingSafeEqual,
  bytesToBase64Url,
  base64UrlToBytes,
  stringToBase64Url,
  base64UrlToString,
  generateTemporaryPassword,
} from "./crypto";

describe("base64url round-trips", () => {
  it("encodes/decodes bytes without padding", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    const enc = bytesToBase64Url(bytes);
    expect(enc).not.toContain("=");
    expect(enc).not.toContain("+");
    expect(enc).not.toContain("/");
    expect([...base64UrlToBytes(enc)]).toEqual([...bytes]);
  });

  it("round-trips unicode strings", () => {
    const s = "Raj ∑ ∂y/∂x = λ — Algebra 2";
    expect(base64UrlToString(stringToBase64Url(s))).toBe(s);
  });
});

describe("timingSafeEqual", () => {
  it("true for identical, false for differing or different-length", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("password hashing (PBKDF2)", () => {
  it("produces a self-describing hash, never plaintext", async () => {
    const hash = await hashPassword("Sup3rSecret!");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
    expect(hash).not.toContain("Sup3rSecret!");
    expect(hash.split("$")).toHaveLength(4);
  });

  it("salts: same password hashes differently each time", async () => {
    const a = await hashPassword("samePass");
    const b = await hashPassword("samePass");
    expect(a).not.toBe(b);
  });

  it("verifies the correct password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  });

  it("rejects malformed stored hashes safely", async () => {
    expect(await verifyPassword("x", "not-a-valid-hash")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2$abc$salt$hash")).toBe(false);
  });
});

describe("temporary password generation", () => {
  it("generates 8-character alphanumeric passwords", () => {
    const password = generateTemporaryPassword();
    expect(password).toHaveLength(8);
    expect(password).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it("generates different passwords each time", () => {
    const passwords = new Set();
    for (let i = 0; i < 10; i++) {
      passwords.add(generateTemporaryPassword());
    }
    expect(passwords.size).toBeGreaterThan(1);
  });

  it("generated passwords can be hashed and verified", async () => {
    const password = generateTemporaryPassword();
    const hash = await hashPassword(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("wrongpassword", hash)).toBe(false);
  });
});

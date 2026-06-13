/**
 * Edge-compatible cryptography (WebCrypto only — no Node Buffer, no bcrypt
 * native addon). Works identically in Cloudflare Workers and Node 18+.
 *
 * Provides:
 *  - base64url encode/decode for JWT segments,
 *  - PBKDF2-HMAC-SHA256 password hashing + constant-time verification,
 *  - HMAC-SHA256 sign/verify for JWTs,
 *  - timingSafeEqual for comparing secrets without leaking length/position.
 */

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * TS 6 types typed-array buffers as `ArrayBufferLike` (which includes
 * SharedArrayBuffer), but WebCrypto's `BufferSource` requires a plain
 * `ArrayBuffer`. Every view we pass originates from getRandomValues /
 * TextEncoder / atob, so it is always ArrayBuffer-backed. This narrows the
 * type for the WebCrypto calls without copying.
 */
function bs(view: Uint8Array): BufferSource {
  return view as unknown as BufferSource;
}

/* ─────────────────────── base64url (no padding) ────────────────── */

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function stringToBase64Url(s: string): string {
  return bytesToBase64Url(encoder.encode(s));
}

export function base64UrlToString(b64url: string): string {
  return decoder.decode(base64UrlToBytes(b64url));
}

/* ───────────────────── constant-time comparison ────────────────── */

/** Length-safe, constant-time byte comparison. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ─────────────────────── password hashing ──────────────────────── */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32; // 256-bit derived key

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await subtle.importKey(
    "raw",
    bs(encoder.encode(password)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: bs(salt), iterations, hash: "SHA-256" },
    keyMaterial,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Hash a plaintext password for storage.
 * Format: `pbkdf2$<iterations>$<saltB64url>$<hashB64url>` — self-describing so
 * verification needs no out-of-band parameters and iterations can be raised
 * over time without breaking old hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

/** Verify a plaintext password against a stored hash, in constant time. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;

  const salt = base64UrlToBytes(parts[2]);
  const expected = base64UrlToBytes(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/* ───────────────────────── HMAC (JWT) ──────────────────────────── */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return subtle.importKey(
    "raw",
    bs(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function hmacSign(
  data: string,
  secret: string,
): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const sig = await subtle.sign("HMAC", key, bs(encoder.encode(data)));
  return new Uint8Array(sig);
}

/** Verify an HMAC signature in constant time. */
export async function hmacVerify(
  data: string,
  signature: Uint8Array,
  secret: string,
): Promise<boolean> {
  const expected = await hmacSign(data, secret);
  return timingSafeEqual(expected, signature);
}

/* ───────────────────── temporary password generation ───────────────────── */

/**
 * Generate a secure temporary password (8-character alphanumeric string).
 * Uses cryptographically secure random values.
 */
export function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = new Uint8Array(8);
  globalThis.crypto.getRandomValues(randomValues);
  
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars[randomValues[i] % chars.length];
  }
  
  return password;
}

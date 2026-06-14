/**
 * Short-lived Real-Time Collaboration (RTC) handshake token — sign + verify.
 *
 * Distinct from the session JWT in ./jwt.ts: that one authenticates a user to
 * the Vercel API; THIS one authorizes a single WebSocket upgrade to one
 * whiteboard room on the Cloudflare Worker. It is minted by an authenticated
 * /api/me/* route (after assertClassAccess) and handed to the browser, which
 * passes it to the Worker as the `?t=` query param. The Worker verifies it
 * BEFORE upgrading the socket, so the Durable Object only ever sees connections
 * that have already cleared RBAC.
 *
 * Design notes:
 *  - HS256 over WebCrypto only (./crypto), so the SAME code verifies on Vercel's
 *    Node runtime and the Worker's edge runtime — no Node Buffer / bcrypt.
 *  - Its own secret (RTC_JWT_SECRET) and tiny TTL (~60s): a leaked handshake
 *    token grants nothing but a brief connect to one already-permitted room.
 *  - `canDraw` is decided server-side from the caller's class role and embedded
 *    here; the Worker/DO never recompute permissions from client input.
 */
import {
  stringToBase64Url,
  base64UrlToString,
  bytesToBase64Url,
  base64UrlToBytes,
  hmacSign,
  hmacVerify,
} from "./crypto";
import type { Role } from "./auth";

export interface RtcClaims {
  sub: string; // userId
  classId: string; // the whiteboard room this token unlocks
  role: Role; // caller's class-membership role
  /** Whether this peer may emit mutating ops (draw/shape/clear) vs view-only. */
  canDraw: boolean;
  iat: number; // issued-at (epoch seconds)
  exp: number; // expiry (epoch seconds)
}

const HEADER = { alg: "HS256", typ: "RTC" } as const;

/** Default handshake lifetime: long enough to connect, short enough to be safe. */
export const RTC_TOKEN_TTL_SECONDS = 60;

export type RtcTokenError =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "wrong_alg"
  | "wrong_typ";

export class RtcTokenVerifyError extends Error {
  constructor(public reason: RtcTokenError) {
    super(`RTC token verification failed: ${reason}`);
    this.name = "RtcTokenVerifyError";
  }
}

/**
 * Sign an RTC handshake token. `nowSeconds` is injected (not read from Date) so
 * callers stay deterministic and testable; production passes
 * Math.floor(Date.now()/1000).
 */
export async function signRtcToken(
  claims: Omit<RtcClaims, "iat" | "exp">,
  secret: string,
  opts: { nowSeconds: number; ttlSeconds?: number },
): Promise<string> {
  const ttl = opts.ttlSeconds ?? RTC_TOKEN_TTL_SECONDS;
  const full: RtcClaims = {
    ...claims,
    iat: opts.nowSeconds,
    exp: opts.nowSeconds + ttl,
  };
  const headerB64 = stringToBase64Url(JSON.stringify(HEADER));
  const payloadB64 = stringToBase64Url(JSON.stringify(full));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await hmacSign(signingInput, secret);
  return `${signingInput}.${bytesToBase64Url(sig)}`;
}

/**
 * Verify signature + expiry + token type and return the claims.
 * @throws RtcTokenVerifyError with a precise reason on any failure.
 */
export async function verifyRtcToken(
  token: string,
  secret: string,
  opts: { nowSeconds: number },
): Promise<RtcClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new RtcTokenVerifyError("malformed");
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlToString(headerB64));
  } catch {
    throw new RtcTokenVerifyError("malformed");
  }
  // Reject alg confusion + cross-use of a session JWT as a handshake token.
  if (header.alg !== "HS256") throw new RtcTokenVerifyError("wrong_alg");
  if (header.typ !== "RTC") throw new RtcTokenVerifyError("wrong_typ");

  const ok = await hmacVerify(
    `${headerB64}.${payloadB64}`,
    base64UrlToBytes(sigB64),
    secret,
  );
  if (!ok) throw new RtcTokenVerifyError("bad_signature");

  let claims: RtcClaims;
  try {
    claims = JSON.parse(base64UrlToString(payloadB64));
  } catch {
    throw new RtcTokenVerifyError("malformed");
  }

  if (
    typeof claims.exp !== "number" ||
    typeof claims.iat !== "number" ||
    typeof claims.sub !== "string" ||
    typeof claims.classId !== "string" ||
    typeof claims.canDraw !== "boolean"
  )
    throw new RtcTokenVerifyError("malformed");
  if (opts.nowSeconds >= claims.exp) throw new RtcTokenVerifyError("expired");
  if (opts.nowSeconds < claims.iat - 60)
    throw new RtcTokenVerifyError("not_yet_valid");

  return claims;
}

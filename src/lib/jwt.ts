/**
 * Minimal, edge-compatible JWT (HS256) — sign + verify.
 *
 * We hand-roll rather than pull a Node-oriented lib so it runs unmodified on
 * Workers (WebCrypto only). The token embeds exactly the claims our RBAC guards
 * read — sub (userId), role, orgId, branchId — so getAuthContext can build an
 * AuthContext with no DB round-trip on the hot path.
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

export interface JwtClaims {
  sub: string; // userId
  role: Role;
  orgId: string | null;
  branchId: string | null;
  iat: number; // issued-at (epoch seconds)
  exp: number; // expiry (epoch seconds)
}

const HEADER = { alg: "HS256", typ: "JWT" } as const;

/** Reasons verification can fail — surfaced for precise 401s/tests. */
export type JwtError =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "wrong_alg";

export class JwtVerifyError extends Error {
  constructor(public reason: JwtError) {
    super(`JWT verification failed: ${reason}`);
    this.name = "JwtVerifyError";
  }
}

/**
 * Sign a token. `nowSeconds` is injected (not read from Date) so callers stay
 * deterministic and testable; production passes Math.floor(Date.now()/1000).
 */
export async function signJwt(
  claims: Omit<JwtClaims, "iat" | "exp">,
  secret: string,
  opts: { nowSeconds: number; ttlSeconds: number },
): Promise<string> {
  const full: JwtClaims = {
    ...claims,
    iat: opts.nowSeconds,
    exp: opts.nowSeconds + opts.ttlSeconds,
  };
  const headerB64 = stringToBase64Url(JSON.stringify(HEADER));
  const payloadB64 = stringToBase64Url(JSON.stringify(full));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await hmacSign(signingInput, secret);
  return `${signingInput}.${bytesToBase64Url(sig)}`;
}

/**
 * Verify signature + expiry and return the claims.
 * @throws JwtVerifyError with a precise reason on any failure.
 */
export async function verifyJwt(
  token: string,
  secret: string,
  opts: { nowSeconds: number },
): Promise<JwtClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtVerifyError("malformed");
  const [headerB64, payloadB64, sigB64] = parts;

  // Reject alg confusion: only HS256 is accepted.
  let header: { alg?: string };
  try {
    header = JSON.parse(base64UrlToString(headerB64));
  } catch {
    throw new JwtVerifyError("malformed");
  }
  if (header.alg !== "HS256") throw new JwtVerifyError("wrong_alg");

  const ok = await hmacVerify(
    `${headerB64}.${payloadB64}`,
    base64UrlToBytes(sigB64),
    secret,
  );
  if (!ok) throw new JwtVerifyError("bad_signature");

  let claims: JwtClaims;
  try {
    claims = JSON.parse(base64UrlToString(payloadB64));
  } catch {
    throw new JwtVerifyError("malformed");
  }

  if (typeof claims.exp !== "number" || typeof claims.iat !== "number")
    throw new JwtVerifyError("malformed");
  if (opts.nowSeconds >= claims.exp) throw new JwtVerifyError("expired");
  if (opts.nowSeconds < claims.iat - 60) throw new JwtVerifyError("not_yet_valid");

  return claims;
}

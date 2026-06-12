/**
 * POST /api/auth/login
 * Accepts { email, password }, verifies the stored PBKDF2 hash, and issues a
 * signed JWT both in the JSON body (for Bearer clients) and as a secure,
 * httpOnly session cookie (for browser clients).
 *
 * No RBAC gate here — this is the unauthenticated entry point. It IS rate-limit
 * sensitive; a limiter binding should front this route in production.
 */
import { getDb } from "../../../../db/client";
import { SESSION_COOKIE } from "../../../../lib/auth";
import { parseLogin } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { login, LoginError } from "../../../../modules/auth/auth.service";

export const runtime = "nodejs";

const TTL_SECONDS = 60 * 60 * 8; // 8-hour session

export async function POST(req: Request): Promise<Response> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseLogin(raw);

    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret || secret.length < 16) {
      // Misconfiguration must not silently issue unsigned/weak tokens.
      return json({ error: "Auth not configured" }, 500);
    }

    const result = await login(getDb(), input, {
      secret,
      nowSeconds: Math.floor(Date.now() / 1000),
      ttlSeconds: TTL_SECONDS,
    });

    const cookie = [
      `${SESSION_COOKIE}=${result.token}`,
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Path=/",
      `Max-Age=${TTL_SECONDS}`,
    ].join("; ");

    return new Response(
      JSON.stringify({
        token: result.token,
        user: result.user,
        expiresInSeconds: result.expiresInSeconds,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": cookie,
        },
      },
    );
  } catch (err) {
    // Credential failures map to a generic 401 (no account enumeration).
    if (err instanceof LoginError) {
      return json({ error: err.message }, 401);
    }
    return handleError(err);
  }
}

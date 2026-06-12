/**
 * POST /api/auth/logout
 * Clears the session cookie. (Tokens are stateless JWTs, so this only removes
 * the browser's cookie; the token remains valid until its 8h expiry — by
 * design, per the frozen-scope decision in Phase 5.)
 */
import { SESSION_COOKIE } from "../../../../lib/auth";

export const runtime = "edge";

export async function POST(): Promise<Response> {
  const cookie = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=0", // expire immediately
  ].join("; ");

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": cookie,
    },
  });
}

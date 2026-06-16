/**
 * Server-side whiteboard context fetch for the AI tutor.
 *
 * Instead of trusting the browser to send the board contents, the AI routes call
 * this to read the LIVE board straight from its Durable Object: we mint a
 * short-lived RTC token (the same one the browser uses), then issue an
 * authenticated HTTP GET to the Worker with `x-rtc-op: context`. The Worker
 * verifies the token and forwards to the DO, which returns a text extraction of
 * the op log (equations, text labels, mark counts). Best-effort: any failure
 * returns null so the route can fall back to client-supplied context.
 */
import { signRtcToken, RTC_TOKEN_TTL_SECONDS } from "../../lib/rtc-token";
import type { Role } from "../../lib/auth";

export interface BoardContext {
  text: string;
  opCount: number;
}

/** Coerce the configured ws(s):// base to an http(s):// origin for a plain GET. */
function httpBaseFromWsEnv(): string | null {
  const raw = process.env.WHITEBOARD_WS_URL?.trim();
  if (!raw) return null;
  let base = raw.replace(/\/+$/, "");
  if (/^wss:\/\//i.test(base)) base = base.replace(/^wss:\/\//i, "https://");
  else if (/^ws:\/\//i.test(base)) base = base.replace(/^ws:\/\//i, "http://");
  else if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base;
}

/**
 * Read the current board text for `classId` from its Durable Object. `actor` is
 * the already-authorized caller (the AI route runs assertClassAccess first), so
 * the minted token simply mirrors their identity. Returns null on any failure.
 */
export async function fetchBoardContext(
  classId: string,
  actor: { userId: string; role: Role; canDraw: boolean },
): Promise<BoardContext | null> {
  const secret = process.env.RTC_JWT_SECRET;
  const base = httpBaseFromWsEnv();
  if (!secret || secret.length < 16 || !base) return null;

  try {
    const token = await signRtcToken(
      { sub: actor.userId, classId, role: actor.role, canDraw: actor.canDraw },
      secret,
      { nowSeconds: Math.floor(Date.now() / 1000) },
    );
    const url = `${base}/room/${encodeURIComponent(classId)}?t=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-rtc-op": "context" },
      // The token's TTL is ~60s; this call resolves in well under that.
      signal: AbortSignal.timeout(RTC_TOKEN_TTL_SECONDS * 1000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: unknown; opCount?: unknown };
    if (typeof data.text !== "string") return null;
    return {
      text: data.text,
      opCount: typeof data.opCount === "number" ? data.opCount : 0,
    };
  } catch {
    return null;
  }
}

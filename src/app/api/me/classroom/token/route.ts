/**
 * POST /api/me/classroom/token
 *
 * Mints a short-lived handshake token the browser uses to open the live
 * whiteboard WebSocket on the Cloudflare Worker. This is the auth boundary
 * between Vercel (where the session lives) and the edge RTC layer (which has no
 * session of its own):
 *
 *   1. getAuthContext  — verify the caller's session JWT.
 *   2. assertClassAccess — confirm this user is actually a member of the class
 *      (teacher assigned / student enrolled / branch_manager in-branch / super).
 *      This reuses the exact same class RBAC guard the LMS routes use.
 *   3. signRtcToken — issue a ~60s token bound to {userId, classId, role,
 *      canDraw}. The Worker verifies it before upgrading the socket, so the
 *      Durable Object only ever sees pre-authorized connections.
 *
 * Draw capability is decided HERE, server-side, from the class role — students
 * connect view-only by default; educators may draw. The Worker/DO never trust a
 * client-supplied permission (Guideline #4).
 *
 * Node runtime (not edge): assertClassAccess hits Neon via the Drizzle pool,
 * which we run on Node for connection stability (see db/client.ts).
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, AuthError, type Role } from "../../../../../lib/auth";
import { assertClassAccess } from "../../../../../modules/lms/membership.service";
import {
  signRtcToken,
  RTC_TOKEN_TTL_SECONDS,
} from "../../../../../lib/rtc-token";
import { parseClassroomToken } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";

export const runtime = "nodejs";

/** Roles permitted to mutate the board; everyone else connects view-only. */
const DRAW_ROLES: ReadonlySet<Role> = new Set<Role>([
  "super_admin",
  "branch_manager",
  "teacher",
  "student", // students may draw on the shared tutoring board
]);

/** Resolve the RTC handshake signing secret (separate from the session secret). */
function getRtcSecret(): string {
  const secret = process.env.RTC_JWT_SECRET;
  if (!secret || secret.length < 16) {
    // Fail closed: never mint a token we can't securely sign.
    throw new AuthError(401, "RTC is not configured");
  }
  return secret;
}

/** Base URL of the deployed whiteboard Worker, e.g. wss://rtc.sengine.app. */
function getWhiteboardWsBase(): string {
  const base = process.env.WHITEBOARD_WS_URL;
  if (!base) throw new AuthError(401, "RTC endpoint is not configured");
  return base.replace(/\/$/, "");
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }
    const { classId } = parseClassroomToken(raw);

    // Throws 403 if the caller isn't a member of this class, 404 if missing.
    const access = await assertClassAccess(getDb(), ctx, classId);

    const canDraw = DRAW_ROLES.has(ctx.role);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await signRtcToken(
      { sub: ctx.userId, classId, role: ctx.role, canDraw },
      getRtcSecret(),
      { nowSeconds },
    );

    return json({
      token,
      // The client dials this with ?t=<token>; one DO instance per classId.
      wsUrl: `${getWhiteboardWsBase()}/room/${classId}`,
      classId,
      branchId: access.branchId,
      role: ctx.role,
      canDraw,
      expiresAt: (nowSeconds + RTC_TOKEN_TTL_SECONDS) * 1000,
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/me/sessions
 * A student's upcoming sessions for the classes they're actively enrolled in.
 * Self-service: resolved from ctx.userId (never a client id), so a student only
 * ever sees their own classes' sessions. Powers the dashboard "Join Class"
 * widget; the time-gating (now ∈ [start, end]) is applied client-side.
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";
import { listUpcomingSessionsForStudentUser } from "../../../../modules/sis/schedule.service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["student"]);
    const sessions = await listUpcomingSessionsForStudentUser(
      getDb(),
      ctx.userId,
      Date.now(),
    );
    return json({ count: sessions.length, sessions });
  } catch (err) {
    return handleError(err);
  }
}

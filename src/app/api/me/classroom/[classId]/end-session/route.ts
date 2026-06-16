/**
 * POST /api/me/classroom/[classId]/end-session
 *
 * The whiteboard's "End Session" action. The board knows only its classId, so
 * this resolves the class's active session, verifies the caller is a member +
 * an educator, then runs the SAME atomic end-session transaction (snapshot +
 * attendance + payroll) — rolling back as a unit on any failure.
 *
 * RBAC: super_admin, branch_manager, teacher (educators); students/parents are
 * refused. Class membership is checked against the DB.
 */
import { getDb } from "../../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../../lib/auth";
import { assertClassAccess } from "../../../../../../modules/lms/membership.service";
import { isUuid, parseEndSession } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import {
  resolveActiveSessionId,
  endSession,
} from "../../../../../../modules/lms/session_lifecycle.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ classId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    // Educators only — students/parents cannot close out a session's books.
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    const { classId } = await params;
    if (!isUuid(classId)) return json({ error: "classId must be a UUID" }, 400);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }
    const input = parseEndSession(raw);

    const db = getDb();
    // Membership scope (teacher must be assigned to this class).
    await assertClassAccess(db, ctx, classId);

    const sessionId = await resolveActiveSessionId(db, classId, Date.now());
    if (!sessionId) {
      return json(
        { error: "No scheduled session for this class to end. Schedule one first." },
        404,
      );
    }

    const result = await endSession(db, sessionId, input, ctx);
    return json({ sessionId, ...result }, 201);
  } catch (err) {
    return handleError(err);
  }
}

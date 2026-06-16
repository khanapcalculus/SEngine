/**
 * POST /api/schedule/[sessionId]/end
 * Atomically end a live session: save whiteboard snapshot + log tutor attendance
 * + append payroll ledger, in ONE transaction (rolls back as a unit on any
 * failure). RBAC: super_admin, branch_manager, or teacher, scoped in the service
 * to the session's branch.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseEndSession } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { endSession } from "../../../../../modules/lms/session_lifecycle.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    const { sessionId } = await params;
    if (!isUuid(sessionId))
      return json({ error: "sessionId must be a UUID" }, 400);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseEndSession(raw);
    const result = await endSession(getDb(), sessionId, input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

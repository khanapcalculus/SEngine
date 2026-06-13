/**
 * POST /api/assignments/[assignmentId]/status
 * Publish/close an assignment. RBAC: staff member of the class (service).
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseAssignmentStatus } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { setAssignmentStatus } from "../../../../../modules/lms/assignment.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    const { assignmentId } = await params;
    if (!isUuid(assignmentId)) {
      return json({ error: "assignmentId must be a UUID" }, 400);
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseAssignmentStatus(raw);
    const result = await setAssignmentStatus(getDb(), assignmentId, input, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

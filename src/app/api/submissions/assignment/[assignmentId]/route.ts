/**
 * GET /api/submissions/assignment/[assignmentId]
 * Staff lists all submissions for an assignment. RBAC: staff member of the
 * class (service).
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listSubmissionsForAssignment } from "../../../../../modules/lms/submission.service";

export const runtime = "nodejs";

export async function GET(
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

    const submissions = await listSubmissionsForAssignment(
      getDb(),
      ctx,
      assignmentId,
    );
    return json({ assignmentId, count: submissions.length, submissions });
  } catch (err) {
    return handleError(err);
  }
}

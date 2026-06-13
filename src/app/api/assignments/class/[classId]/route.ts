/**
 * GET /api/assignments/class/[classId]
 * List a class's assignments. Any class member; students see only published
 * (enforced in the service). Guideline #4.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext } from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listAssignmentsForClass } from "../../../../../modules/lms/assignment.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ classId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    const { classId } = await params;
    if (!isUuid(classId)) {
      return json({ error: "classId must be a UUID" }, 400);
    }
    const assignments = await listAssignmentsForClass(getDb(), ctx, classId);
    return json({ classId, count: assignments.length, assignments });
  } catch (err) {
    return handleError(err);
  }
}

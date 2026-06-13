/**
 * GET /api/me/gradebook
 * Enrollments for the classes the caller (a teacher) is assigned to.
 * RBAC: any staff role; scoped to ctx.userId's assignments (Guideline #4).
 * Grading still goes through POST /api/enrollments/grade, which independently
 * verifies the teacher is assigned to that class.
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";
import { listGradebookForStaffUser } from "../../../../modules/sis/grade.service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);
    const enrollments = await listGradebookForStaffUser(getDb(), ctx.userId);
    return json({ count: enrollments.length, enrollments });
  } catch (err) {
    return handleError(err);
  }
}

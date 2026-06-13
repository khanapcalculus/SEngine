/**
 * GET /api/me/submissions
 * The student's own submissions (self-service, keyed off ctx.userId).
 * RBAC: student (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";
import { listSubmissionsForStudentUser } from "../../../../modules/lms/submission.service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["student"]);
    const submissions = await listSubmissionsForStudentUser(
      getDb(),
      ctx.userId,
    );
    return json({ count: submissions.length, submissions });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/me/enrollments
 * The caller's OWN enrollments (self-service for a student's "My Enrollments").
 * RBAC: student; keyed off ctx.userId, accepts no id (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";
import { listEnrollmentsForStudentUser } from "../../../../modules/sis/grade.service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["student"]);
    const enrollments = await listEnrollmentsForStudentUser(getDb(), ctx.userId);
    return json({ count: enrollments.length, enrollments });
  } catch (err) {
    return handleError(err);
  }
}

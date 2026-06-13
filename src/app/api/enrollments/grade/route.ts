/**
 * POST /api/enrollments/grade
 * Records a final grade on an enrollment (completing it).
 * RBAC: super_admin, branch_manager, or teacher; a teacher may only grade
 * classes they are assigned to (enforced in the service). Guideline #4.
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseGradeEnrollment } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { gradeEnrollment } from "../../../../modules/sis/grade.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseGradeEnrollment(raw);
    const result = await gradeEnrollment(getDb(), input, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

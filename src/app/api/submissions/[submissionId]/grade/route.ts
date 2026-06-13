/**
 * POST /api/submissions/[submissionId]/grade
 * Staff grades a submission (points capped at the assignment max). RBAC: staff
 * member of the class (service).
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseGradeSubmission } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { gradeSubmission } from "../../../../../modules/lms/submission.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    const { submissionId } = await params;
    if (!isUuid(submissionId)) {
      return json({ error: "submissionId must be a UUID" }, 400);
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseGradeSubmission(raw);
    const result = await gradeSubmission(getDb(), submissionId, input, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/students/[studentProfileId]/transcript
 * Returns a student's full academic transcript (coursework by term, GPAs,
 * promotion history).
 * RBAC: super_admin or branch_manager only; branch-scoped in the service
 * against the student's branch (Guideline #4).
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { getTranscript } from "../../../../../modules/sis/transcript.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ studentProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { studentProfileId } = await params;
    if (!isUuid(studentProfileId)) {
      return json({ error: "studentProfileId must be a UUID" }, 400);
    }

    const transcript = await getTranscript(getDb(), studentProfileId, ctx);
    return json(transcript);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/submissions
 * A student submits to a published assignment. RBAC: student + class
 * enrollment (service). Guideline #4.
 */
import { getDb } from "../../../db/client";
import { getAuthContext, requireRole } from "../../../lib/auth";
import { parseCreateSubmission } from "../../../lib/validation";
import { json, handleError } from "../../../lib/http";
import { submitAssignment } from "../../../modules/lms/submission.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["student"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseCreateSubmission(raw);
    const result = await submitAssignment(getDb(), input.assignmentId, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

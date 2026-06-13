/**
 * POST /api/submissions/[submissionId]/files
 * Register an uploaded file's metadata against a submission (the explicit /
 * dev-friendly path that works without the Blob callback). RBAC: the student
 * who owns the submission (service). Guideline #4.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseRegisterFile } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import {
  assertSubmissionOwner,
  recordSubmissionFile,
} from "../../../../../modules/lms/submission.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["student"]);

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

    const input = parseRegisterFile(raw);
    const db = getDb();
    await assertSubmissionOwner(db, ctx, submissionId);
    const result = await recordSubmissionFile(db, submissionId, input);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

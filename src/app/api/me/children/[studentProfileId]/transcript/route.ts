/**
 * GET /api/me/children/[studentProfileId]/transcript
 * A parent reads one of their children's transcripts. Gated by a guardianship
 * row linking ctx.userId → studentProfileId, so a parent can't read an
 * arbitrary student by guessing an id (Guideline #4).
 */
import { getDb } from "../../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../../lib/auth";
import { isUuid } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { assertGuardianOfStudent } from "../../../../../../modules/sis/guardian.service";
import { assembleTranscript } from "../../../../../../modules/sis/transcript.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ studentProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["parent"]);

    const { studentProfileId } = await params;
    if (!isUuid(studentProfileId))
      return json({ error: "studentProfileId must be a UUID" }, 400);

    const db = getDb();
    await assertGuardianOfStudent(db, ctx.userId, studentProfileId); // throws 403
    const transcript = await assembleTranscript(db, studentProfileId);
    return json(transcript);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/me/transcript
 * The caller's OWN transcript (self-service for a student). Resolves the
 * student profile from ctx.userId — accepts no id — so a student can never read
 * another student's record (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";
import {
  getStudentProfileIdByUser,
  assembleTranscript,
} from "../../../../modules/sis/transcript.service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["student"]);

    const db = getDb();
    const studentProfileId = await getStudentProfileIdByUser(db, ctx.userId);
    if (!studentProfileId) {
      return json({ error: "No student profile for this account" }, 404);
    }
    const transcript = await assembleTranscript(db, studentProfileId);
    return json(transcript);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/me/classes
 * The caller's own assigned classes (self-service for a teacher's "My Classes").
 * RBAC: any staff role; data is keyed off ctx.userId, never a client id, so a
 * teacher can only ever see their own roster (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";
import { listClassesForStaffUser } from "../../../../modules/hr/assignment.service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);
    const classes = await listClassesForStaffUser(getDb(), ctx.userId);
    return json({ count: classes.length, classes });
  } catch (err) {
    return handleError(err);
  }
}

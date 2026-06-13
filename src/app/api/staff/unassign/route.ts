/**
 * POST /api/staff/unassign
 * Removes a staff member from a class roster.
 * RBAC: super_admin or branch_manager only; branch scope enforced in the
 * service against the assignment's class (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseUnassignStaff } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { unassignStaff } from "../../../../modules/hr/assignment.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseUnassignStaff(raw);
    const result = await unassignStaff(getDb(), input.assignmentId, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

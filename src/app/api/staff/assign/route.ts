/**
 * POST /api/staff/assign
 * Links a staff member to a class roster (creates a Staff_Assignment).
 * RBAC: super_admin or branch_manager only; branch_manager is further confined
 * to their own branch inside the service (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseAssignStaff } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { assignStaffToClass } from "../../../../modules/hr/assignment.service";

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

    const input = parseAssignStaff(raw);
    const result = await assignStaffToClass(getDb(), input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

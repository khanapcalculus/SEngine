/**
 * POST /api/staff/status
 * Moves a staff member through their employment lifecycle (activate, leave,
 * retire, terminate).
 * RBAC: super_admin or branch_manager only; branch_manager is further confined
 * to their own branch inside the service (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseChangeStaffStatus } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { changeStaffStatus } from "../../../../modules/hr/staff.service";

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

    const input = parseChangeStaffStatus(raw);
    const result = await changeStaffStatus(getDb(), input, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

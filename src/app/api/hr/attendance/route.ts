/**
 * POST /api/hr/attendance — record (or update) a staff member's attendance for
 * a day. RBAC: super_admin or branch_manager, scoped to the staff member's
 * branch (enforced in the service).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseRecordAttendance } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { recordAttendance } from "../../../../modules/hr/operations.service";

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

    const input = parseRecordAttendance(raw);
    const result = await recordAttendance(getDb(), input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

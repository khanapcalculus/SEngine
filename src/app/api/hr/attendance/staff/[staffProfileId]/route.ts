/**
 * GET /api/hr/attendance/staff/[staffProfileId] — a staff member's recent
 * attendance. RBAC: super_admin or branch_manager, scoped in the service.
 */
import { getDb } from "../../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../../lib/auth";
import { isUuid } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { listAttendanceForStaff } from "../../../../../../modules/hr/operations.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ staffProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { staffProfileId } = await params;
    if (!isUuid(staffProfileId))
      return json({ error: "staffProfileId must be a UUID" }, 400);

    const records = await listAttendanceForStaff(getDb(), staffProfileId, ctx);
    return json({ count: records.length, records });
  } catch (err) {
    return handleError(err);
  }
}

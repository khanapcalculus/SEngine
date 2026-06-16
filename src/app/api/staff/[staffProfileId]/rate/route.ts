/**
 * POST /api/staff/[staffProfileId]/rate — set a staff member's hourly base rate
 * (used by the automated payroll engine). RBAC: super_admin or branch_manager,
 * scoped in the service to the staff member's branch.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseSetStaffRate } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { setStaffBaseRate } from "../../../../../modules/hr/staff.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ staffProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { staffProfileId } = await params;
    if (!isUuid(staffProfileId))
      return json({ error: "staffProfileId must be a UUID" }, 400);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const { baseRate } = parseSetStaffRate(raw);
    const result = await setStaffBaseRate(getDb(), staffProfileId, baseRate, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

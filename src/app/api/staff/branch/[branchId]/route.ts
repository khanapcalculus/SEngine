/**
 * GET /api/staff/branch/[branchId]
 * Returns the active staff roster for a branch.
 * RBAC: super_admin or branch_manager only (Guideline #4).
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { getActiveStaffForBranch } from "../../../../../modules/hr/staff.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  // Next.js 16: dynamic route params are async and must be awaited.
  { params }: { params: Promise<{ branchId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { branchId } = await params;
    if (!isUuid(branchId)) {
      return json({ error: "branchId must be a UUID" }, 400);
    }

    const staff = await getActiveStaffForBranch(getDb(), branchId);
    return json({ branchId, count: staff.length, staff });
  } catch (err) {
    return handleError(err);
  }
}

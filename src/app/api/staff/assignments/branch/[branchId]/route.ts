/**
 * GET /api/staff/assignments/branch/[branchId]
 * Returns every staff↔class assignment for a branch (drives the dashboard's
 * per-class staffing view).
 * RBAC: super_admin, branch_manager, or teacher (educators may see who staffs
 * the classes in their branch). Branch scope enforced per Guideline #4.
 */
import { getDb } from "../../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../../../lib/auth";
import { isUuid } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { listAssignmentsForBranch } from "../../../../../../modules/hr/assignment.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ branchId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    const { branchId } = await params;
    if (!isUuid(branchId)) {
      return json({ error: "branchId must be a UUID" }, 400);
    }
    assertBranchAccess(ctx, branchId);

    const assignments = await listAssignmentsForBranch(getDb(), branchId);
    return json({ branchId, count: assignments.length, assignments });
  } catch (err) {
    return handleError(err);
  }
}

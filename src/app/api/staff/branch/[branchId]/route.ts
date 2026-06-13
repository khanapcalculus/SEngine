/**
 * GET /api/staff/branch/[branchId]
 * Returns the full staff roster for a branch (all lifecycle statuses) so the
 * dashboard can manage transitions, not just view active educators.
 * RBAC: super_admin or branch_manager only (Guideline #4).
 */
import { getDb } from "../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listStaffForBranch } from "../../../../../modules/hr/staff.service";

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
    assertBranchAccess(ctx, branchId);

    const staff = await listStaffForBranch(getDb(), branchId);
    return json({ branchId, count: staff.length, staff });
  } catch (err) {
    return handleError(err);
  }
}

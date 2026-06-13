/**
 * GET /api/enrollments/branch/[branchId]
 * Returns every enrollment for a branch (joined to class + student) — powers
 * the dashboard gradebook.
 * RBAC: super_admin, branch_manager, or teacher; branch-scoped (Guideline #4).
 */
import { getDb } from "../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listEnrollmentsForBranch } from "../../../../../modules/sis/grade.service";

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

    const enrollments = await listEnrollmentsForBranch(getDb(), branchId);
    return json({ branchId, count: enrollments.length, enrollments });
  } catch (err) {
    return handleError(err);
  }
}

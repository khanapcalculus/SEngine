/**
 * GET /api/students/branch/[branchId]
 * Returns the active student roster for a branch.
 * RBAC: super_admin, branch_manager, or teacher.
 */
import { getDb } from "../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { getActiveStudentsForBranch } from "../../../../../modules/sis/student.service";

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

    const students = await getActiveStudentsForBranch(getDb(), branchId);
    return json({ branchId, count: students.length, students });
  } catch (err) {
    return handleError(err);
  }
}

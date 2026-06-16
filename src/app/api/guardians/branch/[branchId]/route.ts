/**
 * GET /api/guardians/branch/[branchId]
 * List guardian links for students in a branch. RBAC: super_admin or
 * branch_manager, scoped to the caller's own branch.
 */
import { getDb } from "../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listGuardiansForBranch } from "../../../../../modules/sis/guardian.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ branchId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { branchId } = await params;
    if (!isUuid(branchId)) return json({ error: "branchId must be a UUID" }, 400);
    assertBranchAccess(ctx, branchId);

    const guardians = await listGuardiansForBranch(getDb(), branchId);
    return json({ count: guardians.length, guardians });
  } catch (err) {
    return handleError(err);
  }
}

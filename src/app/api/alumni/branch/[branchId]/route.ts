/**
 * GET /api/alumni/branch/[branchId] — graduated students + their credentials.
 * RBAC: super_admin or branch_manager, scoped to the caller's own branch.
 */
import { getDb } from "../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listAlumniForBranch } from "../../../../../modules/sis/graduation.service";

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

    const alumni = await listAlumniForBranch(getDb(), branchId);
    return json({ count: alumni.length, alumni });
  } catch (err) {
    return handleError(err);
  }
}

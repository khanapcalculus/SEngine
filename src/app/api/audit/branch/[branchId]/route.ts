/**
 * GET /api/audit/branch/[branchId]
 * Returns the most recent audit-log entries for a branch (newest first).
 * RBAC: super_admin or branch_manager only — the audit trail is sensitive.
 */
import { getDb } from "../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listAuditForBranch } from "../../../../../modules/audit/audit.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
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

    const entries = await listAuditForBranch(getDb(), branchId);
    return json({ branchId, count: entries.length, entries });
  } catch (err) {
    return handleError(err);
  }
}

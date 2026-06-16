/**
 * GET /api/schedule/branch/[branchId]
 * List a branch's scheduled sessions in chronological order. RBAC: any staff
 * role, scoped to the caller's own branch (super_admin unrestricted). Returns
 * sessions starting from 30 days ago so the calendar can render recent history
 * without unbounded growth.
 */
import { getDb } from "../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listSessionsForBranch } from "../../../../../modules/sis/schedule.service";

export const runtime = "nodejs";

const LOOKBACK_DAYS = 30;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ branchId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    const { branchId } = await params;
    if (!isUuid(branchId)) return json({ error: "branchId must be a UUID" }, 400);
    assertBranchAccess(ctx, branchId);

    const from = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const sessions = await listSessionsForBranch(getDb(), branchId, from);
    return json({ count: sessions.length, sessions });
  } catch (err) {
    return handleError(err);
  }
}

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
import type { Role } from "../../../../../lib/auth";

export const runtime = "nodejs";

/** Roles permitted to read a branch's full staff roster. */
const ALLOWED_ROLES: readonly Role[] = ["super_admin", "branch_manager"];

export async function GET(
  req: Request,
  // Next.js 16: dynamic route params are async and must be awaited.
  { params }: { params: Promise<{ branchId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);

    const { branchId } = await params;
    if (!isUuid(branchId)) {
      return json({ error: "branchId must be a UUID" }, 400);
    }

    // 403 path #1 — role gate. A teacher/student/parent session reaching this
    // route at all is a client-side guard gap (see DashboardProvider).
    if (!ALLOWED_ROLES.includes(ctx.role)) {
      console.error(
        `[staff/branch] 403 Insufficient role: userId=${ctx.userId} role=${ctx.role} ` +
          `requestedBranch=${branchId} (allowed: ${ALLOWED_ROLES.join(", ")})`,
      );
    }
    requireRole(ctx, [...ALLOWED_ROLES]);

    // 403 path #2 — branch scope. A branch_manager may only read their own
    // branch; super_admin is unrestricted (assertBranchAccess returns early).
    if (ctx.role !== "super_admin" && ctx.branchId !== branchId) {
      console.error(
        `[staff/branch] 403 Branch outside caller's scope: userId=${ctx.userId} role=${ctx.role} ` +
          `expectedBranch=${ctx.branchId ?? "<none>"} receivedBranch=${branchId}`,
      );
    }
    assertBranchAccess(ctx, branchId);

    const staff = await listStaffForBranch(getDb(), branchId);
    return json({ branchId, count: staff.length, staff });
  } catch (err) {
    return handleError(err);
  }
}

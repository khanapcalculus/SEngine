/**
 * POST /api/staff/onboard
 * Creates a User + Staff_Profile in a single transaction.
 * RBAC: super_admin or branch_manager only (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
  assertBranchScope,
} from "../../../../lib/auth";
import { parseOnboardStaff } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { onboardStaff } from "../../../../modules/hr/staff.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseOnboardStaff(raw);
    // Branch managers may only onboard into their own tenant.
    assertBranchScope(ctx, input.orgId);
    assertBranchAccess(ctx, input.branchId);

    const result = await onboardStaff(getDb(), input, {
      userId: ctx.userId,
      orgId: ctx.orgId,
    });
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

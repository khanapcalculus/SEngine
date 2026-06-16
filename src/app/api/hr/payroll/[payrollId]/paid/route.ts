/**
 * POST /api/hr/payroll/[payrollId]/paid — mark a payroll record paid (stamps
 * paidAt). RBAC: super_admin or branch_manager, scoped in the service.
 */
import { getDb } from "../../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../../lib/auth";
import { isUuid } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { markPayrollPaid } from "../../../../../../modules/hr/operations.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ payrollId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { payrollId } = await params;
    if (!isUuid(payrollId))
      return json({ error: "payrollId must be a UUID" }, 400);

    const result = await markPayrollPaid(getDb(), payrollId, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

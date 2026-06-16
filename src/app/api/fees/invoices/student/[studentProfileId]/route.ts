/**
 * GET /api/fees/invoices/student/[studentProfileId] — a student's invoices.
 * RBAC: super_admin or branch_manager, scoped in the service.
 */
import { getDb } from "../../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../../lib/auth";
import { isUuid } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { listInvoicesForStudent } from "../../../../../../modules/sis/fees.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ studentProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { studentProfileId } = await params;
    if (!isUuid(studentProfileId))
      return json({ error: "studentProfileId must be a UUID" }, 400);

    const invoices = await listInvoicesForStudent(getDb(), studentProfileId, ctx);
    return json({ count: invoices.length, invoices });
  } catch (err) {
    return handleError(err);
  }
}

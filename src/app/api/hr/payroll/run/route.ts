/**
 * POST /api/hr/payroll/run
 * Automated bulk payroll run for all active staff in a branch over a period.
 * Hours are derived from each tutor's scheduled sessions × their base_rate,
 * minus a standard deduction. Runs in ONE transaction — any failure rolls the
 * whole run back (no partial payroll). RBAC: super_admin or branch_manager,
 * scoped to the branch.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { parsePayrollRun } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { runPayroll } from "../../../../../modules/hr/payroll.service";

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

    const input = parsePayrollRun(raw);
    const result = await runPayroll(
      getDb(),
      input.branchId,
      input.periodStart,
      input.periodEnd,
      ctx,
      input.currency,
    );
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

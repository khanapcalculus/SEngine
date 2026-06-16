/**
 * POST /api/fees/invoices/[invoiceId]/payments — apply a payment to an invoice
 * (recomputes amountPaid + status server-side). RBAC: super_admin or
 * branch_manager, scoped in the service to the invoice's branch.
 */
import { getDb } from "../../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../../lib/auth";
import { isUuid, parseRecordPayment } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { recordPayment } from "../../../../../../modules/sis/fees.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { invoiceId } = await params;
    if (!isUuid(invoiceId))
      return json({ error: "invoiceId must be a UUID" }, 400);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseRecordPayment(raw);
    const result = await recordPayment(getDb(), invoiceId, input, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/fees/invoices — raise a fee invoice against a student. RBAC:
 * super_admin or branch_manager, scoped in the service to the student's branch.
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseCreateInvoice } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { createInvoice } from "../../../../modules/sis/fees.service";

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

    const input = parseCreateInvoice(raw);
    const result = await createInvoice(getDb(), input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

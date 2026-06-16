/**
 * POST /api/hr/performance — create a performance review for a staff member.
 * RBAC: super_admin or branch_manager, scoped in the service.
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseCreateReview } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { createReview } from "../../../../modules/hr/operations.service";

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

    const input = parseCreateReview(raw);
    const result = await createReview(getDb(), input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

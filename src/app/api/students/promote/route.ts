/**
 * POST /api/students/promote
 * Applies a term-over-term progression decision (promote / retain / graduate).
 * RBAC: super_admin or branch_manager only; branch-scoped in the service
 * against the student's branch (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parsePromoteStudent } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { promoteStudent } from "../../../../modules/sis/promotion.service";

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

    const input = parsePromoteStudent(raw);
    const result = await promoteStudent(getDb(), input, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

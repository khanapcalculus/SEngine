/**
 * POST /api/classes/create
 * Creates a course section (+ audit). RBAC: super_admin or branch_manager.
 */
import { getDb } from "../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../lib/auth";
import { parseCreateClass } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { createClass } from "../../../../modules/sis/class.service";

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

    const input = parseCreateClass(raw);
    assertBranchAccess(ctx, input.branchId);

    const result = await createClass(getDb(), input, {
      userId: ctx.userId,
      orgId: ctx.orgId,
    });
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

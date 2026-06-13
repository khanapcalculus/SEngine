/**
 * POST /api/admin/branches
 * Provisions a new branch inside an existing organization.
 * RBAC: super_admin only (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseCreateBranch } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { createBranch } from "../../../../modules/admin/tenant.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseCreateBranch(raw);
    const result = await createBranch(getDb(), input, {
      userId: ctx.userId,
    });
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

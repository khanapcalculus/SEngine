/**
 * POST /api/admin/organizations
 * Provisions a new organization (top of the tenant hierarchy).
 * RBAC: super_admin only (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseCreateOrganization } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { createOrganization } from "../../../../modules/admin/tenant.service";

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

    const input = parseCreateOrganization(raw);
    const result = await createOrganization(getDb(), input, {
      userId: ctx.userId,
    });
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

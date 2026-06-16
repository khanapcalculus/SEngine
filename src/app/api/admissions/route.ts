/**
 * POST /api/admissions — create an admission application. RBAC: super_admin or
 * branch_manager, scoped to the target branch.
 */
import { getDb } from "../../../db/client";
import { getAuthContext, requireRole } from "../../../lib/auth";
import { parseCreateApplication } from "../../../lib/validation";
import { json, handleError } from "../../../lib/http";
import { createApplication } from "../../../modules/sis/admissions.service";

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

    const input = parseCreateApplication(raw);
    const result = await createApplication(getDb(), input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

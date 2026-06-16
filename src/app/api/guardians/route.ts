/**
 * POST /api/guardians
 * Link an existing parent account to a student. RBAC: super_admin or
 * branch_manager, scoped to the student's branch. The parent must already exist
 * with the `parent` role (account creation is a separate flow).
 */
import { getDb } from "../../../db/client";
import { getAuthContext, requireRole } from "../../../lib/auth";
import { parseLinkGuardian } from "../../../lib/validation";
import { json, handleError } from "../../../lib/http";
import { linkGuardian } from "../../../modules/sis/guardian.service";

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

    const input = parseLinkGuardian(raw);
    const result = await linkGuardian(getDb(), input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

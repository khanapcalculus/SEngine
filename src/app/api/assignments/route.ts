/**
 * POST /api/assignments
 * Create an assignment for a class. RBAC: staff role + class membership
 * (enforced in the service via assertClassAccess). Guideline #4.
 */
import { getDb } from "../../../db/client";
import { getAuthContext, requireRole } from "../../../lib/auth";
import { parseCreateAssignment } from "../../../lib/validation";
import { json, handleError } from "../../../lib/http";
import { createAssignment } from "../../../modules/lms/assignment.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseCreateAssignment(raw);
    const result = await createAssignment(getDb(), input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

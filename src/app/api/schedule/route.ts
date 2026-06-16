/**
 * POST /api/schedule
 * Schedule a session for a class (+ audit). RBAC: super_admin, branch_manager,
 * or teacher — and the caller must be a member of the target class (assignment
 * for teachers, in-branch for managers). branchId is resolved server-side from
 * the class, never trusted from the client.
 */
import { getDb } from "../../../db/client";
import { getAuthContext, requireRole } from "../../../lib/auth";
import { assertClassAccess } from "../../../modules/lms/membership.service";
import { parseCreateClassSession } from "../../../lib/validation";
import { json, handleError } from "../../../lib/http";
import { createSession } from "../../../modules/sis/schedule.service";

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

    const input = parseCreateClassSession(raw);
    // Confirms the caller may act on this class (membership + branch scope).
    await assertClassAccess(getDb(), ctx, input.classId);

    const result = await createSession(getDb(), input, {
      userId: ctx.userId,
      orgId: ctx.orgId,
    });
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

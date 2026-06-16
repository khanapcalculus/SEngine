/**
 * DELETE /api/schedule/[sessionId]
 * Remove a scheduled session (+ audit). RBAC: super_admin, branch_manager, or
 * teacher, scoped to the session's branch. The branch is resolved from the
 * stored row, then checked against the caller's scope.
 */
import { getDb } from "../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchAccess,
} from "../../../../lib/auth";
import { isUuid } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import {
  getSessionBranch,
  deleteSession,
} from "../../../../modules/sis/schedule.service";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    const { sessionId } = await params;
    if (!isUuid(sessionId))
      return json({ error: "sessionId must be a UUID" }, 400);

    const session = await getSessionBranch(getDb(), sessionId);
    if (!session) return json({ error: "Session not found" }, 404);
    assertBranchAccess(ctx, session.branchId);

    await deleteSession(getDb(), sessionId, session.branchId, {
      userId: ctx.userId,
      orgId: ctx.orgId,
    });
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

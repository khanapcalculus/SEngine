/**
 * DELETE /api/guardians/[guardianshipId]
 * Remove a guardian link (+ audit). RBAC: super_admin or branch_manager, scoped
 * to the linked student's branch (resolved from the stored row).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { isUuid } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { unlinkGuardian } from "../../../../modules/sis/guardian.service";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guardianshipId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { guardianshipId } = await params;
    if (!isUuid(guardianshipId))
      return json({ error: "guardianshipId must be a UUID" }, 400);

    await unlinkGuardian(getDb(), guardianshipId, ctx);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/me/classroom/[classId]/snapshots
 * Saved whiteboard snapshots for a class (captured by "End Session"), newest
 * first. RBAC: any class MEMBER (assertClassAccess) — teachers, managers, and
 * enrolled students of the class can review past boards.
 */
import { getDb } from "../../../../../../db/client";
import { getAuthContext } from "../../../../../../lib/auth";
import { assertClassAccess } from "../../../../../../modules/lms/membership.service";
import { isUuid } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { listSnapshotsForClass } from "../../../../../../modules/lms/session_lifecycle.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ classId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    const { classId } = await params;
    if (!isUuid(classId)) return json({ error: "classId must be a UUID" }, 400);

    const db = getDb();
    await assertClassAccess(db, ctx, classId); // 403 if not a member, 404 if no class
    const snapshots = await listSnapshotsForClass(db, classId);
    return json({ count: snapshots.length, snapshots });
  } catch (err) {
    return handleError(err);
  }
}

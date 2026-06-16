/**
 * GET /api/students/[studentProfileId]/credentials — a student's issued
 * credentials. RBAC: super_admin or branch_manager, scoped in the service to
 * the student's branch.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listCredentialsForStudent } from "../../../../../modules/sis/graduation.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ studentProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { studentProfileId } = await params;
    if (!isUuid(studentProfileId))
      return json({ error: "studentProfileId must be a UUID" }, 400);

    const credentials = await listCredentialsForStudent(getDb(), studentProfileId, ctx);
    return json({ count: credentials.length, credentials });
  } catch (err) {
    return handleError(err);
  }
}

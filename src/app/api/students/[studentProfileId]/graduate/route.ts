/**
 * POST /api/students/[studentProfileId]/graduate — graduate a student and issue
 * a credential. RBAC: super_admin or branch_manager, scoped in the service to
 * the student's branch.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseGraduateStudent } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { graduateStudent } from "../../../../../modules/sis/graduation.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ studentProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { studentProfileId } = await params;
    if (!isUuid(studentProfileId))
      return json({ error: "studentProfileId must be a UUID" }, 400);

    const raw = await req.json().catch(() => ({}));
    const input = parseGraduateStudent(raw);
    const result = await graduateStudent(getDb(), studentProfileId, input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

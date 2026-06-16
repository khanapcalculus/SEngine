/**
 * POST /api/admissions/[applicationId]/decision — move an application to
 * under_review / accepted / rejected. RBAC: super_admin or branch_manager,
 * scoped in the service to the application's branch.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseApplicationDecision } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { decideApplication } from "../../../../../modules/sis/admissions.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ applicationId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    const { applicationId } = await params;
    if (!isUuid(applicationId))
      return json({ error: "applicationId must be a UUID" }, 400);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseApplicationDecision(raw);
    const result = await decideApplication(getDb(), applicationId, input, ctx);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

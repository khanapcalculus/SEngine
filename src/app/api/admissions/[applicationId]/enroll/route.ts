/**
 * POST /api/admissions/[applicationId]/enroll — convert an ACCEPTED application
 * into a Student_Profile (returns the new account's temporary password). RBAC:
 * super_admin or branch_manager, scoped in the service to the application's
 * branch.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseEnrollApplicant } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { enrollApplicant } from "../../../../../modules/sis/admissions.service";

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

    // Body is optional ({} → defaults enrollmentDate to today).
    const raw = await req.json().catch(() => ({}));
    const input = parseEnrollApplicant(raw);
    const result = await enrollApplicant(getDb(), applicationId, input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

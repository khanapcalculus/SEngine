/**
 * GET /api/me/children/[studentProfileId]/fees
 * A parent views one of their children's fee invoices. Gated by a guardianship
 * row linking ctx.userId → studentProfileId (Guideline #4), then reuses the
 * unchecked invoice listing.
 */
import { getDb } from "../../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../../lib/auth";
import { isUuid } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { assertGuardianOfStudent } from "../../../../../../modules/sis/guardian.service";
import { listInvoicesForStudentUnchecked } from "../../../../../../modules/sis/fees.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ studentProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["parent"]);

    const { studentProfileId } = await params;
    if (!isUuid(studentProfileId))
      return json({ error: "studentProfileId must be a UUID" }, 400);

    const db = getDb();
    await assertGuardianOfStudent(db, ctx.userId, studentProfileId); // throws 403
    const invoices = await listInvoicesForStudentUnchecked(db, studentProfileId);
    return json({ count: invoices.length, invoices });
  } catch (err) {
    return handleError(err);
  }
}

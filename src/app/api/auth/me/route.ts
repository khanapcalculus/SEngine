/**
 * GET /api/auth/me
 * Returns the current authenticated caller (from the session cookie or Bearer
 * token). Used by the frontend to gate pages and read the caller's branch.
 * 401 when not authenticated.
 */
import { getAuthContext } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";

export const runtime = "edge";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    return json({
      userId: ctx.userId,
      role: ctx.role,
      orgId: ctx.orgId,
      branchId: ctx.branchId,
    });
  } catch (err) {
    return handleError(err);
  }
}

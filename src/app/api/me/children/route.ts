/**
 * GET /api/me/children
 * The caller's own children (self-service for a parent). Resolves links from
 * ctx.userId — accepts no id — so a parent can only ever see students they are
 * a verified guardian of (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";
import { listChildrenForParent } from "../../../../modules/sis/guardian.service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["parent"]);
    const children = await listChildrenForParent(getDb(), ctx.userId);
    return json({ count: children.length, children });
  } catch (err) {
    return handleError(err);
  }
}

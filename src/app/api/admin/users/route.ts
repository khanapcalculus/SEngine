/**
 * GET /api/admin/users
 * Lists every user for the super-admin User Management console.
 * RBAC: super_admin only (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";
import { listUsers } from "../../../../modules/admin/user_admin.service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin"]);
    const users = await listUsers(getDb());
    return json({ count: users.length, users });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/admin/tenant-tree
 * Returns the organization -> branch tree for the super admin dashboard.
 * RBAC: super_admin only.
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { json, handleError } from "../../../../lib/http";
import { listTenantTree } from "../../../../modules/admin/tenant.service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin"]);

    const organizations = await listTenantTree(getDb());
    return json({ count: organizations.length, organizations });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * /api/admin/organizations/[orgId]/settings
 *   GET — read an organization's global settings (locale, grading, flags).
 *   PUT — replace them. RBAC: super_admin only; a branch_manager may READ their
 *   own org's settings but not change them.
 */
import { getDb } from "../../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchScope,
} from "../../../../../../lib/auth";
import { isUuid, parseOrgSettings } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import {
  getOrgSettings,
  updateOrgSettings,
} from "../../../../../../modules/admin/org_settings.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);
    const { orgId } = await params;
    if (!isUuid(orgId)) return json({ error: "orgId must be a UUID" }, 400);
    // A branch_manager may only read their own org; super_admin is unrestricted.
    assertBranchScope(ctx, orgId);
    const settings = await getOrgSettings(getDb(), orgId);
    return json(settings);
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin"]); // only the network owner changes tenant config
    const { orgId } = await params;
    if (!isUuid(orgId)) return json({ error: "orgId must be a UUID" }, 400);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseOrgSettings(raw);
    const settings = await updateOrgSettings(getDb(), orgId, input, ctx);
    return json(settings);
  } catch (err) {
    return handleError(err);
  }
}

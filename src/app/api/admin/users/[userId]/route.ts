/**
 * PATCH /api/admin/users/[userId]
 * Edit a user's profile (fullName and/or email) from the super-admin console.
 * RBAC: super_admin only (Guideline #4). Self-service profile edits, if ever
 * needed, would be a separate /api/me/* route.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseUpdateUserProfile } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import {
  updateUserProfile,
  UserNotFoundError,
} from "../../../../../modules/admin/user_admin.service";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin"]);

    const { userId } = await params;
    if (!isUuid(userId)) {
      return json({ error: "userId must be a UUID" }, 400);
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseUpdateUserProfile(raw);
    const updated = await updateUserProfile(getDb(), userId, input, {
      userId: ctx.userId,
    });
    return json(updated);
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return json({ error: err.message }, 404);
    }
    return handleError(err);
  }
}

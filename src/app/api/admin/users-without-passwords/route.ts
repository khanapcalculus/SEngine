/**
 * GET /api/admin/users-without-passwords
 * Lists users who don't have passwords set.
 * This helps Super Admins identify which users need passwords to be able to log in.
 */
import { getDb } from "../../../../db/client";
import { json, handleError } from "../../../../lib/http";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { users } from "../../../../db/schema";
import { isNull } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    // Check if the requester is a Super Admin
    const authContext = await getAuthContext(req);
    requireRole(authContext, ["super_admin"]);

    // Query users without passwords
    const usersWithoutPasswords = await getDb()
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        globalStatus: users.globalStatus,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(isNull(users.passwordHash))
      .orderBy(users.createdAt);

    return json({
      success: true,
      count: usersWithoutPasswords.length,
      users: usersWithoutPasswords,
    }, 200);
  } catch (err) {
    return handleError(err);
  }
}
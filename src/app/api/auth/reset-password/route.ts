/**
 * POST /api/auth/reset-password
 * Allows Super Admins to set passwords for existing users who don't have passwords.
 * This is an emergency endpoint to fix the login issue for existing users.
 */
import { getDb } from "../../../../db/client";
import { parseResetPassword } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { resetPassword, ResetPasswordError } from "../../../../modules/auth/auth.service";
import { getAuthContext, requireRole } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    // Check if the requester is a Super Admin
    const authContext = await getAuthContext(req);
    requireRole(authContext, ["super_admin"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseResetPassword(raw);

    // Reset the password
    await resetPassword(getDb(), input);

    return json({ 
      success: true, 
      message: "Password has been reset successfully" 
    }, 200);
  } catch (err) {
    if (err instanceof ResetPasswordError) {
      return json({ error: err.message }, 400);
    }
    return handleError(err);
  }
}
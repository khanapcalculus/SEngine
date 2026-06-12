/**
 * POST /api/classes/assign
 * Links a student to a class (creates an Enrollment).
 * RBAC: super_admin, branch_manager, or teacher (the educator running the
 * class roster) — students/parents cannot self-assign (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseAssignClass } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { assignStudentToClass } from "../../../../modules/sis/student.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseAssignClass(raw);
    const result = await assignStudentToClass(getDb(), input);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

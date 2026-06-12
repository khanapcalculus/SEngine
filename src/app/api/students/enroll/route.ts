/**
 * POST /api/students/enroll
 * Creates a User (role=student) + Student_Profile in a single transaction.
 * RBAC: super_admin or branch_manager only (Guideline #4).
 */
import { getDb } from "../../../../db/client";
import {
  getAuthContext,
  requireRole,
  assertBranchScope,
} from "../../../../lib/auth";
import { parseEnrollStudent } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { enrollStudent } from "../../../../modules/sis/student.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseEnrollStudent(raw);
    // Branch managers may only enroll into their own tenant.
    assertBranchScope(ctx, input.orgId);

    const result = await enrollStudent(getDb(), input, {
      userId: ctx.userId,
      orgId: ctx.orgId,
    });
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

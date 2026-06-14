/**
 * POST /api/me/ai/derivation
 *
 * Generates a step-by-step math/science derivation from a live whiteboard
 * snapshot, to assist the educator mid-lesson. Self-service (/api/me/*): the
 * caller must be a MEMBER of the class, enforced by assertClassAccess against
 * the DB — so a teacher can only request derivations for their own classes.
 *
 * RBAC: educators only (super_admin, branch_manager, teacher). Students and
 * parents cannot query the AI directly (mirrors /api/ai/tutor-copilot).
 *
 * Node runtime (not edge): the membership check hits Neon via the Drizzle pool,
 * which we run on Node for connection stability (see db/client.ts).
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { parseDerivation } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { assertClassAccess } from "../../../../../modules/lms/membership.service";
import { getGemmaClient } from "../../../../../modules/lms/gemma.factory";
import { runDerivation } from "../../../../../modules/lms/derivation.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    // Educators and up only — students/parents cannot query the AI directly.
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseDerivation(raw);

    // Membership scoping: 403 if the caller isn't a member of this class,
    // 404 (ValidationError) if the class doesn't exist.
    await assertClassAccess(getDb(), ctx, input.classId);

    const result = await runDerivation(getGemmaClient(), input);

    return json({
      classId: input.classId,
      model: result.model,
      derivation: result.derivation,
    });
  } catch (err) {
    return handleError(err);
  }
}

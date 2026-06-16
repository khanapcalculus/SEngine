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
import { appendAiDerivation } from "../../../../../modules/lms/discussion.service";
import { fetchBoardContext } from "../../../../../modules/lms/board_context";

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

    // Prefer the live board read straight from the Durable Object over whatever
    // the client sent; fall back to the client snapshot if the read is down.
    const live = await fetchBoardContext(input.classId, {
      userId: ctx.userId,
      role: ctx.role,
      canDraw: true,
    });
    const derivationInput = live?.text
      ? { ...input, whiteboardContext: live.text }
      : input;

    const result = await runDerivation(getGemmaClient(), derivationInput);

    // Persist into the class discussion so it stays saved for students.
    // Best-effort: a failed save must never lose the generated derivation, so
    // we still return it and report saved:false instead of erroring.
    let threadId: string | null = null;
    try {
      const saved = await appendAiDerivation(getDb(), ctx, {
        classId: input.classId,
        problem: derivationInput.whiteboardContext,
        derivation: result.derivation,
        model: result.model,
      });
      threadId = saved.threadId;
    } catch {
      threadId = null;
    }

    return json({
      classId: input.classId,
      model: result.model,
      derivation: result.derivation,
      saved: threadId !== null,
      threadId,
    });
  } catch (err) {
    return handleError(err);
  }
}

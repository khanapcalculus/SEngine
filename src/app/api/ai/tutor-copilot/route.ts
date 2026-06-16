/**
 * POST /api/ai/tutor-copilot
 * Routes an educator's query + whiteboard context to the Gemma 4 model and
 * returns step-by-step reasoning to assist the tutor.
 *
 * RBAC (Guideline #4 + Constraint 2): teacher, branch_manager, super_admin
 * only. Students and parents CANNOT query the AI directly.
 */
import { getAuthContext, requireRole } from "../../../../lib/auth";
import { parseTutorCopilot } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { getGemmaClient } from "../../../../modules/lms/gemma.factory";
import { runTutorCopilot } from "../../../../modules/lms/tutor.service";
import { fetchBoardContext } from "../../../../modules/lms/board_context";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    // Educators and up only — students explicitly excluded.
    requireRole(ctx, ["super_admin", "branch_manager", "teacher"]);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseTutorCopilot(raw);

    // Read the board SERVER-SIDE from its Durable Object (authoritative); only
    // fall back to client-sent context if the live read is unavailable.
    const live = await fetchBoardContext(input.classId, {
      userId: ctx.userId,
      role: ctx.role,
      canDraw: true,
    });
    const whiteboardContext = live?.text || input.whiteboardContext;

    const result = await runTutorCopilot(getGemmaClient(), { ...input, whiteboardContext });

    return json({
      classId: input.classId,
      model: result.model,
      answer: result.answer,
      contextSource: live?.text ? "server" : input.whiteboardContext ? "client" : "none",
    });
  } catch (err) {
    return handleError(err);
  }
}

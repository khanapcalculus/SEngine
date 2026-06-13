/**
 * POST /api/discussions/threads
 * Open a discussion thread (+ first post) in a class. RBAC: any class member
 * (service). Guideline #4.
 */
import { getDb } from "../../../../db/client";
import { getAuthContext } from "../../../../lib/auth";
import { parseCreateThread } from "../../../../lib/validation";
import { json, handleError } from "../../../../lib/http";
import { createThread } from "../../../../modules/lms/discussion.service";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseCreateThread(raw);
    const result = await createThread(getDb(), input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

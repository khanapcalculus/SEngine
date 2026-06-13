/**
 * POST /api/discussions/threads/[threadId]/posts
 * Reply in a thread (optionally to a parent post). RBAC: any member of the
 * thread's class (service).
 */
import { getDb } from "../../../../../../db/client";
import { getAuthContext } from "../../../../../../lib/auth";
import { isUuid, parseCreatePost } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { addPost } from "../../../../../../modules/lms/discussion.service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    const { threadId } = await params;
    if (!isUuid(threadId)) {
      return json({ error: "threadId must be a UUID" }, 400);
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseCreatePost(raw);
    const result = await addPost(getDb(), threadId, input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

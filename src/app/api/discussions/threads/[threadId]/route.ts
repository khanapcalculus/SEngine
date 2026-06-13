/**
 * GET /api/discussions/threads/[threadId]
 * Fetch a thread and its posts. RBAC: any member of the thread's class (service).
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext } from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { getThreadWithPosts } from "../../../../../modules/lms/discussion.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    const { threadId } = await params;
    if (!isUuid(threadId)) {
      return json({ error: "threadId must be a UUID" }, 400);
    }
    const result = await getThreadWithPosts(getDb(), ctx, threadId);
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

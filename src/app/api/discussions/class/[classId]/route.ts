/**
 * GET /api/discussions/class/[classId]
 * List a class's discussion threads. RBAC: any class member (service).
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext } from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import { listThreadsForClass } from "../../../../../modules/lms/discussion.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ classId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    const { classId } = await params;
    if (!isUuid(classId)) {
      return json({ error: "classId must be a UUID" }, 400);
    }
    const threads = await listThreadsForClass(getDb(), ctx, classId);
    return json({ classId, count: threads.length, threads });
  } catch (err) {
    return handleError(err);
  }
}

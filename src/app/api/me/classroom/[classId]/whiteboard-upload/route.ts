/**
 * POST /api/me/classroom/[classId]/whiteboard-upload
 *
 * Vercel Blob client-upload handshake for whiteboard image inserts. Mirrors the
 * submissions upload route but scopes authorization to CLASS MEMBERSHIP + draw
 * capability instead of submission ownership. The browser uploads bytes DIRECTLY
 * to Blob; they never pass through this function.
 *
 * Images only: PDFs are rasterized to PNG client-side before upload, so the
 * server never receives a PDF here. Needs BLOB_READ_WRITE_TOKEN in the env.
 * The Durable Object op log is the source of truth for what's on the board, so
 * there is no DB record to write on completion.
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getDb } from "../../../../../../db/client";
import {
  getAuthContext,
  requireRole,
  type Role,
} from "../../../../../../lib/auth";
import { assertClassAccess } from "../../../../../../modules/lms/membership.service";
import { isUuid } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";

export const runtime = "nodejs";

/** Roles allowed to draw — and therefore to place media — on the board. */
const DRAW_ROLES: Role[] = ["super_admin", "branch_manager", "teacher", "student"];

const ALLOWED_CONTENT_TYPES = ["image/png", "image/jpeg"];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(
  req: Request,
  { params }: { params: Promise<{ classId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    const { classId } = await params;
    if (!isUuid(classId)) {
      return json({ error: "classId must be a UUID" }, 400);
    }

    const body = (await req.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        // Authorize: the caller must be a member of this class AND a draw role.
        await assertClassAccess(getDb(), ctx, classId);
        requireRole(ctx, DRAW_ROLES);
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          tokenPayload: JSON.stringify({ classId, userId: ctx.userId }),
        };
      },
      // No DB record: the whiteboard DO op log owns board state. Hook left as a
      // no-op (a future audit-log write could live here).
      onUploadCompleted: async () => {},
    });
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/hr/documents/[staffProfileId]/upload
 * Vercel Blob client-upload handshake for staff documents: mints a scoped upload
 * token after verifying the manager may act on this staff member's branch. The
 * browser uploads bytes DIRECTLY to Blob, then registers metadata via
 * POST /api/hr/documents/[staffProfileId]. Needs BLOB_READ_WRITE_TOKEN.
 *
 * RBAC: super_admin or branch_manager (branch-scoped). Mirrors the submission
 * upload handshake.
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getDb } from "../../../../../../db/client";
import { getAuthContext, requireRole, assertBranchAccess } from "../../../../../../lib/auth";
import { isUuid } from "../../../../../../lib/validation";
import { json, handleError } from "../../../../../../lib/http";
import { resolveStaffBranch } from "../../../../../../modules/hr/documents.service";

export const runtime = "nodejs";

const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(
  req: Request,
  { params }: { params: Promise<{ staffProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);
    const { staffProfileId } = await params;
    if (!isUuid(staffProfileId))
      return json({ error: "staffProfileId must be a UUID" }, 400);

    const body = (await req.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        // Authorize: the manager must own this staff member's branch.
        assertBranchAccess(ctx, await resolveStaffBranch(getDb(), staffProfileId));
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          tokenPayload: JSON.stringify({ staffProfileId }),
        };
      },
      // Metadata is registered by the client after upload (works in dev + prod).
      onUploadCompleted: async () => {},
    });
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

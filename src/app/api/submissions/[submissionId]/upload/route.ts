/**
 * POST /api/submissions/[submissionId]/upload
 * Vercel Blob client-upload handshake: mints a scoped upload token after
 * verifying the caller owns the submission, then records the file metadata when
 * the upload completes. The browser uploads bytes DIRECTLY to Blob; they never
 * pass through this function.
 *
 * RBAC: the owning student (assertSubmissionOwner). Needs BLOB_READ_WRITE_TOKEN
 * in the environment. Note: onUploadCompleted only fires on a public deployment
 * (not localhost) — for local/dev use POST /api/submissions/[id]/files instead.
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getDb } from "../../../../../db/client";
import { getAuthContext } from "../../../../../lib/auth";
import { isUuid } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import {
  assertSubmissionOwner,
  recordSubmissionFile,
} from "../../../../../modules/lms/submission.service";

export const runtime = "nodejs";

const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(
  req: Request,
  { params }: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    if (ctx.role !== "student") {
      return json({ error: "Only students may upload submission files" }, 403);
    }
    const { submissionId } = await params;
    if (!isUuid(submissionId)) {
      return json({ error: "submissionId must be a UUID" }, 400);
    }

    const body = (await req.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        // Authorize: the caller must own this submission.
        await assertSubmissionOwner(getDb(), ctx, submissionId);
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          tokenPayload: JSON.stringify({ submissionId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = tokenPayload ? JSON.parse(tokenPayload) : {};
        await recordSubmissionFile(
          getDb(),
          payload.submissionId ?? submissionId,
          {
            fileName: blob.pathname,
            url: blob.url,
            storageKey: blob.pathname,
            contentType: blob.contentType,
          },
        );
      },
    });
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}

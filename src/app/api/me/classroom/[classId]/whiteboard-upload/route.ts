/**
 * POST /api/me/classroom/[classId]/whiteboard-upload
 *
 * Server-side Vercel Blob upload for whiteboard image inserts. The browser POSTs
 * the raw file bytes to THIS route (multipart/form-data), and we upload to Blob
 * with put(). We deliberately do NOT use the client-upload handshake
 * (@vercel/blob/client): that makes the browser PUT directly to Vercel's Blob
 * API, which was being rejected (400/CORS) in this deployment. Routing the bytes
 * through our Node function is robust and keeps the same RBAC.
 *
 * Authorization: class membership + a draw-capable role (mirrors the RTC token
 * route). Images only — PDFs are rasterized to PNG client-side before upload, so
 * the server never receives a PDF here. Needs BLOB_READ_WRITE_TOKEN in the env.
 * The Durable Object op log is the source of truth for the board, so there's no
 * DB record to write.
 */
import { put } from "@vercel/blob";
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

    // Blob config must be present and well-formed (a hand-pasted value with
    // quotes/whitespace, or a non-rw token, fails opaquely deep in the SDK).
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    if (!blobToken) {
      console.error("[whiteboard-upload] BLOB_READ_WRITE_TOKEN is undefined.");
      return json(
        { error: "Image storage is not configured (BLOB_READ_WRITE_TOKEN missing)." },
        503,
      );
    }
    if (!blobToken.startsWith("vercel_blob_rw_")) {
      console.error("[whiteboard-upload] BLOB_READ_WRITE_TOKEN is malformed.");
      return json(
        {
          error:
            "Image storage token looks malformed. Re-connect the Vercel Blob store to the project (don't paste the token by hand).",
        },
        503,
      );
    }

    // Authorize: class member + draw role.
    await assertClassAccess(getDb(), ctx, classId);
    requireRole(ctx, DRAW_ROLES);

    // Read the file from multipart form data.
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ error: "Expected a 'file' field with the image." }, 400);
    }
    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return json(
        { error: `Unsupported image type "${file.type}". Use PNG or JPEG.` },
        415,
      );
    }
    if (file.size > MAX_BYTES) {
      return json({ error: "Image exceeds the 20 MB limit." }, 413);
    }

    // Namespace by class; randomSuffix avoids collisions on identical filenames.
    const safeName = file.name.replace(/[^\w.\-]+/g, "_") || "image.png";
    try {
      const blob = await put(`whiteboard/${classId}/${safeName}`, file, {
        access: "public",
        contentType: file.type,
        addRandomSuffix: true,
        token: blobToken,
      });
      return json({ url: blob.url, pathname: blob.pathname });
    } catch (putErr) {
      // Surface the real Blob error instead of a generic 500 — this is the
      // boundary we've been blind to. Logged to the Vercel function logs too.
      const detail = putErr instanceof Error ? putErr.message : String(putErr);
      console.error("[whiteboard-upload] put() failed:", detail, putErr);
      return json({ error: `Blob upload failed: ${detail}` }, 502);
    }
  } catch (err) {
    console.error("[whiteboard-upload] request failed:", err);
    return handleError(err);
  }
}

/**
 * /api/hr/documents/[staffProfileId]
 *   GET  — list a staff member's documents.
 *   POST — register a document's metadata (after its bytes are uploaded to Blob).
 * RBAC: super_admin or branch_manager, scoped in the service to the staff
 * member's branch.
 */
import { getDb } from "../../../../../db/client";
import { getAuthContext, requireRole } from "../../../../../lib/auth";
import { isUuid, parseRegisterStaffDocument } from "../../../../../lib/validation";
import { json, handleError } from "../../../../../lib/http";
import {
  listDocumentsForStaff,
  recordStaffDocument,
} from "../../../../../modules/hr/documents.service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ staffProfileId: string }> },
): Promise<Response> {
  try {
    const ctx = await getAuthContext(req);
    requireRole(ctx, ["super_admin", "branch_manager"]);
    const { staffProfileId } = await params;
    if (!isUuid(staffProfileId))
      return json({ error: "staffProfileId must be a UUID" }, 400);
    const documents = await listDocumentsForStaff(getDb(), staffProfileId, ctx);
    return json({ count: documents.length, documents });
  } catch (err) {
    return handleError(err);
  }
}

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

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const input = parseRegisterStaffDocument(raw);
    const result = await recordStaffDocument(getDb(), staffProfileId, input, ctx);
    return json(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

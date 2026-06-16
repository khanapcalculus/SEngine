/**
 * Module 2 — HR onboarding documents service. Stores metadata for staff files
 * (contracts, IDs, certificates) whose bytes live in Vercel Blob. Branch-scoped
 * + audited, mirroring submission_files. resolveStaffBranch is the scope pivot.
 */
import { desc, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { staffProfiles, staffDocuments } from "../../db/schema";
import { ValidationError } from "../../lib/validation";
import type { RegisterStaffDocumentInput } from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

/** Resolve a staff member's branch (scope pivot). 404 if missing. */
export async function resolveStaffBranch(
  db: Pick<DB, "select">,
  staffProfileId: string,
): Promise<string> {
  const [row] = await db
    .select({ id: staffProfiles.id, branchId: staffProfiles.branchId })
    .from(staffProfiles)
    .where(eq(staffProfiles.id, staffProfileId))
    .limit(1);
  if (!row) {
    throw new ValidationError("Staff profile not found", {
      staffProfileId: "no such staff profile",
    });
  }
  return row.branchId;
}

export interface DocumentRow {
  id: string;
  category: string;
  fileName: string;
  contentType: string | null;
  url: string;
  createdAt: Date;
}

const DOC_COLS = {
  id: staffDocuments.id,
  category: staffDocuments.category,
  fileName: staffDocuments.fileName,
  contentType: staffDocuments.contentType,
  url: staffDocuments.url,
  createdAt: staffDocuments.createdAt,
};

/** Record a staff document's metadata (bytes already in Blob). */
export async function recordStaffDocument(
  db: DB,
  staffProfileId: string,
  input: RegisterStaffDocumentInput,
  ctx: AuthContext,
): Promise<DocumentRow> {
  return db.transaction(async (tx) => {
    const branchId = await resolveStaffBranch(tx, staffProfileId);
    assertBranchAccess(ctx, branchId);

    const [row] = await tx
      .insert(staffDocuments)
      .values({
        staffId: staffProfileId,
        branchId,
        category: input.category ?? "other",
        fileName: input.fileName,
        contentType: input.contentType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        storageKey: input.storageKey,
        url: input.url,
        uploadedBy: ctx.userId,
      })
      .returning(DOC_COLS);

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId,
      action: "hr.document.add",
      entityType: "staff_document",
      entityId: row.id,
      summary: `Added ${input.category ?? "other"} document "${input.fileName}" for staff ${staffProfileId}`,
    });
    return row;
  });
}

/** A staff member's documents, newest first. Branch-scoped. */
export async function listDocumentsForStaff(
  db: DB,
  staffProfileId: string,
  ctx: AuthContext,
): Promise<DocumentRow[]> {
  assertBranchAccess(ctx, await resolveStaffBranch(db, staffProfileId));
  return db
    .select(DOC_COLS)
    .from(staffDocuments)
    .where(eq(staffDocuments.staffId, staffProfileId))
    .orderBy(desc(staffDocuments.createdAt));
}

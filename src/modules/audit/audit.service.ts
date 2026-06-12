/**
 * Module 1 — Audit logging.
 *
 * A tiny append-only writer. Callers pass an executor (the db handle, or a
 * transaction tx) so the audit row commits atomically with the change it
 * records. There is intentionally NO update or delete here — the log is
 * immutable by construction.
 */
import { desc, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { auditLogs } from "../../db/schema";

export interface AuditEntry {
  actorId: string | null;
  orgId: string | null;
  branchId: string | null;
  action: string; // dotted verb, e.g. "staff.onboard"
  entityType: string; // e.g. "staff_profile"
  entityId: string | null;
  summary: string; // human-readable one-liner
  metadata?: Record<string, unknown>;
}

/** Anything with .insert — the db handle or a transaction. */
type Executor = Pick<DB, "insert">;

/** Write one immutable audit row. Safe to call inside a transaction. */
export async function writeAudit(
  exec: Executor,
  entry: AuditEntry,
): Promise<void> {
  await exec.insert(auditLogs).values({
    actorId: entry.actorId,
    orgId: entry.orgId,
    branchId: entry.branchId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    metadata: entry.metadata ?? null,
  });
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  summary: string;
  createdAt: Date; // serialized to an ISO string in the JSON response
}

/** Read the most recent audit entries for a branch (newest first). */
export async function listAuditForBranch(
  db: DB,
  branchId: string,
  limit = 50,
): Promise<AuditRow[]> {
  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      summary: auditLogs.summary,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.branchId, branchId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

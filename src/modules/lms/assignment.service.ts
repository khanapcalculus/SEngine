/**
 * Module 4 — Assignments: service layer.
 *
 * Stateless functions; DB handle injected. Class membership is enforced via
 * assertClassAccess so only a class's staff create/manage and only its members
 * read. Audited.
 */
import { desc, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { assignments } from "../../db/schema";
import type {
  CreateAssignmentInput,
  AssignmentStatusInput,
} from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { AuthError, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";
import { assertClassAccess } from "./membership.service";

const STAFF_ROLES = new Set(["super_admin", "branch_manager", "teacher"]);

export interface AssignmentRow {
  id: string;
  classId: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  maxPoints: number;
  status: string;
  createdAt: Date;
}

/**
 * Create an assignment for a class. Caller must be staff (admin/manager/teacher)
 * AND a member of the class (teacher assigned / manager in-branch).
 */
export async function createAssignment(
  db: DB,
  input: CreateAssignmentInput,
  ctx: AuthContext,
): Promise<AssignmentRow> {
  return db.transaction(async (tx) => {
    const access = await assertClassAccess(tx, ctx, input.classId);
    if (!STAFF_ROLES.has(ctx.role)) {
      throw new AuthError(403, "Only staff may create assignments");
    }

    const [row] = await tx
      .insert(assignments)
      .values({
        classId: input.classId,
        createdBy: ctx.userId,
        title: input.title,
        description: input.description ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        maxPoints: input.maxPoints,
        status: "draft",
      })
      .returning();

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: access.branchId,
      action: "assignment.create",
      entityType: "assignment",
      entityId: row.id,
      summary: `Created assignment "${input.title}" for class ${input.classId}`,
    });

    return toRow(row);
  });
}

/**
 * List a class's assignments (any member). Students see only published; staff
 * see every status.
 */
export async function listAssignmentsForClass(
  db: DB,
  ctx: AuthContext,
  classId: string,
): Promise<AssignmentRow[]> {
  await assertClassAccess(db, ctx, classId);

  const rows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.classId, classId))
    .orderBy(desc(assignments.createdAt));

  const visible = STAFF_ROLES.has(ctx.role)
    ? rows
    : rows.filter((r) => r.status === "published");
  return visible.map(toRow);
}

/**
 * Change an assignment's publication status (staff member of the class only).
 */
export async function setAssignmentStatus(
  db: DB,
  assignmentId: string,
  input: AssignmentStatusInput,
  ctx: AuthContext,
): Promise<AssignmentRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    if (!row) {
      throw new ValidationError("Assignment not found", {
        assignmentId: "no such assignment",
      });
    }

    const access = await assertClassAccess(tx, ctx, row.classId);
    if (!STAFF_ROLES.has(ctx.role)) {
      throw new AuthError(403, "Only staff may change assignment status");
    }

    const [updated] = await tx
      .update(assignments)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(assignments.id, assignmentId))
      .returning();

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: access.branchId,
      action: "assignment.status",
      entityType: "assignment",
      entityId: assignmentId,
      summary: `Assignment ${assignmentId} -> ${input.status}`,
    });

    return toRow(updated);
  });
}

function toRow(r: typeof assignments.$inferSelect): AssignmentRow {
  return {
    id: r.id,
    classId: r.classId,
    title: r.title,
    description: r.description,
    dueDate: r.dueDate,
    maxPoints: r.maxPoints,
    status: r.status,
    createdAt: r.createdAt,
  };
}

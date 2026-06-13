/**
 * Module 3 — Class management service.
 * Create a course section and list a branch's classes. createClass writes an
 * audit row atomically with the insert.
 */
import { eq, desc } from "drizzle-orm";
import type { DB } from "../../db/client";
import { classes } from "../../db/schema";
import type { CreateClassInput } from "../../lib/validation";
import { writeAudit } from "../audit/audit.service";

export interface CreatedClass {
  id: string;
  subject: string;
  term: string;
  branchId: string;
  credits: number;
}

export interface ClassActor {
  userId: string;
  orgId: string | null;
}

/** Create a class section (+ audit). */
export async function createClass(
  db: DB,
  input: CreateClassInput,
  actor: ClassActor,
): Promise<CreatedClass> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(classes)
      .values({
        branchId: input.branchId,
        subject: input.subject,
        term: input.term,
        credits: input.credits,
      })
      .returning({
        id: classes.id,
        subject: classes.subject,
        term: classes.term,
        branchId: classes.branchId,
        credits: classes.credits,
      });

    await writeAudit(tx, {
      actorId: actor.userId,
      orgId: actor.orgId,
      branchId: input.branchId,
      action: "class.create",
      entityType: "class",
      entityId: row.id,
      summary: `Created class "${input.subject}" (${input.term}, ${input.credits} cr)`,
    });

    return row;
  });
}

export interface ClassRow {
  id: string;
  subject: string;
  term: string;
  credits: number;
}

/** List a branch's classes, newest first. */
export async function listClassesForBranch(
  db: DB,
  branchId: string,
): Promise<ClassRow[]> {
  return db
    .select({
      id: classes.id,
      subject: classes.subject,
      term: classes.term,
      credits: classes.credits,
    })
    .from(classes)
    .where(eq(classes.branchId, branchId))
    .orderBy(desc(classes.createdAt));
}

/**
 * Module 1/3 — Guardianships: links a parent User to a Student_Profile so the
 * Parent portal can read that child's record. Every parent-facing read is gated
 * by `assertGuardianOfStudent`, so a parent can only ever see their own
 * children (Guideline #4). Mutations (link/unlink) are manager-scoped and
 * audited, mirroring the other SIS services.
 */
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DB } from "../../db/client";
import { users, studentProfiles, guardianships } from "../../db/schema";
import { ValidationError } from "../../lib/validation";
import { AuthError, assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

export interface LinkGuardianInput {
  parentEmail: string;
  studentProfileId: string;
  relationship: string;
}

export interface GuardianLink {
  id: string;
  parentUserId: string;
  parentName: string;
  studentProfileId: string;
  relationship: string;
}

/**
 * Link an existing parent account to a student. The parent must already exist
 * (account creation is a separate flow) and hold the `parent` role. Branch scope
 * is enforced against the STUDENT's branch (the manager acting must own it).
 */
export async function linkGuardian(
  db: DB,
  input: LinkGuardianInput,
  ctx: AuthContext,
): Promise<GuardianLink> {
  return db.transaction(async (tx) => {
    const [student] = await tx
      .select({ id: studentProfiles.id, branchId: studentProfiles.branchId })
      .from(studentProfiles)
      .where(eq(studentProfiles.id, input.studentProfileId))
      .limit(1);
    if (!student) {
      throw new ValidationError("Student not found", {
        studentProfileId: "no such student",
      });
    }
    assertBranchAccess(ctx, student.branchId);

    const [parent] = await tx
      .select({ id: users.id, fullName: users.fullName, role: users.role })
      .from(users)
      .where(eq(users.email, input.parentEmail))
      .limit(1);
    if (!parent) {
      throw new ValidationError("Parent account not found", {
        parentEmail: "no account with that email — create the parent account first",
      });
    }
    if (parent.role !== "parent") {
      throw new ValidationError("That account is not a parent", {
        parentEmail: `account role is "${parent.role}"`,
      });
    }

    const dupe = await tx
      .select({ id: guardianships.id })
      .from(guardianships)
      .where(
        and(
          eq(guardianships.parentUserId, parent.id),
          eq(guardianships.studentProfileId, student.id),
        ),
      )
      .limit(1);
    if (dupe.length > 0) {
      throw new ValidationError("Already linked", {
        parentEmail: "this parent is already linked to this student",
      });
    }

    const [row] = await tx
      .insert(guardianships)
      .values({
        parentUserId: parent.id,
        studentProfileId: student.id,
        relationship: input.relationship,
      })
      .returning({ id: guardianships.id });

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: student.branchId,
      action: "guardian.link",
      entityType: "guardianship",
      entityId: row.id,
      summary: `Linked parent ${input.parentEmail} to student ${student.id} (${input.relationship})`,
    });

    return {
      id: row.id,
      parentUserId: parent.id,
      parentName: parent.fullName,
      studentProfileId: student.id,
      relationship: input.relationship,
    };
  });
}

export interface ChildRow {
  studentProfileId: string;
  fullName: string;
  cohortYear: number;
  currentLevel: number;
  status: string;
  relationship: string;
}

/** The children a parent may view (keyed off the verified parent user id). */
export async function listChildrenForParent(
  db: DB,
  parentUserId: string,
): Promise<ChildRow[]> {
  return db
    .select({
      studentProfileId: studentProfiles.id,
      fullName: users.fullName,
      cohortYear: studentProfiles.cohortYear,
      currentLevel: studentProfiles.currentLevel,
      status: studentProfiles.status,
      relationship: guardianships.relationship,
    })
    .from(guardianships)
    .innerJoin(studentProfiles, eq(guardianships.studentProfileId, studentProfiles.id))
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .where(eq(guardianships.parentUserId, parentUserId));
}

/**
 * Authorize a parent to read a specific student. Throws AuthError(403) when no
 * guardianship row links them — the gate for every parent child-data read.
 */
export async function assertGuardianOfStudent(
  db: Pick<DB, "select">,
  parentUserId: string,
  studentProfileId: string,
): Promise<void> {
  const rows = await db
    .select({ id: guardianships.id })
    .from(guardianships)
    .where(
      and(
        eq(guardianships.parentUserId, parentUserId),
        eq(guardianships.studentProfileId, studentProfileId),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new AuthError(403, "You are not a guardian of this student");
  }
}

export interface GuardianRow {
  id: string;
  parentName: string;
  parentEmail: string;
  studentName: string;
  studentProfileId: string;
  relationship: string;
}

/** All guardian links for students in a branch (manager view). */
export async function listGuardiansForBranch(
  db: DB,
  branchId: string,
): Promise<GuardianRow[]> {
  const parent = alias(users, "parent_user");
  const studentUser = alias(users, "student_user");
  return db
    .select({
      id: guardianships.id,
      parentName: parent.fullName,
      parentEmail: parent.email,
      studentName: studentUser.fullName,
      studentProfileId: studentProfiles.id,
      relationship: guardianships.relationship,
    })
    .from(guardianships)
    .innerJoin(studentProfiles, eq(guardianships.studentProfileId, studentProfiles.id))
    .innerJoin(parent, eq(guardianships.parentUserId, parent.id))
    .innerJoin(studentUser, eq(studentProfiles.userId, studentUser.id))
    .where(eq(studentProfiles.branchId, branchId));
}

/** Remove a guardian link (manager-scoped, audited). */
export async function unlinkGuardian(
  db: DB,
  guardianshipId: string,
  ctx: AuthContext,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: guardianships.id,
        branchId: studentProfiles.branchId,
      })
      .from(guardianships)
      .innerJoin(studentProfiles, eq(guardianships.studentProfileId, studentProfiles.id))
      .where(eq(guardianships.id, guardianshipId))
      .limit(1);
    if (!row) {
      throw new ValidationError("Guardian link not found", {
        guardianshipId: "no such link",
      });
    }
    assertBranchAccess(ctx, row.branchId);

    await tx.delete(guardianships).where(eq(guardianships.id, guardianshipId));

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: row.branchId,
      action: "guardian.unlink",
      entityType: "guardianship",
      entityId: guardianshipId,
      summary: `Removed guardian link ${guardianshipId}`,
    });
  });
}

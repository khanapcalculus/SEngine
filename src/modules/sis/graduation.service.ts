/**
 * Module 3 — Graduation & Alumni service. Graduating a student flips their
 * profile to `graduated`, stamps the graduation date, and issues a credential
 * with a unique public-verifiable serial. Alumni listing and the public
 * credential-verification lookup read from here. Mutations are branch-scoped +
 * audited; verification is intentionally public and exposes only the minimum.
 */
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { credentials, studentProfiles, users, branches } from "../../db/schema";
import { ValidationError } from "../../lib/validation";
import type { GraduateStudentInput } from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

/** A short, hard-to-guess, human-readable credential serial. */
function makeSerial(): string {
  const hex = globalThis.crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `SE-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export interface CredentialRow {
  id: string;
  studentProfileId: string;
  title: string;
  program: string | null;
  serial: string;
  gpa: string | null;
  issuedDate: string;
}

const CRED_COLS = {
  id: credentials.id,
  studentProfileId: credentials.studentProfileId,
  title: credentials.title,
  program: credentials.program,
  serial: credentials.serial,
  gpa: credentials.gpa,
  issuedDate: credentials.issuedDate,
};

/**
 * Graduate a student and issue a credential. Flips status → graduated, stamps
 * graduationDate, and records the credential atomically. Rejects a student who
 * is already graduated.
 */
export async function graduateStudent(
  db: DB,
  studentProfileId: string,
  input: GraduateStudentInput,
  ctx: AuthContext,
): Promise<CredentialRow> {
  return db.transaction(async (tx) => {
    const [student] = await tx
      .select({ id: studentProfiles.id, branchId: studentProfiles.branchId, status: studentProfiles.status })
      .from(studentProfiles)
      .where(eq(studentProfiles.id, studentProfileId))
      .limit(1);
    if (!student) {
      throw new ValidationError("Student not found", { studentProfileId: "no such student" });
    }
    assertBranchAccess(ctx, student.branchId);
    if (student.status === "graduated") {
      throw new ValidationError("Student already graduated", {
        studentProfileId: "already graduated",
      });
    }

    await tx
      .update(studentProfiles)
      .set({ status: "graduated", graduationDate: input.issuedDate, updatedAt: new Date() })
      .where(eq(studentProfiles.id, studentProfileId));

    const [row] = await tx
      .insert(credentials)
      .values({
        studentProfileId,
        branchId: student.branchId,
        title: input.title,
        program: input.program ?? null,
        serial: makeSerial(),
        gpa: input.gpa !== undefined ? input.gpa.toFixed(2) : null,
        issuedDate: input.issuedDate,
        issuedBy: ctx.userId,
      })
      .returning(CRED_COLS);

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: student.branchId,
      action: "student.graduate",
      entityType: "credential",
      entityId: row.id,
      summary: `Graduated student ${studentProfileId}; issued "${input.title}" (${row.serial})`,
    });
    return row;
  });
}

export interface AlumniRow {
  studentProfileId: string;
  fullName: string;
  email: string;
  graduationDate: string | null;
  title: string | null;
  serial: string | null;
  issuedDate: string | null;
}

/** Graduated students in a branch, with their issued credential (if any). */
export async function listAlumniForBranch(
  db: DB,
  branchId: string,
): Promise<AlumniRow[]> {
  return db
    .select({
      studentProfileId: studentProfiles.id,
      fullName: users.fullName,
      email: users.email,
      graduationDate: studentProfiles.graduationDate,
      title: credentials.title,
      serial: credentials.serial,
      issuedDate: credentials.issuedDate,
    })
    .from(studentProfiles)
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .leftJoin(credentials, eq(credentials.studentProfileId, studentProfiles.id))
    .where(and(eq(studentProfiles.branchId, branchId), eq(studentProfiles.status, "graduated")))
    .orderBy(desc(studentProfiles.graduationDate));
}

/** A student's issued credentials. Branch-scoped. */
export async function listCredentialsForStudent(
  db: DB,
  studentProfileId: string,
  ctx: AuthContext,
): Promise<CredentialRow[]> {
  const [student] = await db
    .select({ id: studentProfiles.id, branchId: studentProfiles.branchId })
    .from(studentProfiles)
    .where(eq(studentProfiles.id, studentProfileId))
    .limit(1);
  if (!student) {
    throw new ValidationError("Student not found", { studentProfileId: "no such student" });
  }
  assertBranchAccess(ctx, student.branchId);
  return db
    .select(CRED_COLS)
    .from(credentials)
    .where(eq(credentials.studentProfileId, studentProfileId))
    .orderBy(desc(credentials.issuedDate));
}

export interface VerificationResult {
  valid: boolean;
  holderName?: string;
  title?: string;
  program?: string | null;
  issuedDate?: string;
  branchLocation?: string;
}

/**
 * PUBLIC credential verification by serial. Exposes only what a verifier needs
 * to confirm a diploma is genuine — holder name, title, issue date, issuing
 * branch — and nothing else from the student record. Returns {valid:false} for
 * an unknown serial (no information leak).
 */
export async function verifyCredential(
  db: DB,
  serial: string,
): Promise<VerificationResult> {
  const [row] = await db
    .select({
      title: credentials.title,
      program: credentials.program,
      issuedDate: credentials.issuedDate,
      holderName: users.fullName,
      branchLocation: branches.location,
    })
    .from(credentials)
    .innerJoin(studentProfiles, eq(credentials.studentProfileId, studentProfiles.id))
    .innerJoin(users, eq(studentProfiles.userId, users.id))
    .innerJoin(branches, eq(credentials.branchId, branches.id))
    .where(eq(credentials.serial, serial))
    .limit(1);

  if (!row) return { valid: false };
  return {
    valid: true,
    holderName: row.holderName,
    title: row.title,
    program: row.program,
    issuedDate: row.issuedDate,
    branchLocation: row.branchLocation,
  };
}

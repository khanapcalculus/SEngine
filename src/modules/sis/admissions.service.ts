/**
 * Module 3 — Admissions funnel service. Applications move
 * submitted → under_review → accepted/rejected → enrolled. Enrolling an accepted
 * application converts it into a real Student_Profile (reusing the same
 * enrollStudent path the manual enrollment route uses) and links the funnel row
 * to the created record. Every mutation is branch-scoped (Guideline #4) and
 * audited.
 */
import { desc, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { admissionApplications, branches } from "../../db/schema";
import { ValidationError } from "../../lib/validation";
import type {
  CreateApplicationInput,
  ApplicationDecisionInput,
  EnrollApplicantInput,
} from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";
import { enrollStudent } from "./student.service";

export interface ApplicationRow {
  id: string;
  branchId: string;
  applicantName: string;
  applicantEmail: string;
  cohortYear: number;
  status: string;
  examScore: number | null;
  notes: string | null;
  studentProfileId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const APP_COLS = {
  id: admissionApplications.id,
  branchId: admissionApplications.branchId,
  applicantName: admissionApplications.applicantName,
  applicantEmail: admissionApplications.applicantEmail,
  cohortYear: admissionApplications.cohortYear,
  status: admissionApplications.status,
  examScore: admissionApplications.examScore,
  notes: admissionApplications.notes,
  studentProfileId: admissionApplications.studentProfileId,
  decidedAt: admissionApplications.decidedAt,
  createdAt: admissionApplications.createdAt,
};

/** Create a new application in the `submitted` stage. */
export async function createApplication(
  db: DB,
  input: CreateApplicationInput,
  ctx: AuthContext,
): Promise<ApplicationRow> {
  assertBranchAccess(ctx, input.branchId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(admissionApplications)
      .values({
        branchId: input.branchId,
        applicantName: input.applicantName,
        applicantEmail: input.applicantEmail,
        cohortYear: input.cohortYear,
        examScore: input.examScore ?? null,
        notes: input.notes ?? null,
      })
      .returning(APP_COLS);

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: input.branchId,
      action: "admission.create",
      entityType: "admission_application",
      entityId: row.id,
      summary: `Application from ${input.applicantName} (${input.applicantEmail}), cohort ${input.cohortYear}`,
    });
    return row;
  });
}

/** A branch's applications, newest first. */
export async function listApplicationsForBranch(
  db: DB,
  branchId: string,
): Promise<ApplicationRow[]> {
  return db
    .select(APP_COLS)
    .from(admissionApplications)
    .where(eq(admissionApplications.branchId, branchId))
    .orderBy(desc(admissionApplications.createdAt));
}

/** Move an application to under_review / accepted / rejected. */
export async function decideApplication(
  db: DB,
  applicationId: string,
  input: ApplicationDecisionInput,
  ctx: AuthContext,
): Promise<ApplicationRow> {
  return db.transaction(async (tx) => {
    const [app] = await tx
      .select({ id: admissionApplications.id, branchId: admissionApplications.branchId, status: admissionApplications.status })
      .from(admissionApplications)
      .where(eq(admissionApplications.id, applicationId))
      .limit(1);
    if (!app) {
      throw new ValidationError("Application not found", { applicationId: "no such application" });
    }
    assertBranchAccess(ctx, app.branchId);
    if (app.status === "enrolled") {
      throw new ValidationError("Application already enrolled", {
        applicationId: "an enrolled application can't change status",
      });
    }

    const [row] = await tx
      .update(admissionApplications)
      .set({ status: input.status, reviewedBy: ctx.userId, decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(admissionApplications.id, applicationId))
      .returning(APP_COLS);

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: app.branchId,
      action: "admission.decide",
      entityType: "admission_application",
      entityId: applicationId,
      summary: `Application ${applicationId} → ${input.status}`,
    });
    return row;
  });
}

export interface EnrolledApplicant {
  applicationId: string;
  studentProfileId: string;
  email: string;
  temporaryPassword: string;
}

/**
 * Convert an ACCEPTED application into a Student_Profile. Creates the student
 * (same path as manual enrollment) then links + flips the application to
 * `enrolled`. Idempotency: an already-enrolled application is rejected.
 */
export async function enrollApplicant(
  db: DB,
  applicationId: string,
  input: EnrollApplicantInput,
  ctx: AuthContext,
): Promise<EnrolledApplicant> {
  // Load + authorize, and resolve the branch's org for the new user record.
  const [app] = await db
    .select({
      id: admissionApplications.id,
      branchId: admissionApplications.branchId,
      status: admissionApplications.status,
      applicantName: admissionApplications.applicantName,
      applicantEmail: admissionApplications.applicantEmail,
      cohortYear: admissionApplications.cohortYear,
    })
    .from(admissionApplications)
    .where(eq(admissionApplications.id, applicationId))
    .limit(1);
  if (!app) {
    throw new ValidationError("Application not found", { applicationId: "no such application" });
  }
  assertBranchAccess(ctx, app.branchId);
  if (app.status === "enrolled") {
    throw new ValidationError("Application already enrolled", { applicationId: "already enrolled" });
  }
  if (app.status !== "accepted") {
    throw new ValidationError("Application must be accepted first", {
      applicationId: `current status is "${app.status}"`,
    });
  }

  const [branch] = await db
    .select({ id: branches.id, orgId: branches.orgId })
    .from(branches)
    .where(eq(branches.id, app.branchId))
    .limit(1);
  if (!branch) {
    throw new ValidationError("Branch not found", { branchId: "no such branch" });
  }

  // Create the student (own transaction + audit), then link the application.
  const created = await enrollStudent(
    db,
    {
      email: app.applicantEmail,
      fullName: app.applicantName,
      branchId: app.branchId,
      orgId: branch.orgId,
      enrollmentDate: input.enrollmentDate,
      cohortYear: app.cohortYear,
    },
    { userId: ctx.userId, orgId: ctx.orgId },
  );

  await db.transaction(async (tx) => {
    await tx
      .update(admissionApplications)
      .set({
        status: "enrolled",
        studentProfileId: created.studentProfileId,
        decidedAt: new Date(),
        reviewedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(admissionApplications.id, applicationId));

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: app.branchId,
      action: "admission.enroll",
      entityType: "admission_application",
      entityId: applicationId,
      summary: `Enrolled applicant ${app.applicantEmail} → student ${created.studentProfileId}`,
    });
  });

  return {
    applicationId,
    studentProfileId: created.studentProfileId,
    email: created.email,
    temporaryPassword: created.temporaryPassword,
  };
}

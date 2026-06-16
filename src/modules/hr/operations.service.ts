/**
 * Module 2 — HR Operations service: staff attendance, payroll, and performance
 * reviews. Stateless functions over an injected DB handle (Guideline #1). Every
 * call resolves the staff member's branch and runs the branch-scope guard before
 * touching data (Guideline #4), so a branch manager can only operate within
 * their own branch. Mutations write an audit row in the same transaction.
 */
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  staffProfiles,
  staffAttendance,
  payrollRecords,
  performanceReviews,
} from "../../db/schema";
import { ValidationError } from "../../lib/validation";
import type {
  RecordAttendanceInput,
  CreatePayrollInput,
  CreateReviewInput,
} from "../../lib/validation";
import { AuthError, assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

interface Actor {
  userId: string;
  orgId: string | null;
}
const actorOf = (ctx: AuthContext): Actor => ({ userId: ctx.userId, orgId: ctx.orgId });

/** Resolve a staff member's branch (for scope checks). Throws 404 if missing. */
async function resolveStaffBranch(
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

/* ── Attendance ─────────────────────────────────────────────────── */
export interface AttendanceRow {
  id: string;
  date: string;
  status: string;
  notes: string | null;
}

/**
 * Record (or update) a staff member's attendance for a day. Re-recording the
 * same (staff, date) updates the existing row so there's one authoritative
 * record per day.
 */
export async function recordAttendance(
  db: DB,
  input: RecordAttendanceInput,
  ctx: AuthContext,
): Promise<AttendanceRow> {
  return db.transaction(async (tx) => {
    const branchId = await resolveStaffBranch(tx, input.staffProfileId);
    assertBranchAccess(ctx, branchId);

    const [existing] = await tx
      .select({ id: staffAttendance.id })
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.staffId, input.staffProfileId),
          eq(staffAttendance.date, input.date),
        ),
      )
      .limit(1);

    let row: AttendanceRow;
    if (existing) {
      const [updated] = await tx
        .update(staffAttendance)
        .set({
          status: input.status,
          notes: input.notes ?? null,
          recordedBy: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(staffAttendance.id, existing.id))
        .returning({
          id: staffAttendance.id,
          date: staffAttendance.date,
          status: staffAttendance.status,
          notes: staffAttendance.notes,
        });
      row = updated;
    } else {
      const [inserted] = await tx
        .insert(staffAttendance)
        .values({
          staffId: input.staffProfileId,
          branchId,
          date: input.date,
          status: input.status,
          notes: input.notes ?? null,
          recordedBy: ctx.userId,
        })
        .returning({
          id: staffAttendance.id,
          date: staffAttendance.date,
          status: staffAttendance.status,
          notes: staffAttendance.notes,
        });
      row = inserted;
    }

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId,
      action: "hr.attendance.record",
      entityType: "staff_attendance",
      entityId: row.id,
      summary: `Attendance for staff ${input.staffProfileId} on ${input.date}: ${input.status}`,
    });
    return row;
  });
}

/** A staff member's recent attendance, newest first. */
export async function listAttendanceForStaff(
  db: DB,
  staffProfileId: string,
  ctx: AuthContext,
  limit = 60,
): Promise<AttendanceRow[]> {
  assertBranchAccess(ctx, await resolveStaffBranch(db, staffProfileId));
  return db
    .select({
      id: staffAttendance.id,
      date: staffAttendance.date,
      status: staffAttendance.status,
      notes: staffAttendance.notes,
    })
    .from(staffAttendance)
    .where(eq(staffAttendance.staffId, staffProfileId))
    .orderBy(desc(staffAttendance.date))
    .limit(limit);
}

/* ── Payroll ────────────────────────────────────────────────────── */
export interface PayrollRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  sessionsWorked: number | null;
  hoursWorked: string | null;
  hourlyRate: string | null;
  grossAmount: string;
  deductions: string;
  netAmount: string;
  currency: string;
  status: string;
  paidAt: Date | null;
}

const PAYROLL_COLS = {
  id: payrollRecords.id,
  periodStart: payrollRecords.periodStart,
  periodEnd: payrollRecords.periodEnd,
  sessionsWorked: payrollRecords.sessionsWorked,
  hoursWorked: payrollRecords.hoursWorked,
  hourlyRate: payrollRecords.hourlyRate,
  grossAmount: payrollRecords.grossAmount,
  deductions: payrollRecords.deductions,
  netAmount: payrollRecords.netAmount,
  currency: payrollRecords.currency,
  status: payrollRecords.status,
  paidAt: payrollRecords.paidAt,
};

/** Create a payroll record. netAmount is computed server-side (never trusted). */
export async function createPayroll(
  db: DB,
  input: CreatePayrollInput,
  ctx: AuthContext,
): Promise<PayrollRow> {
  return db.transaction(async (tx) => {
    const branchId = await resolveStaffBranch(tx, input.staffProfileId);
    assertBranchAccess(ctx, branchId);

    const gross = input.grossAmount;
    const deductions = input.deductions ?? 0;
    if (deductions > gross) {
      throw new ValidationError("Deductions exceed gross", {
        deductions: "must not exceed grossAmount",
      });
    }
    const net = gross - deductions;

    const [row] = await tx
      .insert(payrollRecords)
      .values({
        staffId: input.staffProfileId,
        branchId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        grossAmount: gross.toFixed(2),
        deductions: deductions.toFixed(2),
        netAmount: net.toFixed(2),
        currency: input.currency ?? "USD",
        notes: input.notes ?? null,
        createdBy: ctx.userId,
      })
      .returning(PAYROLL_COLS);

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId,
      action: "hr.payroll.create",
      entityType: "payroll_record",
      entityId: row.id,
      summary: `Payroll ${input.periodStart}…${input.periodEnd} for staff ${input.staffProfileId}: net ${net.toFixed(2)} ${input.currency ?? "USD"}`,
    });
    return row;
  });
}

/** Mark a payroll record paid (stamps paidAt). Branch-scoped + audited. */
export async function markPayrollPaid(
  db: DB,
  payrollId: string,
  ctx: AuthContext,
): Promise<PayrollRow> {
  return db.transaction(async (tx) => {
    const [scope] = await tx
      .select({ id: payrollRecords.id, branchId: payrollRecords.branchId, status: payrollRecords.status })
      .from(payrollRecords)
      .where(eq(payrollRecords.id, payrollId))
      .limit(1);
    if (!scope) {
      throw new ValidationError("Payroll record not found", { payrollId: "no such record" });
    }
    assertBranchAccess(ctx, scope.branchId);
    if (scope.status === "paid") {
      throw new ValidationError("Already paid", { payrollId: "record is already paid" });
    }

    const [row] = await tx
      .update(payrollRecords)
      .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
      .where(eq(payrollRecords.id, payrollId))
      .returning(PAYROLL_COLS);

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: scope.branchId,
      action: "hr.payroll.paid",
      entityType: "payroll_record",
      entityId: payrollId,
      summary: `Marked payroll ${payrollId} paid`,
    });
    return row;
  });
}

/** A staff member's payroll history, newest period first. */
export async function listPayrollForStaff(
  db: DB,
  staffProfileId: string,
  ctx: AuthContext,
): Promise<PayrollRow[]> {
  assertBranchAccess(ctx, await resolveStaffBranch(db, staffProfileId));
  return db
    .select(PAYROLL_COLS)
    .from(payrollRecords)
    .where(eq(payrollRecords.staffId, staffProfileId))
    .orderBy(desc(payrollRecords.periodStart));
}

/* ── Performance reviews ────────────────────────────────────────── */
export interface ReviewRow {
  id: string;
  reviewDate: string;
  rating: number;
  summary: string;
}

/** Create a performance review for a staff member. */
export async function createReview(
  db: DB,
  input: CreateReviewInput,
  ctx: AuthContext,
): Promise<ReviewRow> {
  return db.transaction(async (tx) => {
    const branchId = await resolveStaffBranch(tx, input.staffProfileId);
    assertBranchAccess(ctx, branchId);

    const [row] = await tx
      .insert(performanceReviews)
      .values({
        staffId: input.staffProfileId,
        branchId,
        reviewDate: input.reviewDate,
        rating: input.rating,
        summary: input.summary,
        reviewerId: ctx.userId,
      })
      .returning({
        id: performanceReviews.id,
        reviewDate: performanceReviews.reviewDate,
        rating: performanceReviews.rating,
        summary: performanceReviews.summary,
      });

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId,
      action: "hr.review.create",
      entityType: "performance_review",
      entityId: row.id,
      summary: `Performance review for staff ${input.staffProfileId} (${input.rating}/5) on ${input.reviewDate}`,
    });
    return row;
  });
}

/** A staff member's review history, newest first. */
export async function listReviewsForStaff(
  db: DB,
  staffProfileId: string,
  ctx: AuthContext,
): Promise<ReviewRow[]> {
  assertBranchAccess(ctx, await resolveStaffBranch(db, staffProfileId));
  return db
    .select({
      id: performanceReviews.id,
      reviewDate: performanceReviews.reviewDate,
      rating: performanceReviews.rating,
      summary: performanceReviews.summary,
    })
    .from(performanceReviews)
    .where(eq(performanceReviews.staffId, staffProfileId))
    .orderBy(desc(performanceReviews.reviewDate));
}

// Re-exported for tests that need the 403 type without importing lib/auth.
export { AuthError };

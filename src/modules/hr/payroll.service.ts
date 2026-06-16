/**
 * Module 2 — Automated Payroll engine.
 *
 * Ties scheduling → staff → pay: a tutor's pay for a period is derived from the
 * class sessions they were assigned to in that window (hours), times their
 * staff-profile hourly `base_rate`, minus a standard deduction percentage. The
 * bulk run writes one immutable ledger row per active staff member inside a
 * SINGLE transaction — if any row fails, the whole run rolls back (no partial
 * payroll). Money is fixed-precision numeric; net is computed server-side.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  staffProfiles,
  staffAssignments,
  classSessions,
  payrollRecords,
} from "../../db/schema";
import { ValidationError } from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

/** Standard deduction (taxes/benefits) applied to gross. Configurable here. */
export const DEDUCTION_RATE = 0.15;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PayrollCalculation {
  staffProfileId: string;
  sessionsWorked: number;
  hoursWorked: number;
  hourlyRate: number;
  gross: number;
  deductions: number;
  netPay: number;
}

/**
 * Compute (without writing) a staff member's pay for [periodStart, periodEnd).
 * Hours come from the duration of the class sessions on classes they're assigned
 * to whose start falls in the window. Pure read — safe to call standalone or
 * inside the run transaction (pass the tx as `db`).
 */
export async function calculatePayroll(
  db: Pick<DB, "select">,
  staffProfileId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PayrollCalculation> {
  const [staff] = await db
    .select({ id: staffProfiles.id, baseRate: staffProfiles.baseRate })
    .from(staffProfiles)
    .where(eq(staffProfiles.id, staffProfileId))
    .limit(1);
  if (!staff) {
    throw new ValidationError("Staff profile not found", {
      staffProfileId: "no such staff profile",
    });
  }

  // Sessions the tutor was assigned to that started within the period.
  const sessions = await db
    .select({ durationMinutes: classSessions.durationMinutes })
    .from(classSessions)
    .innerJoin(staffAssignments, eq(staffAssignments.classId, classSessions.classId))
    .where(
      and(
        eq(staffAssignments.staffId, staffProfileId),
        gte(classSessions.startsAt, new Date(periodStart)),
        lt(classSessions.startsAt, new Date(periodEnd)),
      ),
    );

  const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
  const hoursWorked = round2(totalMinutes / 60);
  const hourlyRate = Number(staff.baseRate);
  const gross = round2(hoursWorked * hourlyRate);
  const deductions = round2(gross * DEDUCTION_RATE);
  const netPay = round2(gross - deductions);

  return {
    staffProfileId,
    sessionsWorked: sessions.length,
    hoursWorked,
    hourlyRate,
    gross,
    deductions,
    netPay,
  };
}

export interface PayrollRunEntry extends PayrollCalculation {
  payrollId: string;
}
export interface PayrollRunResult {
  periodStart: string;
  periodEnd: string;
  created: number;
  skipped: number;
  totalNet: number;
  currency: string;
  entries: PayrollRunEntry[];
}

/**
 * Run payroll for EVERY active staff member in a branch for the period, in one
 * transaction. Staff who already have a ledger row for the exact period are
 * skipped (idempotent — a re-run won't double-pay). Any failure aborts the whole
 * run (no partial payroll). Branch-scoped + audited.
 */
export async function runPayroll(
  db: DB,
  branchId: string,
  periodStart: string,
  periodEnd: string,
  ctx: AuthContext,
  currency = "USD",
): Promise<PayrollRunResult> {
  assertBranchAccess(ctx, branchId);
  if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
    throw new ValidationError("Invalid period", { periodEnd: "must be after periodStart" });
  }

  return db.transaction(async (tx) => {
    const staff = await tx
      .select({ id: staffProfiles.id })
      .from(staffProfiles)
      .where(and(eq(staffProfiles.branchId, branchId), eq(staffProfiles.status, "active")));

    const entries: PayrollRunEntry[] = [];
    let created = 0;
    let skipped = 0;
    let totalNet = 0;

    for (const s of staff) {
      // Idempotency: one ledger row per (staff, exact period).
      const [dupe] = await tx
        .select({ id: payrollRecords.id })
        .from(payrollRecords)
        .where(
          and(
            eq(payrollRecords.staffId, s.id),
            eq(payrollRecords.periodStart, periodStart),
            eq(payrollRecords.periodEnd, periodEnd),
          ),
        )
        .limit(1);
      if (dupe) {
        skipped++;
        continue;
      }

      const calc = await calculatePayroll(tx, s.id, periodStart, periodEnd);

      const [row] = await tx
        .insert(payrollRecords)
        .values({
          staffId: s.id,
          branchId,
          periodStart,
          periodEnd,
          sessionsWorked: calc.sessionsWorked,
          hoursWorked: calc.hoursWorked.toFixed(2),
          hourlyRate: calc.hourlyRate.toFixed(2),
          grossAmount: calc.gross.toFixed(2),
          deductions: calc.deductions.toFixed(2),
          netAmount: calc.netPay.toFixed(2),
          currency,
          status: "pending",
          notes: `Auto payroll: ${calc.sessionsWorked} session(s), ${calc.hoursWorked}h × ${calc.hourlyRate} − ${DEDUCTION_RATE * 100}%`,
          createdBy: ctx.userId,
        })
        .returning({ id: payrollRecords.id });

      created++;
      totalNet = round2(totalNet + calc.netPay);
      entries.push({ ...calc, payrollId: row.id });
    }

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId,
      action: "hr.payroll.run",
      entityType: "branch",
      entityId: branchId,
      summary: `Payroll run ${periodStart}…${periodEnd}: ${created} created, ${skipped} skipped, net ${totalNet.toFixed(2)} ${currency}`,
      metadata: { periodStart, periodEnd, created, skipped, totalNet },
    });

    return { periodStart, periodEnd, created, skipped, totalNet, currency, entries };
  });
}

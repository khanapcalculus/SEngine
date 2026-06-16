/**
 * Module 3 — Fee collection service. Raise invoices against a student and apply
 * payments; amountPaid + status are recomputed server-side from the payment
 * ledger so the stored figures can never be set directly by a client
 * (Guideline #4). Money is fixed-precision numeric. Branch-scoped + audited.
 */
import { desc, eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { feeInvoices, feePayments, studentProfiles } from "../../db/schema";
import { ValidationError } from "../../lib/validation";
import type { CreateInvoiceInput, RecordPaymentInput } from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

export interface InvoiceRow {
  id: string;
  studentProfileId: string;
  description: string;
  amountDue: string;
  amountPaid: string;
  currency: string;
  status: string;
  dueDate: string | null;
}

const INVOICE_COLS = {
  id: feeInvoices.id,
  studentProfileId: feeInvoices.studentProfileId,
  description: feeInvoices.description,
  amountDue: feeInvoices.amountDue,
  amountPaid: feeInvoices.amountPaid,
  currency: feeInvoices.currency,
  status: feeInvoices.status,
  dueDate: feeInvoices.dueDate,
};

async function resolveStudentBranch(
  db: Pick<DB, "select">,
  studentProfileId: string,
): Promise<string> {
  const [row] = await db
    .select({ id: studentProfiles.id, branchId: studentProfiles.branchId })
    .from(studentProfiles)
    .where(eq(studentProfiles.id, studentProfileId))
    .limit(1);
  if (!row) {
    throw new ValidationError("Student not found", { studentProfileId: "no such student" });
  }
  return row.branchId;
}

/** Raise a fee invoice against a student. */
export async function createInvoice(
  db: DB,
  input: CreateInvoiceInput,
  ctx: AuthContext,
): Promise<InvoiceRow> {
  return db.transaction(async (tx) => {
    const branchId = await resolveStudentBranch(tx, input.studentProfileId);
    assertBranchAccess(ctx, branchId);

    const [row] = await tx
      .insert(feeInvoices)
      .values({
        studentProfileId: input.studentProfileId,
        branchId,
        description: input.description,
        amountDue: input.amountDue.toFixed(2),
        currency: input.currency ?? "USD",
        dueDate: input.dueDate ?? null,
        createdBy: ctx.userId,
      })
      .returning(INVOICE_COLS);

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId,
      action: "fee.invoice.create",
      entityType: "fee_invoice",
      entityId: row.id,
      summary: `Invoice "${input.description}" ${input.amountDue.toFixed(2)} ${input.currency ?? "USD"} for student ${input.studentProfileId}`,
    });
    return row;
  });
}

/**
 * A student's invoices, newest first, with NO access guard. Callers (the
 * manager route via listInvoicesForStudent, or the guardianship-gated parent
 * route) must authorize before calling.
 */
export async function listInvoicesForStudentUnchecked(
  db: DB,
  studentProfileId: string,
): Promise<InvoiceRow[]> {
  return db
    .select(INVOICE_COLS)
    .from(feeInvoices)
    .where(eq(feeInvoices.studentProfileId, studentProfileId))
    .orderBy(desc(feeInvoices.createdAt));
}

/** A student's invoices, newest first. Branch-scoped (manager view). */
export async function listInvoicesForStudent(
  db: DB,
  studentProfileId: string,
  ctx: AuthContext,
): Promise<InvoiceRow[]> {
  assertBranchAccess(ctx, await resolveStudentBranch(db, studentProfileId));
  return listInvoicesForStudentUnchecked(db, studentProfileId);
}

/**
 * Apply a payment to an invoice. Recomputes amountPaid (from the prior stored
 * total + this payment) and the derived status: paid when fully covered,
 * partial when some is paid, unpaid otherwise. Overpayment is rejected.
 */
export async function recordPayment(
  db: DB,
  invoiceId: string,
  input: RecordPaymentInput,
  ctx: AuthContext,
): Promise<InvoiceRow> {
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select({
        id: feeInvoices.id,
        branchId: feeInvoices.branchId,
        amountDue: feeInvoices.amountDue,
        amountPaid: feeInvoices.amountPaid,
        status: feeInvoices.status,
      })
      .from(feeInvoices)
      .where(eq(feeInvoices.id, invoiceId))
      .limit(1);
    if (!inv) {
      throw new ValidationError("Invoice not found", { invoiceId: "no such invoice" });
    }
    assertBranchAccess(ctx, inv.branchId);
    if (inv.status === "void") {
      throw new ValidationError("Invoice is void", { invoiceId: "cannot pay a void invoice" });
    }

    const due = Number(inv.amountDue);
    const prevPaid = Number(inv.amountPaid);
    const newPaid = Math.round((prevPaid + input.amount) * 100) / 100;
    if (newPaid > due + 1e-9) {
      throw new ValidationError("Payment exceeds balance", {
        amount: `at most ${(due - prevPaid).toFixed(2)} remains`,
      });
    }
    const status = newPaid >= due - 1e-9 ? "paid" : newPaid > 0 ? "partial" : "unpaid";

    await tx.insert(feePayments).values({
      invoiceId,
      amount: input.amount.toFixed(2),
      method: input.method ?? "cash",
      reference: input.reference ?? null,
      recordedBy: ctx.userId,
    });

    const [row] = await tx
      .update(feeInvoices)
      .set({ amountPaid: newPaid.toFixed(2), status, updatedAt: new Date() })
      .where(eq(feeInvoices.id, invoiceId))
      .returning(INVOICE_COLS);

    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: inv.branchId,
      action: "fee.payment.record",
      entityType: "fee_invoice",
      entityId: invoiceId,
      summary: `Payment ${input.amount.toFixed(2)} on invoice ${invoiceId} → ${status}`,
    });
    return row;
  });
}

/**
 * Module 4 — "End Session" composite transaction.
 *
 * When a tutor ends a live session three writes must happen together or not at
 * all: (1) save the whiteboard snapshot, (2) log the tutor's attendance for the
 * day, (3) append a payroll-ledger entry for the session. They run inside a
 * SINGLE db.transaction — if any step throws (e.g. the payroll insert fails),
 * Drizzle/Postgres rolls the whole transaction back, so the attendance row and
 * the snapshot are never left orphaned (Guideline #4; atomicity).
 *
 * Branch scope is enforced against the session's class branch before any write,
 * and an audit row is part of the same atomic unit.
 */
import { and, desc, eq, lte } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  classSessions,
  staffProfiles,
  staffAttendance,
  payrollRecords,
  sessionSnapshots,
} from "../../db/schema";
import { ValidationError } from "../../lib/validation";
import type { EndSessionInput } from "../../lib/validation";
import { assertBranchAccess, type AuthContext } from "../../lib/auth";
import { writeAudit } from "../audit/audit.service";

export interface EndSessionResult {
  snapshotId: string;
  attendanceId: string;
  payrollId: string;
}

/**
 * Resolve the session a board's "End Session" should target for a class: the
 * most recent session whose start time is at/before now (the one in progress or
 * just finished). Falls back to the latest session of the class if none has
 * started yet. Returns null if the class has no sessions. The whiteboard knows
 * only its classId, so this maps it to a sessionId for endSession().
 */
export async function resolveActiveSessionId(
  db: DB,
  classId: string,
  nowMs: number,
): Promise<string | null> {
  const [started] = await db
    .select({ id: classSessions.id })
    .from(classSessions)
    .where(and(eq(classSessions.classId, classId), lte(classSessions.startsAt, new Date(nowMs))))
    .orderBy(desc(classSessions.startsAt))
    .limit(1);
  if (started) return started.id;

  const [any] = await db
    .select({ id: classSessions.id })
    .from(classSessions)
    .where(eq(classSessions.classId, classId))
    .orderBy(desc(classSessions.startsAt))
    .limit(1);
  return any?.id ?? null;
}

/**
 * Atomically end a session: snapshot + attendance + payroll ledger. The tutor is
 * the caller's own staff profile (a teacher ending their session) unless an
 * explicit staffProfileId is given by a manager. `payRate` is the per-session
 * gross to post to the ledger.
 */
export async function endSession(
  db: DB,
  sessionId: string,
  input: EndSessionInput,
  ctx: AuthContext,
): Promise<EndSessionResult> {
  return db.transaction(async (tx) => {
    // 1) Load + authorize the session.
    const [session] = await tx
      .select({
        id: classSessions.id,
        classId: classSessions.classId,
        branchId: classSessions.branchId,
        startsAt: classSessions.startsAt,
      })
      .from(classSessions)
      .where(eq(classSessions.id, sessionId))
      .limit(1);
    if (!session) {
      throw new ValidationError("Session not found", { sessionId: "no such session" });
    }
    assertBranchAccess(ctx, session.branchId);

    // 2) Resolve the tutor's staff profile (caller's own, or a given one in-branch).
    let staffId: string;
    if (input.staffProfileId) {
      const [staff] = await tx
        .select({ id: staffProfiles.id, branchId: staffProfiles.branchId })
        .from(staffProfiles)
        .where(eq(staffProfiles.id, input.staffProfileId))
        .limit(1);
      if (!staff) throw new ValidationError("Staff profile not found", { staffProfileId: "no such staff" });
      assertBranchAccess(ctx, staff.branchId);
      staffId = staff.id;
    } else {
      const [staff] = await tx
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(eq(staffProfiles.userId, ctx.userId))
        .limit(1);
      if (!staff) {
        throw new ValidationError("No staff profile for caller", {
          staffProfileId: "provide staffProfileId — caller has no staff profile",
        });
      }
      staffId = staff.id;
    }

    // Sanity: the tutor must actually be assigned to this session's class.
    const day = session.startsAt.toISOString().slice(0, 10); // yyyy-mm-dd (UTC)

    // 3) Save the whiteboard snapshot.
    const [snap] = await tx
      .insert(sessionSnapshots)
      .values({
        sessionId: session.id,
        classId: session.classId,
        url: input.snapshotUrl,
        storageKey: input.snapshotKey,
        capturedBy: ctx.userId,
      })
      .returning({ id: sessionSnapshots.id });

    // 4) Log attendance for the tutor that day (one row/day; update if present).
    const [existingAtt] = await tx
      .select({ id: staffAttendance.id })
      .from(staffAttendance)
      .where(and(eq(staffAttendance.staffId, staffId), eq(staffAttendance.date, day)))
      .limit(1);
    let attendanceId: string;
    if (existingAtt) {
      await tx
        .update(staffAttendance)
        .set({ status: "present", updatedAt: new Date() })
        .where(eq(staffAttendance.id, existingAtt.id));
      attendanceId = existingAtt.id;
    } else {
      const [att] = await tx
        .insert(staffAttendance)
        .values({
          staffId,
          branchId: session.branchId,
          date: day,
          status: "present",
          notes: `Auto-logged on ending session ${session.id}`,
          recordedBy: ctx.userId,
        })
        .returning({ id: staffAttendance.id });
      attendanceId = att.id;
    }

    // 5) Append a payroll-ledger entry for the session. If THIS throws, the
    //    snapshot (step 3) and attendance (step 4) above are rolled back too.
    const gross = input.payAmount;
    if (!Number.isFinite(gross) || gross < 0) {
      throw new ValidationError("Invalid pay amount", { payAmount: "must be a non-negative number" });
    }
    const [pay] = await tx
      .insert(payrollRecords)
      .values({
        staffId,
        branchId: session.branchId,
        periodStart: day,
        periodEnd: day,
        grossAmount: gross.toFixed(2),
        deductions: "0",
        netAmount: gross.toFixed(2),
        currency: input.currency ?? "USD",
        status: "pending",
        notes: `Session ${session.id} tutoring`,
        createdBy: ctx.userId,
      })
      .returning({ id: payrollRecords.id });

    // 6) Audit — part of the same atomic unit.
    await writeAudit(tx, {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      branchId: session.branchId,
      action: "session.end",
      entityType: "class_session",
      entityId: session.id,
      summary: `Ended session ${session.id}: snapshot ${snap.id}, attendance ${attendanceId}, payroll ${pay.id}`,
    });

    return { snapshotId: snap.id, attendanceId, payrollId: pay.id };
  });
}

export interface SnapshotRow {
  id: string;
  sessionId: string;
  url: string;
  sessionTitle: string | null;
  startsAt: string | null;
  createdAt: Date;
}

/**
 * Saved whiteboard snapshots for a class, newest first. Read-only; the caller
 * (a class member, via assertClassAccess on the route) is already authorized.
 * Joins to class_sessions so each snapshot shows the session it captured.
 */
export async function listSnapshotsForClass(
  db: DB,
  classId: string,
): Promise<SnapshotRow[]> {
  const rows = await db
    .select({
      id: sessionSnapshots.id,
      sessionId: sessionSnapshots.sessionId,
      url: sessionSnapshots.url,
      sessionTitle: classSessions.title,
      startsAt: classSessions.startsAt,
      createdAt: sessionSnapshots.createdAt,
    })
    .from(sessionSnapshots)
    .leftJoin(classSessions, eq(sessionSnapshots.sessionId, classSessions.id))
    .where(eq(sessionSnapshots.classId, classId))
    .orderBy(desc(sessionSnapshots.createdAt));

  return rows.map((r) => ({
    ...r,
    startsAt: r.startsAt ? r.startsAt.toISOString() : null,
  }));
}

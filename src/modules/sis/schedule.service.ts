/**
 * Class scheduling service — create / list / delete the calendar sessions that
 * back the Schedule view. A session is one dated, timed meeting of a class; the
 * live whiteboard for that class is launched from it.
 *
 * branchId is resolved from the class (never trusted from the client) so a row
 * can only ever be filed under the class's real branch. createSession writes an
 * audit row atomically with the insert, mirroring class.service.ts.
 */
import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import type { DB } from "../../db/client";
import { classSessions, classes, staffAssignments, enrollments, studentProfiles } from "../../db/schema";
import type { CreateClassSessionInput } from "../../lib/validation";
import { ValidationError } from "../../lib/validation";
import { writeAudit } from "../audit/audit.service";

export interface SessionActor {
  userId: string;
  orgId: string | null;
}

export interface ClassSessionRow {
  id: string;
  classId: string;
  branchId: string;
  subject: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
}

/** Two half-open intervals [aStart,aEnd) and [bStart,bEnd) overlap. */
function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Guard against double-booking a tutor: a staff member assigned to this class
 * must not already have a session, on ANY class they're assigned to, whose time
 * window overlaps the new one. Runs inside the create transaction so the read
 * and the insert commit atomically. Throws ValidationError(409-style) on clash.
 *
 * (For 20-odd tutors and modest session counts an in-transaction check is clear
 * and sufficient; a Postgres exclusion constraint over (staff, tstzrange) would
 * be the lock-level upgrade if write contention ever demanded it.)
 */
async function assertNoTutorClash(
  tx: DB,
  classId: string,
  startMs: number,
  endMs: number,
): Promise<void> {
  // Tutors assigned to the class being scheduled.
  const tutors = await tx
    .select({ staffId: staffAssignments.staffId })
    .from(staffAssignments)
    .where(eq(staffAssignments.classId, classId));
  if (tutors.length === 0) return; // unstaffed class — nothing to clash with

  const staffIds = tutors.map((t) => t.staffId);

  // Every OTHER class any of those tutors is assigned to.
  const peerClassRows = await tx
    .select({ classId: staffAssignments.classId })
    .from(staffAssignments)
    .where(
      and(
        inArray(staffAssignments.staffId, staffIds),
        ne(staffAssignments.classId, classId),
      ),
    );
  const peerClassIds = Array.from(new Set(peerClassRows.map((r) => r.classId)));
  if (peerClassIds.length === 0) return;

  // Existing sessions on those classes that could overlap the new window.
  const candidates = await tx
    .select({
      startsAt: classSessions.startsAt,
      durationMinutes: classSessions.durationMinutes,
    })
    .from(classSessions)
    .where(inArray(classSessions.classId, peerClassIds));

  for (const c of candidates) {
    const s = c.startsAt.getTime();
    const e = s + c.durationMinutes * 60_000;
    if (intervalsOverlap(startMs, endMs, s, e)) {
      throw new ValidationError("Tutor is already booked at that time", {
        startsAt: "a tutor for this class has an overlapping session",
      });
    }
  }
}

/** Create a scheduled session for a class (+ audit). */
export async function createSession(
  db: DB,
  input: CreateClassSessionInput,
  actor: SessionActor,
): Promise<ClassSessionRow> {
  return db.transaction(async (tx) => {
    // Resolve branch from the class — the client never supplies branchId.
    const [klass] = await tx
      .select({ id: classes.id, branchId: classes.branchId, subject: classes.subject })
      .from(classes)
      .where(eq(classes.id, input.classId))
      .limit(1);
    if (!klass) {
      throw new ValidationError("Class not found", { classId: "no such class" });
    }

    // Double-booking prevention (tutor can't be in two classes at once).
    const startMs = new Date(input.startsAt).getTime();
    const endMs = startMs + input.durationMinutes * 60_000;
    await assertNoTutorClash(tx as unknown as DB, klass.id, startMs, endMs);

    const [row] = await tx
      .insert(classSessions)
      .values({
        classId: klass.id,
        branchId: klass.branchId,
        title: input.title,
        startsAt: new Date(input.startsAt),
        durationMinutes: input.durationMinutes,
        createdBy: actor.userId,
      })
      .returning({
        id: classSessions.id,
        classId: classSessions.classId,
        branchId: classSessions.branchId,
        title: classSessions.title,
        startsAt: classSessions.startsAt,
        durationMinutes: classSessions.durationMinutes,
      });

    await writeAudit(tx, {
      actorId: actor.userId,
      orgId: actor.orgId,
      branchId: klass.branchId,
      action: "schedule.create",
      entityType: "class_session",
      entityId: row.id,
      summary: `Scheduled "${input.title}" for ${klass.subject} at ${row.startsAt.toISOString()}`,
    });

    return {
      ...row,
      subject: klass.subject,
      startsAt: row.startsAt.toISOString(),
    };
  });
}

/**
 * List a branch's sessions in chronological order. `fromDate` (optional) trims
 * to sessions starting at/after a cutoff so the calendar can skip ancient rows.
 */
export async function listSessionsForBranch(
  db: DB,
  branchId: string,
  fromDate?: Date,
): Promise<ClassSessionRow[]> {
  const where = fromDate
    ? and(eq(classSessions.branchId, branchId), gte(classSessions.startsAt, fromDate))
    : eq(classSessions.branchId, branchId);

  const rows = await db
    .select({
      id: classSessions.id,
      classId: classSessions.classId,
      branchId: classSessions.branchId,
      subject: classes.subject,
      title: classSessions.title,
      startsAt: classSessions.startsAt,
      durationMinutes: classSessions.durationMinutes,
    })
    .from(classSessions)
    .innerJoin(classes, eq(classSessions.classId, classes.id))
    .where(where)
    .orderBy(asc(classSessions.startsAt));

  return rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString() }));
}

/** Resolve the branch a session belongs to (for scope checks), or null. */
export async function getSessionBranch(
  db: DB,
  sessionId: string,
): Promise<{ id: string; branchId: string } | null> {
  const [row] = await db
    .select({ id: classSessions.id, branchId: classSessions.branchId })
    .from(classSessions)
    .where(eq(classSessions.id, sessionId))
    .limit(1);
  return row ?? null;
}

/**
 * A student's upcoming sessions across the classes they're actively enrolled in,
 * resolved by their user id (self-service — never a client class/branch id). Used
 * by the student dashboard's time-gated "Join Class" widget. `fromMs` trims off
 * sessions that already finished; the live/upcoming decision is the UI's job.
 */
export async function listUpcomingSessionsForStudentUser(
  db: DB,
  userId: string,
  fromMs: number,
  limit = 20,
): Promise<ClassSessionRow[]> {
  // Sessions whose window could still be live or future: starts within the last
  // 6h (covers an in-progress long session) or any time after now.
  const cutoff = new Date(fromMs - 6 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: classSessions.id,
      classId: classSessions.classId,
      branchId: classSessions.branchId,
      subject: classes.subject,
      title: classSessions.title,
      startsAt: classSessions.startsAt,
      durationMinutes: classSessions.durationMinutes,
    })
    .from(classSessions)
    .innerJoin(classes, eq(classSessions.classId, classes.id))
    .innerJoin(enrollments, eq(enrollments.classId, classes.id))
    .innerJoin(studentProfiles, eq(enrollments.studentId, studentProfiles.id))
    .where(
      and(
        eq(studentProfiles.userId, userId),
        eq(enrollments.status, "enrolled"),
        gte(classSessions.startsAt, cutoff),
      ),
    )
    .orderBy(asc(classSessions.startsAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString() }));
}

/** Delete a scheduled session (+ audit). Caller must have asserted scope. */
export async function deleteSession(
  db: DB,
  sessionId: string,
  branchId: string,
  actor: SessionActor,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(classSessions).where(eq(classSessions.id, sessionId));
    await writeAudit(tx, {
      actorId: actor.userId,
      orgId: actor.orgId,
      branchId,
      action: "schedule.delete",
      entityType: "class_session",
      entityId: sessionId,
      summary: `Removed scheduled session ${sessionId}`,
    });
  });
}

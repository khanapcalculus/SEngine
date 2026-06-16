/**
 * Test for the student schedule query — listUpcomingSessionsForStudentUser only
 * returns sessions for classes the student is ACTIVELY enrolled in, and trims
 * sessions that finished well before now.
 *
 * Run: npx vitest run src/modules/sis/student_sessions.api.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name?: string }, val: unknown) => ({ __op: "eq", __col: col?.name, __val: val }),
    and: (...clauses: any[]) => ({ __and: clauses }),
    asc: (col: unknown) => col,
    gte: (col: { name?: string }, val: unknown) => ({ __op: "gte", __col: col?.name, __val: val }),
  };
});

import { listUpcomingSessionsForStudentUser } from "./schedule.service";

/**
 * The query is a 4-table join (class_sessions ⋈ classes ⋈ enrollments ⋈
 * student_profiles). We model it with a tiny join-aware fake that filters a
 * denormalized row set by the collected clauses.
 */
interface JoinRow {
  // class_sessions
  id: string;
  classId: string;
  branchId: string;
  startsAt: Date;
  durationMinutes: number;
  title: string;
  // classes
  subject: string;
  // enrollments
  enrollmentStatus: string;
  // student_profiles
  studentUserId: string;
}
let rows: JoinRow[];

function makeDb() {
  let clause: any = null;
  const run = () => {
    const flat: any[] = clause?.__and ?? [clause];
    const userId = flat.find((x) => x?.__col === "user_id")?.__val;
    const enrStatus = flat.find((x) => x?.__col === "status")?.__val;
    const cutoff = flat.find((x) => x?.__op === "gte")?.__val as Date;
    return rows
      .filter((r) =>
        r.studentUserId === userId &&
        r.enrollmentStatus === enrStatus &&
        r.startsAt.getTime() >= cutoff.getTime())
      .map((r) => ({
        id: r.id, classId: r.classId, branchId: r.branchId, subject: r.subject,
        title: r.title, startsAt: r.startsAt, durationMinutes: r.durationMinutes,
      }));
  };
  const chain: any = {
    innerJoin: () => chain,
    where: (c: any) => { clause = c; return chain; },
    orderBy: () => chain,
    limit: () => run(),
  };
  return { select: () => ({ from: () => chain }) } as any;
}

const NOW = new Date("2026-06-20T12:00:00.000Z").getTime();

beforeEach(() => {
  rows = [
    // enrolled, future → included
    { id: "s1", classId: "cA", branchId: "b", startsAt: new Date("2026-06-20T14:00:00Z"), durationMinutes: 60, title: "Future", subject: "Algebra", enrollmentStatus: "enrolled", studentUserId: "u1" },
    // enrolled, in progress (started 30m ago) → included (within 6h cutoff)
    { id: "s2", classId: "cA", branchId: "b", startsAt: new Date("2026-06-20T11:30:00Z"), durationMinutes: 60, title: "Live", subject: "Algebra", enrollmentStatus: "enrolled", studentUserId: "u1" },
    // enrolled but ancient (2 days ago) → excluded by cutoff
    { id: "s3", classId: "cA", branchId: "b", startsAt: new Date("2026-06-18T09:00:00Z"), durationMinutes: 60, title: "Old", subject: "Algebra", enrollmentStatus: "enrolled", studentUserId: "u1" },
    // a class the student withdrew from → excluded
    { id: "s4", classId: "cB", branchId: "b", startsAt: new Date("2026-06-20T15:00:00Z"), durationMinutes: 60, title: "Withdrawn", subject: "Chem", enrollmentStatus: "withdrawn", studentUserId: "u1" },
    // another student's session → excluded
    { id: "s5", classId: "cC", branchId: "b", startsAt: new Date("2026-06-20T16:00:00Z"), durationMinutes: 60, title: "Other", subject: "Bio", enrollmentStatus: "enrolled", studentUserId: "u2" },
  ];
});

describe("listUpcomingSessionsForStudentUser", () => {
  it("returns only enrolled, recent/upcoming sessions for the calling student", async () => {
    const out = await listUpcomingSessionsForStudentUser(makeDb(), "u1", NOW);
    const titles = out.map((s) => s.title).sort();
    expect(titles).toEqual(["Future", "Live"]);
    // ISO serialization for the wire.
    expect(typeof out[0].startsAt).toBe("string");
  });
});

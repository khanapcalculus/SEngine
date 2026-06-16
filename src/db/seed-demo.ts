/**
 * Demo seed — populates a complete, role-diverse pool of 24 test accounts so the
 * backend can be stress-tested (rosters, role filters, HR/SIS/admissions flows,
 * cross-module tracking). Idempotent: existing emails are skipped, so it is safe
 * to re-run.
 *
 *   Org:     Lincoln Community College  (branch: LCC Main)
 *   1  Super Admin    admin@network.com
 *   3  Tutors         teacher role + staff_profiles (Math / Business / Chemistry)
 *   10 Ops staff      staff_profiles by department (HR, Admissions, IT, …)
 *                     — Marcus (HR) is a branch_manager so manager-only screens
 *                       can be exercised with a non-super login; the rest are
 *                       teacher-role staff.
 *   10 Students       student role + student_profiles across cohorts 2026-2028
 *
 * All accounts share ONE password from DEMO_PASSWORD (default below) so you can
 * log in as any of them immediately. Passwords are PBKDF2-hashed via the SAME
 * lib/crypto path login uses, so they verify with zero drift.
 *
 * Run:
 *   # DATABASE_URL is read from the shell or .env.local (Vercel-pulled)
 *   export DEMO_PASSWORD="Demo!2026"        # optional; this is the default
 *   npx tsx src/db/seed-demo.ts
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import { readFileSync, existsSync } from "node:fs";
import ws from "ws";

/** Load KEY=VALUE pairs from .env.local without overriding the shell. */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(".env.local");

import {
  organizations,
  branches,
  users,
  staffProfiles,
  studentProfiles,
} from "./schema";
import { hashPassword } from "../lib/crypto";

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

type Role = "super_admin" | "branch_manager" | "teacher" | "student" | "parent";

interface StaffSpec { name: string; email: string; role: Role; department: string }
interface StudentSpec { name: string; email: string; cohortYear: number }

const TUTORS: StaffSpec[] = [
  { name: "Amjath", email: "amjath@lcc.com", role: "teacher", department: "Mathematics" },
  { name: "Omer", email: "omer@lcc.com", role: "teacher", department: "Business" },
  { name: "Sneha", email: "sneha@lcc.com", role: "teacher", department: "Chemistry" },
];

const OPS_STAFF: StaffSpec[] = [
  { name: "Marcus", email: "marcus@lcc.com", role: "branch_manager", department: "Human Resources" },
  { name: "Elena", email: "elena@lcc.com", role: "teacher", department: "Admissions" },
  { name: "David", email: "david@lcc.com", role: "teacher", department: "IT Support" },
  { name: "Sarah", email: "sarah@lcc.com", role: "teacher", department: "Counseling" },
  { name: "James", email: "james@lcc.com", role: "teacher", department: "Billing" },
  { name: "Priya", email: "priya@lcc.com", role: "teacher", department: "Curriculum" },
  { name: "Tom", email: "tom@lcc.com", role: "teacher", department: "Facilities" },
  { name: "Anita", email: "anita@lcc.com", role: "teacher", department: "Payroll" },
  { name: "Carlos", email: "carlos@lcc.com", role: "teacher", department: "Marketing" },
  { name: "Diana", email: "diana@lcc.com", role: "teacher", department: "Compliance" },
];

const STUDENTS: StudentSpec[] = [
  { name: "Raj", email: "raj@lcc.com", cohortYear: 2026 },
  { name: "Sovia", email: "sovia@lcc.com", cohortYear: 2026 },
  { name: "Leo", email: "leo@lcc.com", cohortYear: 2026 },
  { name: "Mia", email: "mia@lcc.com", cohortYear: 2027 },
  { name: "Ethan", email: "ethan@lcc.com", cohortYear: 2027 },
  { name: "Chloe", email: "chloe@lcc.com", cohortYear: 2027 },
  { name: "Noah", email: "noah@lcc.com", cohortYear: 2028 },
  { name: "Ava", email: "ava@lcc.com", cohortYear: 2028 },
  { name: "Liam", email: "liam@lcc.com", cohortYear: 2028 },
  { name: "Zoe", email: "zoe@lcc.com", cohortYear: 2026 },
];

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo!2026";
const SUPER_EMAIL = "admin@network.com";
const TODAY = new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, {
    schema: { organizations, branches, users, staffProfiles, studentProfiles },
  });

  try {
    console.log(`→ DB host: ${new URL(url).host}`);
  } catch { /* ignore */ }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  let created = 0, skipped = 0;

  try {
    // ── Org + branch (idempotent by name) ──────────────────────────────
    let [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
    if (!org) {
      [org] = await db
        .insert(organizations)
        .values({ name: "Lincoln Community College" })
        .returning({ id: organizations.id });
      console.log("✓ Created organization Lincoln Community College");
    }
    const orgId = org.id;

    let [branch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.orgId, orgId)).limit(1);
    if (!branch) {
      [branch] = await db
        .insert(branches)
        .values({ orgId, location: "LCC Main", status: "active" })
        .returning({ id: branches.id });
      console.log("✓ Created branch LCC Main");
    }
    const branchId = branch.id;

    /** Create a user if the email is free; returns the user id either way. */
    async function ensureUser(email: string, fullName: string, role: Role): Promise<string> {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing) { skipped++; return existing.id; }
      const [row] = await db
        .insert(users)
        .values({
          orgId: role === "super_admin" ? null : orgId,
          email, fullName, role, globalStatus: "active", passwordHash,
        })
        .returning({ id: users.id });
      created++;
      return row.id;
    }

    // ── Super Admin ────────────────────────────────────────────────────
    await ensureUser(SUPER_EMAIL, "Network Super Admin", "super_admin");

    // ── Staff (tutors + ops) → users + staff_profiles ──────────────────
    for (const s of [...TUTORS, ...OPS_STAFF]) {
      const userId = await ensureUser(s.email, s.name, s.role);
      const [hasProfile] = await db
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(eq(staffProfiles.userId, userId))
        .limit(1);
      if (!hasProfile) {
        await db.insert(staffProfiles).values({
          userId, branchId, department: s.department, status: "active", hireDate: TODAY,
        });
      }
    }

    // ── Students → users + student_profiles ────────────────────────────
    for (const st of STUDENTS) {
      const userId = await ensureUser(st.email, st.name, "student");
      const [hasProfile] = await db
        .select({ id: studentProfiles.id })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, userId))
        .limit(1);
      if (!hasProfile) {
        await db.insert(studentProfiles).values({
          userId, branchId, enrollmentDate: TODAY, cohortYear: st.cohortYear,
          status: "active", currentLevel: 1,
        });
      }
    }

    const total = 1 + TUTORS.length + OPS_STAFF.length + STUDENTS.length;
    console.log(`\n✓ Demo seed complete: ${created} created, ${skipped} already existed (${total} target accounts).`);
    console.log(`  Password for ALL demo accounts: ${DEMO_PASSWORD}`);
    console.log(`  Super admin: ${SUPER_EMAIL}`);
    console.log(`  Manager login (branch_manager): marcus@lcc.com`);
    console.log(`  Example tutor: amjath@lcc.com   Example student: raj@lcc.com`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("✗ Demo seed failed:", err);
  process.exit(1);
});

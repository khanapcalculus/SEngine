/**
 * Module 1: Identity & Multi-Tenant Routing — Core Schema
 * ---------------------------------------------------------
 * Drizzle / serverless-Postgres schema for the foundational tenant
 * entities: Organizations -> Branches -> Users -> Staff_Profiles.
 *
 * Design notes (per system_architecture.md):
 *  - UUID primary keys everywhere (defaultRandom) for global, collision-free
 *    IDs across edge regions.
 *  - Role + status are enforced as Postgres enums, not free text, so RBAC
 *    checks at the API layer can trust the data shape (Guideline #4).
 *  - Multi-tenancy: every tenant-owned row carries org_id (and branch_id where
 *    applicable). These columns are INDEXED because the hot path is
 *    "find all staff in branch X to route them to class rosters" — a 20+
 *    educator branch must resolve that join from an index, not a seq scan.
 *  - Schema only. No API routes or UI (Module 1 scope).
 */

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  date,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* ───────────────────────────── Enums ───────────────────────────── */

/** The five strictly-isolated RBAC roles from Module 1. */
export const userRoleEnum = pgEnum("user_role", [
  "super_admin", // Network owner — spans all orgs/branches
  "branch_manager", // Manages a single school branch
  "teacher", // Educator routed to class rosters
  "student",
  "parent",
]);

/** Global account lifecycle status (orthogonal to per-profile status). */
export const globalStatusEnum = pgEnum("global_status", [
  "active",
  "suspended",
  "archived",
]);

/** Operational status of a school branch. */
export const branchStatusEnum = pgEnum("branch_status", [
  "active",
  "inactive",
  "pending",
]);

/** Where a staff member sits in their employment lifecycle. */
export const staffStatusEnum = pgEnum("staff_status", [
  "onboarding",
  "active",
  "on_leave",
  "retired",
  "terminated",
]);

/** Student lifecycle status (per ERD: Active / Graduated / Dropped). */
export const studentStatusEnum = pgEnum("student_status", [
  "active",
  "graduated",
  "dropped",
]);

/** Lifecycle of a single class enrollment. */
export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "enrolled",
  "completed",
  "withdrawn",
]);

/** A staff member's role on a class roster (ERD: Staff_Assignments.Role). */
export const staffAssignmentRoleEnum = pgEnum("staff_assignment_role", [
  "lead", // primary educator of record for the section
  "assistant", // supporting educator / TA
]);

/** Outcome of a term-over-term progression decision (Module 3). */
export const promotionOutcomeEnum = pgEnum("student_promotion_outcome", [
  "promoted", // advanced to the next level
  "retained", // held at the same level
  "graduated", // completed the program
]);

/** Module 4 — publication lifecycle of a class assignment. */
export const assignmentStatusEnum = pgEnum("assignment_status", [
  "draft", // visible to staff only
  "published", // visible to enrolled students
  "closed", // no longer accepting submissions
]);

/** Module 4 — lifecycle of a student's submission to an assignment. */
export const submissionStatusEnum = pgEnum("submission_status", [
  "draft",
  "submitted",
  "graded",
]);

/** Module 2 — a staff member's attendance state for a given day. */
export const staffAttendanceStatusEnum = pgEnum("staff_attendance_status", [
  "present",
  "absent",
  "late",
  "on_leave",
  "remote",
]);

/** Module 2 — lifecycle of a payroll disbursement record. */
export const payrollStatusEnum = pgEnum("payroll_status", [
  "pending",
  "paid",
  "cancelled",
]);

/** Module 3 — admissions funnel stage of an application. */
export const applicationStatusEnum = pgEnum("application_status", [
  "submitted",
  "under_review",
  "accepted",
  "rejected",
  "enrolled",
]);

/** Module 3 — payment state of a fee invoice. */
export const feeInvoiceStatusEnum = pgEnum("fee_invoice_status", [
  "unpaid",
  "partial",
  "paid",
  "void",
]);

/* ─────────────────────────── Organizations ─────────────────────── */
/** Top of the tenant hierarchy: a network of schools (Super Admin scope). */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  /** Network-wide settings (locale, grading scale, feature flags). */
  globalSettings: jsonb("global_settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ───────────────────────────── Branches ────────────────────────── */
/** A single school branch within an organization. */
export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    location: varchar("location", { length: 512 }).notNull(),
    status: branchStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Tenant-scoping index: list every branch in an org.
    orgIdx: index("branches_org_id_idx").on(t.orgId),
  }),
);

/* ────────────────────────────── Users ──────────────────────────── */
/**
 * Identity record. orgId scopes the user to a tenant (Super Admins may have a
 * null orgId since they span the whole network). Auth credentials live with the
 * auth provider; we store the role + global status that RBAC keys off of.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    email: varchar("email", { length: 320 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    /**
     * Self-describing PBKDF2 hash (`pbkdf2$iters$salt$hash`). NEVER plaintext.
     * Nullable so SSO-only / not-yet-activated accounts can exist without a
     * local password.
     */
    passwordHash: varchar("password_hash", { length: 255 }),
    role: userRoleEnum("role").notNull(),
    globalStatus: globalStatusEnum("global_status")
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Email is globally unique across the platform.
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    // RBAC + tenant filters: "all teachers in org X".
    orgRoleIdx: index("users_org_role_idx").on(t.orgId, t.role),
  }),
);

/* ────────────────────────── Staff Profiles ─────────────────────── */
/**
 * Employment record for a user with a staff role (teacher / branch_manager).
 * branchId is the routing pivot: assigning 20+ educators to student rosters
 * starts with "who works at this branch", so (branchId, department) is indexed.
 */
export const staffProfiles = pgTable(
  "staff_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    department: varchar("department", { length: 128 }).notNull(),
    employeeNumber: varchar("employee_number", { length: 64 }),
    status: staffStatusEnum("status").notNull().default("onboarding"),
    hireDate: date("hire_date").notNull(),
    retirementDate: date("retirement_date"), // null until offboarded
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // One employment profile per user.
    userUq: uniqueIndex("staff_profiles_user_id_idx").on(t.userId),
    // The routing hot-path: educators of a department within a branch.
    branchDeptIdx: index("staff_profiles_branch_dept_idx").on(
      t.branchId,
      t.department,
    ),
    // Filter active vs retired staff quickly within a branch.
    branchStatusIdx: index("staff_profiles_branch_status_idx").on(
      t.branchId,
      t.status,
    ),
  }),
);

/* ────────────────────────── Student Profiles ───────────────────── */
/**
 * Module 3 — SIS. Academic record for a user with the `student` role.
 * Mirrors staff_profiles: one row per user, scoped to a branch for the
 * admissions/progression hot paths.
 */
export const studentProfiles = pgTable(
  "student_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    enrollmentDate: date("enrollment_date").notNull(),
    cohortYear: integer("cohort_year").notNull(),
    status: studentStatusEnum("status").notNull().default("active"),
    /** Current year/grade level; incremented by a "promoted" progression. */
    currentLevel: integer("current_level").notNull().default(1),
    graduationDate: date("graduation_date"), // null until graduated
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userUq: uniqueIndex("student_profiles_user_id_idx").on(t.userId),
    // Roster building / cohort reporting within a branch.
    branchCohortIdx: index("student_profiles_branch_cohort_idx").on(
      t.branchId,
      t.cohortYear,
    ),
    branchStatusIdx: index("student_profiles_branch_status_idx").on(
      t.branchId,
      t.status,
    ),
  }),
);

/* ─────────────────────────────── Classes ───────────────────────── */
/** A course section offered at a branch for a given term. */
export const classes = pgTable(
  "classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    subject: varchar("subject", { length: 255 }).notNull(),
    term: varchar("term", { length: 64 }).notNull(),
    /** Credit-hours this section is worth; weights the transcript GPA. */
    credits: integer("credits").notNull().default(3),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    branchTermIdx: index("classes_branch_term_idx").on(t.branchId, t.term),
  }),
);

/* ─────────────────────────── Class Sessions ────────────────────── */
/**
 * A scheduled meeting of a class — the calendar entry behind the Schedule view.
 * Each row is a single dated/timed session for a class (the live whiteboard for
 * that class is opened from it). branchId is denormalized from the class so the
 * Schedule page can list "every session at this branch" from one index without
 * a join, mirroring how assignments index by (class, due).
 */
export const classSessions = pgTable(
  "class_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    /** Denormalized from the class for branch-scoped calendar queries. */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    /** When the session starts and how long it runs (end derived in the UI). */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Calendar hot-path: a branch's sessions in chronological order.
    branchStartsIdx: index("class_sessions_branch_starts_idx").on(
      t.branchId,
      t.startsAt,
    ),
    // "When does this class meet?" per-class lookup.
    classStartsIdx: index("class_sessions_class_starts_idx").on(
      t.classId,
      t.startsAt,
    ),
  }),
);

/* ────────────────────────── Session Snapshots ──────────────────── */
/**
 * A saved whiteboard snapshot captured when a tutor ends a live session. Bytes
 * (the canvas image / serialized ops) live in object storage; we keep the url +
 * key. Written ATOMICALLY with the attendance + payroll writes of the
 * end-session transaction — if any of those fail, this row never persists.
 */
export const sessionSnapshots = pgTable(
  "session_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    storageKey: varchar("storage_key", { length: 1024 }).notNull(),
    capturedBy: uuid("captured_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionIdx: index("session_snapshots_session_idx").on(t.sessionId),
  }),
);

/* ──────────────────────────── Enrollments ──────────────────────── */
/**
 * Join of a student to a class. A student may take many classes; a class has
 * many students — but only ONCE each, enforced by a unique (student, class).
 */
export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    status: enrollmentStatusEnum("status").notNull().default("enrolled"),
    finalGrade: varchar("final_grade", { length: 8 }), // null until graded
    enrolledAt: timestamp("enrolled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A student cannot be enrolled in the same class twice.
    studentClassUq: uniqueIndex("enrollments_student_class_idx").on(
      t.studentId,
      t.classId,
    ),
    // "Who is in this class?" roster lookup.
    classIdx: index("enrollments_class_id_idx").on(t.classId),
  }),
);

/* ──────────────────────────── Guardianships ────────────────────── */
/**
 * Links a parent/guardian User to a Student_Profile they may view (the Parent
 * portal reads through this). A parent may have many children; a student may
 * have many guardians — but each pairing exists at most ONCE. This is the only
 * thing that lets the `parent` role see any student data, and every parent read
 * path is gated by a row here (Guideline #4).
 */
export const guardianships = pgTable(
  "guardianships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentUserId: uuid("parent_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentProfileId: uuid("student_profile_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "cascade" }),
    /** e.g. mother / father / guardian. */
    relationship: varchar("relationship", { length: 64 })
      .notNull()
      .default("guardian"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A given parent is linked to a given student at most once.
    parentStudentUq: uniqueIndex("guardianships_parent_student_idx").on(
      t.parentUserId,
      t.studentProfileId,
    ),
    // "Who are this parent's children?" — the portal hot path.
    parentIdx: index("guardianships_parent_idx").on(t.parentUserId),
    // "Who are this student's guardians?"
    studentIdx: index("guardianships_student_idx").on(t.studentProfileId),
  }),
);

/* ──────────────────────── Admission Applications ────────────────── */
/**
 * Module 3 — the admissions funnel. A prospective student's application to a
 * branch, moving submitted → under_review → accepted/rejected, and finally
 * `enrolled` once converted into a real Student_Profile (studentProfileId is set
 * at that point, linking the funnel to the created record). examScore is an
 * optional entrance-exam capture.
 */
export const admissionApplications = pgTable(
  "admission_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    applicantName: varchar("applicant_name", { length: 255 }).notNull(),
    applicantEmail: varchar("applicant_email", { length: 320 }).notNull(),
    cohortYear: integer("cohort_year").notNull(),
    status: applicationStatusEnum("status").notNull().default("submitted"),
    examScore: integer("exam_score"), // optional entrance-exam result
    notes: text("notes"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The Student_Profile created when this application was enrolled (if any). */
    studentProfileId: uuid("student_profile_id").references(
      () => studentProfiles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // The admissions board: a branch's applications by stage.
    branchStatusIdx: index("admission_applications_branch_status_idx").on(
      t.branchId,
      t.status,
    ),
  }),
);

/* ────────────────────────────── Fee Invoices ───────────────────── */
/**
 * Module 3 — fee collection. A charge raised against a student. amountPaid +
 * status are maintained server-side as payments land (never trusted from a
 * client); money is fixed-precision numeric.
 */
export const feeInvoices = pgTable(
  "fee_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentProfileId: uuid("student_profile_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    description: varchar("description", { length: 255 }).notNull(),
    amountDue: numeric("amount_due", { precision: 12, scale: 2 }).notNull(),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    status: feeInvoiceStatusEnum("status").notNull().default("unpaid"),
    dueDate: date("due_date"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    studentIdx: index("fee_invoices_student_idx").on(t.studentProfileId),
    branchStatusIdx: index("fee_invoices_branch_status_idx").on(
      t.branchId,
      t.status,
    ),
  }),
);

/* ────────────────────────────── Fee Payments ───────────────────── */
/** A payment applied to a fee invoice (append-only ledger). */
export const feePayments = pgTable(
  "fee_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => feeInvoices.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    method: varchar("method", { length: 32 }).notNull().default("cash"),
    reference: varchar("reference", { length: 128 }),
    recordedBy: uuid("recorded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    invoiceIdx: index("fee_payments_invoice_idx").on(t.invoiceId),
  }),
);

/* ────────────────────────────── Credentials ────────────────────── */
/**
 * Module 3 — Graduation & Alumni. A degree/diploma issued to a graduated
 * student. Each carries a unique, hard-to-guess `serial` that anyone can check
 * via the public verification endpoint (credential verification), without
 * exposing the rest of the student record.
 */
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentProfileId: uuid("student_profile_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    program: varchar("program", { length: 255 }),
    /** Public verification code (unique). */
    serial: varchar("serial", { length: 40 }).notNull(),
    gpa: numeric("gpa", { precision: 4, scale: 2 }),
    issuedDate: date("issued_date").notNull(),
    issuedBy: uuid("issued_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    serialUq: uniqueIndex("credentials_serial_idx").on(t.serial),
    studentIdx: index("credentials_student_idx").on(t.studentProfileId),
    branchIdx: index("credentials_branch_idx").on(t.branchId),
  }),
);

/* ───────────────────────── Staff Assignments ───────────────────── */
/**
 * Module 2 — Assignment Routing. Join of a staff member to a class they work,
 * with a role (lead / assistant). Mirrors enrollments: a staff member may work
 * many classes; a class has many staff — but each pairing exists at most ONCE,
 * enforced by a unique (staff, class).
 */
export const staffAssignments = pgTable(
  "staff_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    role: staffAssignmentRoleEnum("role").notNull().default("lead"),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A staff member is assigned to a given class at most once.
    staffClassUq: uniqueIndex("staff_assignments_staff_class_idx").on(
      t.staffId,
      t.classId,
    ),
    // "Who staffs this class?" roster lookup.
    classIdx: index("staff_assignments_class_id_idx").on(t.classId),
    // "What does this educator work?" — the reverse routing lookup.
    staffIdx: index("staff_assignments_staff_id_idx").on(t.staffId),
  }),
);

/* ─────────────────────────── Staff Attendance ──────────────────── */
/**
 * Module 2 — HR Operations. One row per staff member per day recording their
 * attendance state. branchId is denormalized from the staff profile so a branch
 * manager can pull "today's attendance for my branch" from one index; the unique
 * (staff, date) keeps a single authoritative record per day (re-recording
 * updates it).
 */
export const staffAttendance = pgTable(
  "staff_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: staffAttendanceStatusEnum("status").notNull().default("present"),
    notes: text("notes"),
    recordedBy: uuid("recorded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // One attendance record per staff member per day.
    staffDateUq: uniqueIndex("staff_attendance_staff_date_idx").on(
      t.staffId,
      t.date,
    ),
    // Branch-wide daily roll-call.
    branchDateIdx: index("staff_attendance_branch_date_idx").on(
      t.branchId,
      t.date,
    ),
  }),
);

/* ─────────────────────────── Payroll Records ───────────────────── */
/**
 * Module 2 — HR Operations. A disbursement record for a staff member over a pay
 * period. Money is stored as fixed-precision numeric (never float); netAmount is
 * computed server-side as gross − deductions so the stored figure can't drift
 * from a client-supplied value.
 */
export const payrollRecords = pgTable(
  "payroll_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    grossAmount: numeric("gross_amount", { precision: 12, scale: 2 }).notNull(),
    deductions: numeric("deductions", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    netAmount: numeric("net_amount", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    status: payrollStatusEnum("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A staff member's disbursement history, newest period first.
    staffPeriodIdx: index("payroll_records_staff_period_idx").on(
      t.staffId,
      t.periodStart,
    ),
    // "What's outstanding/paid at this branch?"
    branchStatusIdx: index("payroll_records_branch_status_idx").on(
      t.branchId,
      t.status,
    ),
  }),
);

/* ──────────────────────── Performance Reviews ──────────────────── */
/**
 * Module 2 — HR Operations. A periodic evaluation of a staff member (1–5 rating
 * + narrative), attributed to the reviewing user. Append-only in spirit, like
 * promotions: each review is a point-in-time snapshot the staff record reads.
 */
export const performanceReviews = pgTable(
  "performance_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    reviewDate: date("review_date").notNull(),
    /** 1 (needs improvement) … 5 (outstanding). */
    rating: integer("rating").notNull(),
    summary: text("summary").notNull(),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A staff member's review history.
    staffDateIdx: index("performance_reviews_staff_date_idx").on(
      t.staffId,
      t.reviewDate,
    ),
  }),
);

/* ─────────────────────────── Staff Documents ───────────────────── */
/**
 * Module 2 — HR onboarding documents (contracts, IDs, certificates). The bytes
 * live in object storage (Vercel Blob); we store only the access url + provider
 * key, never blobs — mirroring submission_files.
 */
export const staffDocuments = pgTable(
  "staff_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 64 }).notNull().default("other"),
    fileName: varchar("file_name", { length: 512 }).notNull(),
    contentType: varchar("content_type", { length: 128 }),
    sizeBytes: integer("size_bytes"),
    storageProvider: varchar("storage_provider", { length: 32 })
      .notNull()
      .default("vercel_blob"),
    storageKey: varchar("storage_key", { length: 1024 }).notNull(),
    url: text("url").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    staffIdx: index("staff_documents_staff_idx").on(t.staffId),
  }),
);

/* ─────────────────────────── Student Promotions ────────────────── */
/**
 * Module 3 — Academic Progression. Append-only history of term-over-term
 * progression decisions for a student. One row per evaluated term, capturing
 * the level transition, the term GPA snapshot, and the outcome. Like audit
 * logs, rows are written once and only ever read — the transcript reads these.
 */
export const studentPromotions = pgTable(
  "student_promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "cascade" }),
    term: varchar("term", { length: 64 }).notNull(),
    fromLevel: integer("from_level").notNull(),
    toLevel: integer("to_level").notNull(),
    /** Credit-weighted GPA for the term, snapshotted at decision time. */
    termGpa: numeric("term_gpa", { precision: 4, scale: 2 }),
    outcome: promotionOutcomeEnum("outcome").notNull(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Newest-first progression history per student (the transcript view).
    studentCreatedIdx: index("student_promotions_student_created_idx").on(
      t.studentId,
      t.createdAt,
    ),
  }),
);

/* ─────────────────────────── Assignments (M4) ──────────────────── */
/** A piece of gradeable work set for a class (Module 4 — Advanced LMS). */
export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    maxPoints: integer("max_points").notNull().default(100),
    status: assignmentStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    classStatusIdx: index("assignments_class_status_idx").on(
      t.classId,
      t.status,
    ),
    classDueIdx: index("assignments_class_due_idx").on(t.classId, t.dueDate),
  }),
);

/* ─────────────────────────── Submissions (M4) ──────────────────── */
/** A student's submission to an assignment. One per (assignment, student). */
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "cascade" }),
    status: submissionStatusEnum("status").notNull().default("submitted"),
    pointsAwarded: integer("points_awarded"), // null until graded
    feedback: text("feedback"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    gradedBy: uuid("graded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A student submits to a given assignment at most once.
    assignmentStudentUq: uniqueIndex("submissions_assignment_student_idx").on(
      t.assignmentId,
      t.studentId,
    ),
    assignmentIdx: index("submissions_assignment_id_idx").on(t.assignmentId),
  }),
);

/* ──────────────────────── Submission Files (M4) ────────────────── */
/**
 * Metadata for a file attached to a submission. The bytes live in object
 * storage (Vercel Blob); we store the access url + provider key, never blobs.
 */
export const submissionFiles = pgTable(
  "submission_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 512 }).notNull(),
    contentType: varchar("content_type", { length: 128 }),
    sizeBytes: integer("size_bytes"),
    storageProvider: varchar("storage_provider", { length: 32 })
      .notNull()
      .default("vercel_blob"),
    storageKey: varchar("storage_key", { length: 1024 }).notNull(),
    url: text("url").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    submissionIdx: index("submission_files_submission_id_idx").on(
      t.submissionId,
    ),
  }),
);

/* ────────────────────── Discussion Threads (M4) ────────────────── */
/** A discussion thread scoped to a class, optionally tied to an assignment. */
export const discussionThreads = pgTable(
  "discussion_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, {
      onDelete: "set null",
    }), // nullable: general class discussion vs assignment Q&A
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    classCreatedIdx: index("discussion_threads_class_created_idx").on(
      t.classId,
      t.createdAt,
    ),
  }),
);

/* ─────────────────────── Discussion Posts (M4) ─────────────────── */
/** A post within a thread. parentPostId enables threaded replies (adjacency list). */
export const discussionPosts = pgTable(
  "discussion_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => discussionThreads.id, { onDelete: "cascade" }),
    parentPostId: uuid("parent_post_id").references(
      (): AnyPgColumn => discussionPosts.id,
      { onDelete: "set null" },
    ), // self-ref; null = top-level post
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    threadCreatedIdx: index("discussion_posts_thread_created_idx").on(
      t.threadId,
      t.createdAt,
    ),
    parentIdx: index("discussion_posts_parent_idx").on(t.parentPostId),
  }),
);

/* ──────────────────────────── Audit Logs ───────────────────────── */
/**
 * Module 1 — immutable audit trail. Append-only record of state changes
 * (staff onboarding, enrollment, class assignment, etc.). No update/delete
 * paths exist in the app: rows are written once and only ever read.
 *
 * actorId is the authenticated user who performed the action (nullable so the
 * log survives if that user is later deleted). action is a dotted verb like
 * "staff.onboard"; entityType/entityId point at the affected row.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    orgId: uuid("org_id"),
    branchId: uuid("branch_id"),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: uuid("entity_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Newest-first feed per branch (the dashboard view).
    branchCreatedIdx: index("audit_logs_branch_created_idx").on(
      t.branchId,
      t.createdAt,
    ),
    actorIdx: index("audit_logs_actor_idx").on(t.actorId),
  }),
);

/* ──────────────────────────── Relations ────────────────────────── */
/** Drizzle relational query graph (enables db.query.* eager loading). */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  branches: many(branches),
  users: many(users),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [branches.orgId],
    references: [organizations.id],
  }),
  staff: many(staffProfiles),
  students: many(studentProfiles),
  classes: many(classes),
}));

export const studentProfilesRelations = relations(
  studentProfiles,
  ({ one, many }) => ({
    user: one(users, {
      fields: [studentProfiles.userId],
      references: [users.id],
    }),
    branch: one(branches, {
      fields: [studentProfiles.branchId],
      references: [branches.id],
    }),
    enrollments: many(enrollments),
    promotions: many(studentPromotions),
    guardianships: many(guardianships),
    invoices: many(feeInvoices),
    credentials: many(credentials),
  }),
);

export const credentialsRelations = relations(credentials, ({ one }) => ({
  student: one(studentProfiles, {
    fields: [credentials.studentProfileId],
    references: [studentProfiles.id],
  }),
  branch: one(branches, {
    fields: [credentials.branchId],
    references: [branches.id],
  }),
}));

export const guardianshipsRelations = relations(guardianships, ({ one }) => ({
  parent: one(users, {
    fields: [guardianships.parentUserId],
    references: [users.id],
  }),
  student: one(studentProfiles, {
    fields: [guardianships.studentProfileId],
    references: [studentProfiles.id],
  }),
}));

export const admissionApplicationsRelations = relations(
  admissionApplications,
  ({ one }) => ({
    branch: one(branches, {
      fields: [admissionApplications.branchId],
      references: [branches.id],
    }),
    student: one(studentProfiles, {
      fields: [admissionApplications.studentProfileId],
      references: [studentProfiles.id],
    }),
  }),
);

export const feeInvoicesRelations = relations(feeInvoices, ({ one, many }) => ({
  student: one(studentProfiles, {
    fields: [feeInvoices.studentProfileId],
    references: [studentProfiles.id],
  }),
  branch: one(branches, {
    fields: [feeInvoices.branchId],
    references: [branches.id],
  }),
  payments: many(feePayments),
}));

export const feePaymentsRelations = relations(feePayments, ({ one }) => ({
  invoice: one(feeInvoices, {
    fields: [feePayments.invoiceId],
    references: [feeInvoices.id],
  }),
}));

export const studentPromotionsRelations = relations(
  studentPromotions,
  ({ one }) => ({
    student: one(studentProfiles, {
      fields: [studentPromotions.studentId],
      references: [studentProfiles.id],
    }),
  }),
);

export const classesRelations = relations(classes, ({ one, many }) => ({
  branch: one(branches, {
    fields: [classes.branchId],
    references: [branches.id],
  }),
  enrollments: many(enrollments),
  staffAssignments: many(staffAssignments),
  assignments: many(assignments),
  discussionThreads: many(discussionThreads),
  sessions: many(classSessions),
}));

export const classSessionsRelations = relations(classSessions, ({ one }) => ({
  class: one(classes, {
    fields: [classSessions.classId],
    references: [classes.id],
  }),
  branch: one(branches, {
    fields: [classSessions.branchId],
    references: [branches.id],
  }),
}));

export const assignmentsRelations = relations(
  assignments,
  ({ one, many }) => ({
    class: one(classes, {
      fields: [assignments.classId],
      references: [classes.id],
    }),
    submissions: many(submissions),
  }),
);

export const submissionsRelations = relations(
  submissions,
  ({ one, many }) => ({
    assignment: one(assignments, {
      fields: [submissions.assignmentId],
      references: [assignments.id],
    }),
    student: one(studentProfiles, {
      fields: [submissions.studentId],
      references: [studentProfiles.id],
    }),
    files: many(submissionFiles),
  }),
);

export const submissionFilesRelations = relations(
  submissionFiles,
  ({ one }) => ({
    submission: one(submissions, {
      fields: [submissionFiles.submissionId],
      references: [submissions.id],
    }),
  }),
);

export const discussionThreadsRelations = relations(
  discussionThreads,
  ({ one, many }) => ({
    class: one(classes, {
      fields: [discussionThreads.classId],
      references: [classes.id],
    }),
    posts: many(discussionPosts),
  }),
);

export const discussionPostsRelations = relations(
  discussionPosts,
  ({ one }) => ({
    thread: one(discussionThreads, {
      fields: [discussionPosts.threadId],
      references: [discussionThreads.id],
    }),
  }),
);

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(studentProfiles, {
    fields: [enrollments.studentId],
    references: [studentProfiles.id],
  }),
  class: one(classes, {
    fields: [enrollments.classId],
    references: [classes.id],
  }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.orgId],
    references: [organizations.id],
  }),
  staffProfile: one(staffProfiles, {
    fields: [users.id],
    references: [staffProfiles.userId],
  }),
}));

export const staffProfilesRelations = relations(
  staffProfiles,
  ({ one, many }) => ({
    user: one(users, {
      fields: [staffProfiles.userId],
      references: [users.id],
    }),
    branch: one(branches, {
      fields: [staffProfiles.branchId],
      references: [branches.id],
    }),
    assignments: many(staffAssignments),
    attendance: many(staffAttendance),
    payroll: many(payrollRecords),
    reviews: many(performanceReviews),
    documents: many(staffDocuments),
  }),
);

export const staffDocumentsRelations = relations(staffDocuments, ({ one }) => ({
  staff: one(staffProfiles, {
    fields: [staffDocuments.staffId],
    references: [staffProfiles.id],
  }),
}));

export const staffAttendanceRelations = relations(staffAttendance, ({ one }) => ({
  staff: one(staffProfiles, {
    fields: [staffAttendance.staffId],
    references: [staffProfiles.id],
  }),
}));

export const payrollRecordsRelations = relations(payrollRecords, ({ one }) => ({
  staff: one(staffProfiles, {
    fields: [payrollRecords.staffId],
    references: [staffProfiles.id],
  }),
}));

export const performanceReviewsRelations = relations(
  performanceReviews,
  ({ one }) => ({
    staff: one(staffProfiles, {
      fields: [performanceReviews.staffId],
      references: [staffProfiles.id],
    }),
  }),
);

export const staffAssignmentsRelations = relations(
  staffAssignments,
  ({ one }) => ({
    staff: one(staffProfiles, {
      fields: [staffAssignments.staffId],
      references: [staffProfiles.id],
    }),
    class: one(classes, {
      fields: [staffAssignments.classId],
      references: [classes.id],
    }),
  }),
);

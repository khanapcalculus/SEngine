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
  }),
);

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
}));

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

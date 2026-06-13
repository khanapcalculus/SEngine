/**
 * Hand-rolled validation for request bodies (Guideline #4: never trust client
 * data). Kept dependency-free and stateless for edge compatibility; swap for
 * zod later if desired without changing the route contracts.
 */

import { isValidGrade, VALID_GRADES } from "../modules/sis/grading";

export class ValidationError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Canonical 8-4-4-4-12 hex shape. We intentionally do NOT enforce the
// version/variant nibbles — the Postgres `uuid` type is the real gate, and a
// stricter regex risks rejecting legitimate identifiers for no added safety.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export interface OnboardStaffInput {
  email: string;
  fullName: string;
  branchId: string;
  orgId: string;
  department: string;
  hireDate: string; // ISO yyyy-mm-dd
  employeeNumber?: string;
}

/**
 * Validate + normalize the POST /api/staff/onboard body.
 * Returns a typed, trusted object or throws ValidationError(400).
 */
export function parseOnboardStaff(body: unknown): OnboardStaffInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!EMAIL_RE.test(email)) fields.email = "valid email required";

  const fullName = typeof b.fullName === "string" ? b.fullName.trim() : "";
  if (fullName.length < 1 || fullName.length > 255)
    fields.fullName = "fullName required (1-255 chars)";

  if (!isUuid(b.branchId)) fields.branchId = "branchId must be a UUID";
  if (!isUuid(b.orgId)) fields.orgId = "orgId must be a UUID";

  const department =
    typeof b.department === "string" ? b.department.trim() : "";
  if (department.length < 1 || department.length > 128)
    fields.department = "department required (1-128 chars)";

  const hireDate = typeof b.hireDate === "string" ? b.hireDate : "";
  if (!ISO_DATE_RE.test(hireDate) || Number.isNaN(Date.parse(hireDate)))
    fields.hireDate = "hireDate must be ISO yyyy-mm-dd";

  let employeeNumber: string | undefined;
  if (b.employeeNumber !== undefined) {
    if (typeof b.employeeNumber !== "string" || b.employeeNumber.length > 64)
      fields.employeeNumber = "employeeNumber must be a string (<=64 chars)";
    else employeeNumber = b.employeeNumber;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    email,
    fullName,
    branchId: b.branchId as string,
    orgId: b.orgId as string,
    department,
    hireDate,
    employeeNumber,
  };
}

export interface EnrollStudentInput {
  email: string;
  fullName: string;
  branchId: string;
  orgId: string;
  enrollmentDate: string; // ISO yyyy-mm-dd
  cohortYear: number;
}

/** Validate + normalize the POST /api/students/enroll body. */
export function parseEnrollStudent(body: unknown): EnrollStudentInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!EMAIL_RE.test(email)) fields.email = "valid email required";

  const fullName = typeof b.fullName === "string" ? b.fullName.trim() : "";
  if (fullName.length < 1 || fullName.length > 255)
    fields.fullName = "fullName required (1-255 chars)";

  if (!isUuid(b.branchId)) fields.branchId = "branchId must be a UUID";
  if (!isUuid(b.orgId)) fields.orgId = "orgId must be a UUID";

  const enrollmentDate =
    typeof b.enrollmentDate === "string" ? b.enrollmentDate : "";
  if (
    !ISO_DATE_RE.test(enrollmentDate) ||
    Number.isNaN(Date.parse(enrollmentDate))
  )
    fields.enrollmentDate = "enrollmentDate must be ISO yyyy-mm-dd";

  const cohortYear = b.cohortYear;
  if (
    typeof cohortYear !== "number" ||
    !Number.isInteger(cohortYear) ||
    cohortYear < 1900 ||
    cohortYear > 2200
  )
    fields.cohortYear = "cohortYear must be an integer year (1900-2200)";

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    email,
    fullName,
    branchId: b.branchId as string,
    orgId: b.orgId as string,
    enrollmentDate,
    cohortYear: cohortYear as number,
  };
}

export interface AssignClassInput {
  studentId: string;
  classId: string;
}

/** Validate the POST /api/classes/assign body. */
export function parseAssignClass(body: unknown): AssignClassInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.studentId)) fields.studentId = "studentId must be a UUID";
  if (!isUuid(b.classId)) fields.classId = "classId must be a UUID";

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { studentId: b.studentId as string, classId: b.classId as string };
}

export interface TutorCopilotInput {
  /** The educator's natural-language question for the AI tutor. */
  query: string;
  /** Class the whiteboard belongs to (tenant + audit scoping). */
  classId: string;
  /**
   * Snapshot of the whiteboard the educator is working on. Free-form text the
   * frontend extracts from canvas strokes / equations (e.g. an OCR'd matrix).
   * Bounded to keep prompt size predictable at the edge.
   */
  whiteboardContext?: string;
}

const MAX_QUERY = 4000;
const MAX_CONTEXT = 8000;

/** Validate the POST /api/ai/tutor-copilot body. */
export function parseTutorCopilot(body: unknown): TutorCopilotInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const query = typeof b.query === "string" ? b.query.trim() : "";
  if (query.length < 1 || query.length > MAX_QUERY)
    fields.query = `query required (1-${MAX_QUERY} chars)`;

  if (!isUuid(b.classId)) fields.classId = "classId must be a UUID";

  let whiteboardContext: string | undefined;
  if (b.whiteboardContext !== undefined) {
    if (
      typeof b.whiteboardContext !== "string" ||
      b.whiteboardContext.length > MAX_CONTEXT
    )
      fields.whiteboardContext = `whiteboardContext must be a string (<=${MAX_CONTEXT} chars)`;
    else whiteboardContext = b.whiteboardContext;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { query, classId: b.classId as string, whiteboardContext };
}

export interface LoginInput {
  email: string;
  password: string;
}

/** Validate the POST /api/auth/login body. */
export function parseLogin(body: unknown): LoginInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!EMAIL_RE.test(email)) fields.email = "valid email required";

  // Only assert presence/shape here — credential correctness is checked by the
  // service against the stored hash (and must not reveal which field was wrong).
  const password = typeof b.password === "string" ? b.password : "";
  if (password.length < 1 || password.length > 1024)
    fields.password = "password required";

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { email, password };
}

export interface ResetPasswordInput {
  userId: string;
  newPassword: string;
}

/** Validate the POST /api/auth/reset-password body. */
export function parseResetPassword(body: unknown): ResetPasswordInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.userId)) fields.userId = "userId must be a UUID";

  const newPassword = typeof b.newPassword === "string" ? b.newPassword : "";
  if (newPassword.length < 8 || newPassword.length > 1024)
    fields.newPassword = "newPassword must be 8-1024 characters";

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { userId: b.userId as string, newPassword };
}

export interface CreateClassInput {
  subject: string;
  term: string;
  branchId: string;
  credits: number;
}

/** Validate the POST /api/classes body. credits is optional (default 3). */
export function parseCreateClass(body: unknown): CreateClassInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  if (subject.length < 1 || subject.length > 255)
    fields.subject = "subject required (1-255 chars)";

  const term = typeof b.term === "string" ? b.term.trim() : "";
  if (term.length < 1 || term.length > 64)
    fields.term = "term required (1-64 chars)";

  if (!isUuid(b.branchId)) fields.branchId = "branchId must be a UUID";

  let credits = 3;
  if (b.credits !== undefined) {
    if (
      typeof b.credits !== "number" ||
      !Number.isInteger(b.credits) ||
      b.credits < 1 ||
      b.credits > 12
    )
      fields.credits = "credits must be an integer 1-12";
    else credits = b.credits;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { subject, term, branchId: b.branchId as string, credits };
}

export interface GradeEnrollmentInput {
  enrollmentId: string;
  finalGrade: string;
}

/** Validate the POST /api/enrollments/grade body. */
export function parseGradeEnrollment(body: unknown): GradeEnrollmentInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.enrollmentId))
    fields.enrollmentId = "enrollmentId must be a UUID";

  if (!isValidGrade(b.finalGrade))
    fields.finalGrade = `finalGrade must be one of ${VALID_GRADES.join(", ")}`;

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    enrollmentId: b.enrollmentId as string,
    finalGrade: b.finalGrade as string,
  };
}

/** Outcomes a caller may request for a term progression. */
export const PROMOTION_OUTCOMES = [
  "promoted",
  "retained",
  "graduated",
] as const;
export type PromotionOutcome = (typeof PROMOTION_OUTCOMES)[number];

export interface PromoteStudentInput {
  studentProfileId: string;
  term: string;
  outcome: PromotionOutcome;
}

/** Validate the POST /api/students/promote body. outcome optional (default promoted). */
export function parsePromoteStudent(body: unknown): PromoteStudentInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.studentProfileId))
    fields.studentProfileId = "studentProfileId must be a UUID";

  const term = typeof b.term === "string" ? b.term.trim() : "";
  if (term.length < 1 || term.length > 64)
    fields.term = "term required (1-64 chars)";

  let outcome: PromotionOutcome = "promoted";
  if (b.outcome !== undefined) {
    if (
      typeof b.outcome !== "string" ||
      !PROMOTION_OUTCOMES.includes(b.outcome as PromotionOutcome)
    )
      fields.outcome = `outcome must be one of ${PROMOTION_OUTCOMES.join(", ")}`;
    else outcome = b.outcome as PromotionOutcome;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { studentProfileId: b.studentProfileId as string, term, outcome };
}

/* ─────────────────────────── Module 4 — LMS ─────────────────────── */

const MAX_BODY = 20000;

export interface CreateAssignmentInput {
  classId: string;
  title: string;
  description?: string;
  dueDate?: string; // ISO datetime
  maxPoints: number;
}

/** Validate the POST /api/assignments body. */
export function parseCreateAssignment(body: unknown): CreateAssignmentInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.classId)) fields.classId = "classId must be a UUID";

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length < 1 || title.length > 255)
    fields.title = "title required (1-255 chars)";

  let description: string | undefined;
  if (b.description !== undefined) {
    if (typeof b.description !== "string" || b.description.length > MAX_BODY)
      fields.description = `description must be a string (<=${MAX_BODY} chars)`;
    else description = b.description;
  }

  let dueDate: string | undefined;
  if (b.dueDate !== undefined && b.dueDate !== null && b.dueDate !== "") {
    if (typeof b.dueDate !== "string" || Number.isNaN(Date.parse(b.dueDate)))
      fields.dueDate = "dueDate must be an ISO date/datetime";
    else dueDate = b.dueDate;
  }

  let maxPoints = 100;
  if (b.maxPoints !== undefined) {
    if (
      typeof b.maxPoints !== "number" ||
      !Number.isInteger(b.maxPoints) ||
      b.maxPoints < 1 ||
      b.maxPoints > 1000
    )
      fields.maxPoints = "maxPoints must be an integer 1-1000";
    else maxPoints = b.maxPoints;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { classId: b.classId as string, title, description, dueDate, maxPoints };
}

export const ASSIGNMENT_STATUS_TARGETS = ["published", "closed", "draft"] as const;
export type AssignmentStatusTarget =
  (typeof ASSIGNMENT_STATUS_TARGETS)[number];

export interface AssignmentStatusInput {
  status: AssignmentStatusTarget;
}

/** Validate the POST /api/assignments/[id]/status body. */
export function parseAssignmentStatus(body: unknown): AssignmentStatusInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const status = typeof b.status === "string" ? b.status : "";
  if (!ASSIGNMENT_STATUS_TARGETS.includes(status as AssignmentStatusTarget))
    fields.status = `status must be one of ${ASSIGNMENT_STATUS_TARGETS.join(", ")}`;

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { status: status as AssignmentStatusTarget };
}

export interface CreateSubmissionInput {
  assignmentId: string;
}

/** Validate the POST /api/submissions body. */
export function parseCreateSubmission(body: unknown): CreateSubmissionInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(b.assignmentId))
    fields.assignmentId = "assignmentId must be a UUID";
  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);
  return { assignmentId: b.assignmentId as string };
}

export interface GradeSubmissionInput {
  pointsAwarded: number;
  feedback?: string;
}

/** Validate the POST /api/submissions/[id]/grade body. (Cap vs maxPoints is the service's job.) */
export function parseGradeSubmission(body: unknown): GradeSubmissionInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (
    typeof b.pointsAwarded !== "number" ||
    !Number.isInteger(b.pointsAwarded) ||
    b.pointsAwarded < 0
  )
    fields.pointsAwarded = "pointsAwarded must be a non-negative integer";

  let feedback: string | undefined;
  if (b.feedback !== undefined) {
    if (typeof b.feedback !== "string" || b.feedback.length > MAX_BODY)
      fields.feedback = `feedback must be a string (<=${MAX_BODY} chars)`;
    else feedback = b.feedback;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { pointsAwarded: b.pointsAwarded as number, feedback };
}

export interface RegisterFileInput {
  fileName: string;
  url: string;
  storageKey: string;
  contentType?: string;
  sizeBytes?: number;
}

/** Validate a submission-file metadata record (the dev/explicit register path). */
export function parseRegisterFile(body: unknown): RegisterFileInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const fileName = typeof b.fileName === "string" ? b.fileName.trim() : "";
  if (fileName.length < 1 || fileName.length > 512)
    fields.fileName = "fileName required (1-512 chars)";

  const url = typeof b.url === "string" ? b.url.trim() : "";
  if (url.length < 1 || url.length > 2048) fields.url = "url required";

  const storageKey =
    typeof b.storageKey === "string" ? b.storageKey.trim() : "";
  if (storageKey.length < 1 || storageKey.length > 1024)
    fields.storageKey = "storageKey required";

  let contentType: string | undefined;
  if (b.contentType !== undefined) {
    if (typeof b.contentType !== "string" || b.contentType.length > 128)
      fields.contentType = "contentType must be a string (<=128 chars)";
    else contentType = b.contentType;
  }

  let sizeBytes: number | undefined;
  if (b.sizeBytes !== undefined) {
    if (
      typeof b.sizeBytes !== "number" ||
      !Number.isInteger(b.sizeBytes) ||
      b.sizeBytes < 0
    )
      fields.sizeBytes = "sizeBytes must be a non-negative integer";
    else sizeBytes = b.sizeBytes;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { fileName, url, storageKey, contentType, sizeBytes };
}

export interface CreateThreadInput {
  classId: string;
  assignmentId?: string;
  title: string;
  body: string;
}

/** Validate the POST /api/discussions/threads body. */
export function parseCreateThread(body: unknown): CreateThreadInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.classId)) fields.classId = "classId must be a UUID";

  let assignmentId: string | undefined;
  if (b.assignmentId !== undefined && b.assignmentId !== null) {
    if (!isUuid(b.assignmentId))
      fields.assignmentId = "assignmentId must be a UUID";
    else assignmentId = b.assignmentId as string;
  }

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length < 1 || title.length > 255)
    fields.title = "title required (1-255 chars)";

  const text = typeof b.body === "string" ? b.body.trim() : "";
  if (text.length < 1 || text.length > MAX_BODY)
    fields.body = `body required (1-${MAX_BODY} chars)`;

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { classId: b.classId as string, assignmentId, title, body: text };
}

export interface CreatePostInput {
  body: string;
  parentPostId?: string;
}

/** Validate the POST /api/discussions/threads/[id]/posts body. */
export function parseCreatePost(body: unknown): CreatePostInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const text = typeof b.body === "string" ? b.body.trim() : "";
  if (text.length < 1 || text.length > MAX_BODY)
    fields.body = `body required (1-${MAX_BODY} chars)`;

  let parentPostId: string | undefined;
  if (b.parentPostId !== undefined && b.parentPostId !== null) {
    if (!isUuid(b.parentPostId))
      fields.parentPostId = "parentPostId must be a UUID";
    else parentPostId = b.parentPostId as string;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { body: text, parentPostId };
}

export interface CreateOrganizationInput {
  name: string;
}

/** Validate the POST /api/admin/organizations body. */
export function parseCreateOrganization(
  body: unknown,
): CreateOrganizationInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 255)
    fields.name = "name required (1-255 chars)";

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { name };
}

/** Operational status a branch can be provisioned in (mirrors branchStatusEnum). */
export const BRANCH_STATUSES = ["active", "inactive", "pending"] as const;
export type BranchStatusInput = (typeof BRANCH_STATUSES)[number];

export interface CreateBranchInput {
  orgId: string;
  location: string;
  status: BranchStatusInput;
}

/** Validate the POST /api/admin/branches body. status is optional (default active). */
export function parseCreateBranch(body: unknown): CreateBranchInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.orgId)) fields.orgId = "orgId must be a UUID";

  const location = typeof b.location === "string" ? b.location.trim() : "";
  if (location.length < 1 || location.length > 512)
    fields.location = "location required (1-512 chars)";

  let status: BranchStatusInput = "active";
  if (b.status !== undefined) {
    if (
      typeof b.status !== "string" ||
      !BRANCH_STATUSES.includes(b.status as BranchStatusInput)
    )
      fields.status = `status must be one of ${BRANCH_STATUSES.join(", ")}`;
    else status = b.status as BranchStatusInput;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { orgId: b.orgId as string, location, status };
}

/**
 * Target staff statuses a lifecycle action may move TO. "onboarding" is the
 * initial state only — it is never a transition target — so it is excluded.
 */
export const STAFF_TARGET_STATUSES = [
  "active",
  "on_leave",
  "retired",
  "terminated",
] as const;
export type StaffTargetStatus = (typeof STAFF_TARGET_STATUSES)[number];

export interface ChangeStaffStatusInput {
  staffProfileId: string;
  status: StaffTargetStatus;
  /** Offboarding date stamped onto retirementDate for retire/terminate. */
  effectiveDate?: string;
}

/** Validate the POST /api/staff/status body. (Transition legality is the service's job.) */
export function parseChangeStaffStatus(body: unknown): ChangeStaffStatusInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.staffProfileId))
    fields.staffProfileId = "staffProfileId must be a UUID";

  const status = typeof b.status === "string" ? b.status : "";
  if (!STAFF_TARGET_STATUSES.includes(status as StaffTargetStatus))
    fields.status = `status must be one of ${STAFF_TARGET_STATUSES.join(", ")}`;

  let effectiveDate: string | undefined;
  if (b.effectiveDate !== undefined) {
    if (
      typeof b.effectiveDate !== "string" ||
      !ISO_DATE_RE.test(b.effectiveDate) ||
      Number.isNaN(Date.parse(b.effectiveDate))
    )
      fields.effectiveDate = "effectiveDate must be ISO yyyy-mm-dd";
    else effectiveDate = b.effectiveDate;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    staffProfileId: b.staffProfileId as string,
    status: status as StaffTargetStatus,
    effectiveDate,
  };
}

/** Roles a staff member can hold on a class roster (mirrors the DB enum). */
export const STAFF_ASSIGNMENT_ROLES = ["lead", "assistant"] as const;
export type StaffAssignmentRole = (typeof STAFF_ASSIGNMENT_ROLES)[number];

export interface AssignStaffInput {
  staffProfileId: string;
  classId: string;
  role: StaffAssignmentRole;
}

/** Validate the POST /api/staff/assign body. role is optional (default lead). */
export function parseAssignStaff(body: unknown): AssignStaffInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.staffProfileId))
    fields.staffProfileId = "staffProfileId must be a UUID";
  if (!isUuid(b.classId)) fields.classId = "classId must be a UUID";

  let role: StaffAssignmentRole = "lead";
  if (b.role !== undefined) {
    if (
      typeof b.role !== "string" ||
      !STAFF_ASSIGNMENT_ROLES.includes(b.role as StaffAssignmentRole)
    )
      fields.role = `role must be one of ${STAFF_ASSIGNMENT_ROLES.join(", ")}`;
    else role = b.role as StaffAssignmentRole;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    staffProfileId: b.staffProfileId as string,
    classId: b.classId as string,
    role,
  };
}

export interface UnassignStaffInput {
  assignmentId: string;
}

/** Validate the POST /api/staff/unassign body. */
export function parseUnassignStaff(body: unknown): UnassignStaffInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.assignmentId))
    fields.assignmentId = "assignmentId must be a UUID";

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { assignmentId: b.assignmentId as string };
}

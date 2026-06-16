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

export interface DerivationInput {
  /** Class whose live whiteboard the derivation is scoped to. */
  classId: string;
  /** Snapshot of the board the educator wants derived (OCR'd math/text). */
  whiteboardContext: string;
  /** Optional focus, e.g. "just the integration-by-parts step". */
  prompt?: string;
}

/** Validate the POST /api/me/ai/derivation body. */
export function parseDerivation(body: unknown): DerivationInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.classId)) fields.classId = "classId must be a UUID";

  const whiteboardContext =
    typeof b.whiteboardContext === "string" ? b.whiteboardContext.trim() : "";
  if (whiteboardContext.length < 1 || whiteboardContext.length > MAX_CONTEXT)
    fields.whiteboardContext = `whiteboardContext required (1-${MAX_CONTEXT} chars)`;

  let prompt: string | undefined;
  if (b.prompt !== undefined) {
    if (typeof b.prompt !== "string" || b.prompt.length > MAX_QUERY)
      fields.prompt = `prompt must be a string (<=${MAX_QUERY} chars)`;
    else prompt = b.prompt.trim() || undefined;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { classId: b.classId as string, whiteboardContext, prompt };
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

export interface UpdateUserProfileInput {
  fullName?: string;
  email?: string;
}

/**
 * Validate the PATCH /api/admin/users/[userId] body. A partial update: at least
 * one of fullName/email must be present, and any provided field must be valid.
 */
export function parseUpdateUserProfile(body: unknown): UpdateUserProfileInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;
  const out: UpdateUserProfileInput = {};

  if (b.fullName !== undefined) {
    const fullName = typeof b.fullName === "string" ? b.fullName.trim() : "";
    if (fullName.length < 1 || fullName.length > 255)
      fields.fullName = "fullName must be 1-255 chars";
    else out.fullName = fullName;
  }

  if (b.email !== undefined) {
    const email = typeof b.email === "string" ? b.email.trim() : "";
    if (!EMAIL_RE.test(email) || email.length > 320)
      fields.email = "valid email required";
    else out.email = email;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  if (out.fullName === undefined && out.email === undefined)
    throw new ValidationError("Nothing to update", {
      _: "provide fullName and/or email",
    });

  return out;
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

/** Relationship labels a guardian link may carry. */
export const GUARDIAN_RELATIONSHIPS = [
  "guardian",
  "mother",
  "father",
  "grandparent",
  "other",
] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export interface LinkGuardianInput {
  parentEmail: string;
  studentProfileId: string;
  relationship: GuardianRelationship;
}

/** Validate the POST /api/guardians body. relationship optional (default guardian). */
export function parseLinkGuardian(body: unknown): LinkGuardianInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const parentEmail = typeof b.parentEmail === "string" ? b.parentEmail.trim() : "";
  if (!EMAIL_RE.test(parentEmail)) fields.parentEmail = "valid parent email required";

  if (!isUuid(b.studentProfileId))
    fields.studentProfileId = "studentProfileId must be a UUID";

  let relationship: GuardianRelationship = "guardian";
  if (b.relationship !== undefined) {
    if (
      typeof b.relationship !== "string" ||
      !GUARDIAN_RELATIONSHIPS.includes(b.relationship as GuardianRelationship)
    )
      fields.relationship = `relationship must be one of ${GUARDIAN_RELATIONSHIPS.join(", ")}`;
    else relationship = b.relationship as GuardianRelationship;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { parentEmail, studentProfileId: b.studentProfileId as string, relationship };
}

/* ─────────────────────────── Module 2 — HR Ops ──────────────────── */

export const STAFF_ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "late",
  "on_leave",
  "remote",
] as const;
export type StaffAttendanceStatus = (typeof STAFF_ATTENDANCE_STATUSES)[number];

export interface RecordAttendanceInput {
  staffProfileId: string;
  date: string; // ISO yyyy-mm-dd
  status: StaffAttendanceStatus;
  notes?: string;
}

/** Validate the POST /api/hr/attendance body. */
export function parseRecordAttendance(body: unknown): RecordAttendanceInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.staffProfileId))
    fields.staffProfileId = "staffProfileId must be a UUID";

  const date = typeof b.date === "string" ? b.date : "";
  if (!ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(date)))
    fields.date = "date must be ISO yyyy-mm-dd";

  const status = typeof b.status === "string" ? b.status : "";
  if (!STAFF_ATTENDANCE_STATUSES.includes(status as StaffAttendanceStatus))
    fields.status = `status must be one of ${STAFF_ATTENDANCE_STATUSES.join(", ")}`;

  let notes: string | undefined;
  if (b.notes !== undefined && b.notes !== null && b.notes !== "") {
    if (typeof b.notes !== "string" || b.notes.length > 2000)
      fields.notes = "notes must be a string (<=2000 chars)";
    else notes = b.notes;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    staffProfileId: b.staffProfileId as string,
    date,
    status: status as StaffAttendanceStatus,
    notes,
  };
}

export const STAFF_DOCUMENT_CATEGORIES = [
  "contract",
  "id",
  "certificate",
  "tax",
  "other",
] as const;
export type StaffDocumentCategory = (typeof STAFF_DOCUMENT_CATEGORIES)[number];

export interface RegisterStaffDocumentInput {
  fileName: string;
  url: string;
  storageKey: string;
  category?: StaffDocumentCategory;
  contentType?: string;
  sizeBytes?: number;
}

/** Validate the POST /api/hr/documents body (metadata registration). */
export function parseRegisterStaffDocument(body: unknown): RegisterStaffDocumentInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const fileName = typeof b.fileName === "string" ? b.fileName.trim() : "";
  if (fileName.length < 1 || fileName.length > 512)
    fields.fileName = "fileName required (1-512 chars)";

  const url = typeof b.url === "string" ? b.url.trim() : "";
  if (url.length < 1 || url.length > 2048) fields.url = "url required";

  const storageKey = typeof b.storageKey === "string" ? b.storageKey.trim() : "";
  if (storageKey.length < 1 || storageKey.length > 1024)
    fields.storageKey = "storageKey required";

  let category: StaffDocumentCategory | undefined;
  if (b.category !== undefined) {
    if (typeof b.category !== "string" || !STAFF_DOCUMENT_CATEGORIES.includes(b.category as StaffDocumentCategory))
      fields.category = `category must be one of ${STAFF_DOCUMENT_CATEGORIES.join(", ")}`;
    else category = b.category as StaffDocumentCategory;
  }

  let contentType: string | undefined;
  if (b.contentType !== undefined) {
    if (typeof b.contentType !== "string" || b.contentType.length > 128)
      fields.contentType = "contentType must be a string (<=128 chars)";
    else contentType = b.contentType;
  }

  let sizeBytes: number | undefined;
  if (b.sizeBytes !== undefined && b.sizeBytes !== null) {
    if (typeof b.sizeBytes !== "number" || !Number.isInteger(b.sizeBytes) || b.sizeBytes < 0)
      fields.sizeBytes = "sizeBytes must be a non-negative integer";
    else sizeBytes = b.sizeBytes;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { fileName, url, storageKey, category, contentType, sizeBytes };
}

export interface CreatePayrollInput {
  staffProfileId: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  deductions?: number;
  currency?: string;
  notes?: string;
}

/** Validate the POST /api/hr/payroll body. */
export function parseCreatePayroll(body: unknown): CreatePayrollInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.staffProfileId))
    fields.staffProfileId = "staffProfileId must be a UUID";

  const periodStart = typeof b.periodStart === "string" ? b.periodStart : "";
  if (!ISO_DATE_RE.test(periodStart) || Number.isNaN(Date.parse(periodStart)))
    fields.periodStart = "periodStart must be ISO yyyy-mm-dd";

  const periodEnd = typeof b.periodEnd === "string" ? b.periodEnd : "";
  if (!ISO_DATE_RE.test(periodEnd) || Number.isNaN(Date.parse(periodEnd)))
    fields.periodEnd = "periodEnd must be ISO yyyy-mm-dd";
  else if (periodStart && Date.parse(periodEnd) < Date.parse(periodStart))
    fields.periodEnd = "periodEnd must be on/after periodStart";

  const grossAmount = b.grossAmount;
  if (typeof grossAmount !== "number" || !Number.isFinite(grossAmount) || grossAmount <= 0 || grossAmount > 1e9)
    fields.grossAmount = "grossAmount must be a positive number";

  let deductions: number | undefined;
  if (b.deductions !== undefined && b.deductions !== null) {
    if (typeof b.deductions !== "number" || !Number.isFinite(b.deductions) || b.deductions < 0)
      fields.deductions = "deductions must be a non-negative number";
    else deductions = b.deductions;
  }

  let currency: string | undefined;
  if (b.currency !== undefined) {
    if (typeof b.currency !== "string" || b.currency.length < 1 || b.currency.length > 8)
      fields.currency = "currency must be a 1-8 char code";
    else currency = b.currency.trim().toUpperCase();
  }

  let notes: string | undefined;
  if (b.notes !== undefined && b.notes !== null && b.notes !== "") {
    if (typeof b.notes !== "string" || b.notes.length > 2000)
      fields.notes = "notes must be a string (<=2000 chars)";
    else notes = b.notes;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    staffProfileId: b.staffProfileId as string,
    periodStart,
    periodEnd,
    grossAmount: grossAmount as number,
    deductions,
    currency,
    notes,
  };
}

export interface CreateReviewInput {
  staffProfileId: string;
  reviewDate: string;
  rating: number;
  summary: string;
}

/** Validate the POST /api/hr/performance body. */
export function parseCreateReview(body: unknown): CreateReviewInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.staffProfileId))
    fields.staffProfileId = "staffProfileId must be a UUID";

  const reviewDate = typeof b.reviewDate === "string" ? b.reviewDate : "";
  if (!ISO_DATE_RE.test(reviewDate) || Number.isNaN(Date.parse(reviewDate)))
    fields.reviewDate = "reviewDate must be ISO yyyy-mm-dd";

  const rating = b.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5)
    fields.rating = "rating must be an integer 1-5";

  const summary = typeof b.summary === "string" ? b.summary.trim() : "";
  if (summary.length < 1 || summary.length > 4000)
    fields.summary = "summary required (1-4000 chars)";

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    staffProfileId: b.staffProfileId as string,
    reviewDate,
    rating: rating as number,
    summary,
  };
}

/* ──────────────────── Module 3 — Admissions & Fees ──────────────── */

export interface CreateApplicationInput {
  branchId: string;
  applicantName: string;
  applicantEmail: string;
  cohortYear: number;
  examScore?: number;
  notes?: string;
}

/** Validate the POST /api/admissions body. */
export function parseCreateApplication(body: unknown): CreateApplicationInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.branchId)) fields.branchId = "branchId must be a UUID";

  const applicantName = typeof b.applicantName === "string" ? b.applicantName.trim() : "";
  if (applicantName.length < 1 || applicantName.length > 255)
    fields.applicantName = "applicantName required (1-255 chars)";

  const applicantEmail = typeof b.applicantEmail === "string" ? b.applicantEmail.trim() : "";
  if (!EMAIL_RE.test(applicantEmail)) fields.applicantEmail = "valid applicant email required";

  const cohortYear = b.cohortYear;
  if (typeof cohortYear !== "number" || !Number.isInteger(cohortYear) || cohortYear < 1900 || cohortYear > 2200)
    fields.cohortYear = "cohortYear must be an integer year (1900-2200)";

  let examScore: number | undefined;
  if (b.examScore !== undefined && b.examScore !== null) {
    if (typeof b.examScore !== "number" || !Number.isInteger(b.examScore) || b.examScore < 0 || b.examScore > 1000)
      fields.examScore = "examScore must be an integer 0-1000";
    else examScore = b.examScore;
  }

  let notes: string | undefined;
  if (b.notes !== undefined && b.notes !== null && b.notes !== "") {
    if (typeof b.notes !== "string" || b.notes.length > 2000)
      fields.notes = "notes must be a string (<=2000 chars)";
    else notes = b.notes;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    branchId: b.branchId as string,
    applicantName,
    applicantEmail,
    cohortYear: cohortYear as number,
    examScore,
    notes,
  };
}

export const APPLICATION_DECISIONS = ["under_review", "accepted", "rejected"] as const;
export type ApplicationDecision = (typeof APPLICATION_DECISIONS)[number];

export interface ApplicationDecisionInput {
  status: ApplicationDecision;
}

/** Validate the POST /api/admissions/[id]/decision body. */
export function parseApplicationDecision(body: unknown): ApplicationDecisionInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const status = typeof b.status === "string" ? b.status : "";
  if (!APPLICATION_DECISIONS.includes(status as ApplicationDecision))
    fields.status = `status must be one of ${APPLICATION_DECISIONS.join(", ")}`;

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { status: status as ApplicationDecision };
}

export interface EnrollApplicantInput {
  enrollmentDate: string; // ISO yyyy-mm-dd
}

/** Validate the POST /api/admissions/[id]/enroll body. enrollmentDate optional (default today). */
export function parseEnrollApplicant(body: unknown): EnrollApplicantInput {
  const b = (body ?? {}) as Record<string, unknown>;
  let enrollmentDate: string;
  if (b.enrollmentDate === undefined || b.enrollmentDate === null || b.enrollmentDate === "") {
    const d = new Date();
    enrollmentDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } else if (
    typeof b.enrollmentDate !== "string" ||
    !ISO_DATE_RE.test(b.enrollmentDate) ||
    Number.isNaN(Date.parse(b.enrollmentDate))
  ) {
    throw new ValidationError("Invalid request body", {
      enrollmentDate: "enrollmentDate must be ISO yyyy-mm-dd",
    });
  } else {
    enrollmentDate = b.enrollmentDate;
  }
  return { enrollmentDate };
}

export interface GraduateStudentInput {
  title: string;
  program?: string;
  gpa?: number;
  issuedDate: string; // ISO yyyy-mm-dd
}

/** Validate the POST /api/students/[id]/graduate body. issuedDate optional (default today). */
export function parseGraduateStudent(body: unknown): GraduateStudentInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length < 1 || title.length > 255)
    fields.title = "title required (1-255 chars)";

  let program: string | undefined;
  if (b.program !== undefined && b.program !== null && b.program !== "") {
    if (typeof b.program !== "string" || b.program.length > 255)
      fields.program = "program must be a string (<=255 chars)";
    else program = b.program.trim();
  }

  let gpa: number | undefined;
  if (b.gpa !== undefined && b.gpa !== null) {
    if (typeof b.gpa !== "number" || !Number.isFinite(b.gpa) || b.gpa < 0 || b.gpa > 5)
      fields.gpa = "gpa must be a number 0-5";
    else gpa = b.gpa;
  }

  let issuedDate: string;
  if (b.issuedDate === undefined || b.issuedDate === null || b.issuedDate === "") {
    const d = new Date();
    issuedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } else if (
    typeof b.issuedDate !== "string" ||
    !ISO_DATE_RE.test(b.issuedDate) ||
    Number.isNaN(Date.parse(b.issuedDate))
  ) {
    fields.issuedDate = "issuedDate must be ISO yyyy-mm-dd";
    issuedDate = "";
  } else {
    issuedDate = b.issuedDate;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { title, program, gpa, issuedDate };
}

export interface CreateInvoiceInput {
  studentProfileId: string;
  description: string;
  amountDue: number;
  currency?: string;
  dueDate?: string;
}

/** Validate the POST /api/fees/invoices body. */
export function parseCreateInvoice(body: unknown): CreateInvoiceInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.studentProfileId))
    fields.studentProfileId = "studentProfileId must be a UUID";

  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (description.length < 1 || description.length > 255)
    fields.description = "description required (1-255 chars)";

  const amountDue = b.amountDue;
  if (typeof amountDue !== "number" || !Number.isFinite(amountDue) || amountDue <= 0 || amountDue > 1e9)
    fields.amountDue = "amountDue must be a positive number";

  let currency: string | undefined;
  if (b.currency !== undefined) {
    if (typeof b.currency !== "string" || b.currency.length < 1 || b.currency.length > 8)
      fields.currency = "currency must be a 1-8 char code";
    else currency = b.currency.trim().toUpperCase();
  }

  let dueDate: string | undefined;
  if (b.dueDate !== undefined && b.dueDate !== null && b.dueDate !== "") {
    if (typeof b.dueDate !== "string" || !ISO_DATE_RE.test(b.dueDate) || Number.isNaN(Date.parse(b.dueDate)))
      fields.dueDate = "dueDate must be ISO yyyy-mm-dd";
    else dueDate = b.dueDate;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return {
    studentProfileId: b.studentProfileId as string,
    description,
    amountDue: amountDue as number,
    currency,
    dueDate,
  };
}

export interface RecordPaymentInput {
  amount: number;
  method?: string;
  reference?: string;
}

/** Validate the POST /api/fees/invoices/[id]/payments body. */
export function parseRecordPayment(body: unknown): RecordPaymentInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const amount = b.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 1e9)
    fields.amount = "amount must be a positive number";

  let method: string | undefined;
  if (b.method !== undefined) {
    if (typeof b.method !== "string" || b.method.length < 1 || b.method.length > 32)
      fields.method = "method must be a 1-32 char string";
    else method = b.method.trim();
  }

  let reference: string | undefined;
  if (b.reference !== undefined && b.reference !== null && b.reference !== "") {
    if (typeof b.reference !== "string" || b.reference.length > 128)
      fields.reference = "reference must be a string (<=128 chars)";
    else reference = b.reference;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { amount: amount as number, method, reference };
}

export interface EndSessionInput {
  snapshotUrl: string;
  snapshotKey: string;
  payAmount: number;
  currency?: string;
  /** Optional: a manager ending another tutor's session; defaults to caller. */
  staffProfileId?: string;
}

/** Validate the POST /api/schedule/[sessionId]/end body. */
export function parseEndSession(body: unknown): EndSessionInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const snapshotUrl = typeof b.snapshotUrl === "string" ? b.snapshotUrl.trim() : "";
  if (snapshotUrl.length < 1 || snapshotUrl.length > 2048)
    fields.snapshotUrl = "snapshotUrl required";

  const snapshotKey = typeof b.snapshotKey === "string" ? b.snapshotKey.trim() : "";
  if (snapshotKey.length < 1 || snapshotKey.length > 1024)
    fields.snapshotKey = "snapshotKey required";

  const payAmount = b.payAmount;
  if (typeof payAmount !== "number" || !Number.isFinite(payAmount) || payAmount < 0 || payAmount > 1e9)
    fields.payAmount = "payAmount must be a non-negative number";

  let currency: string | undefined;
  if (b.currency !== undefined) {
    if (typeof b.currency !== "string" || b.currency.length < 1 || b.currency.length > 8)
      fields.currency = "currency must be a 1-8 char code";
    else currency = b.currency.trim().toUpperCase();
  }

  let staffProfileId: string | undefined;
  if (b.staffProfileId !== undefined && b.staffProfileId !== null) {
    if (!isUuid(b.staffProfileId)) fields.staffProfileId = "staffProfileId must be a UUID";
    else staffProfileId = b.staffProfileId as string;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { snapshotUrl, snapshotKey, payAmount: payAmount as number, currency, staffProfileId };
}

export interface CreateClassSessionInput {
  classId: string;
  title: string;
  /** ISO datetime (with timezone offset / Z) for when the session starts. */
  startsAt: string;
  durationMinutes: number;
}

/** Validate the POST /api/schedule body. durationMinutes optional (default 60). */
export function parseCreateClassSession(
  body: unknown,
): CreateClassSessionInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.classId)) fields.classId = "classId must be a UUID";

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length < 1 || title.length > 255)
    fields.title = "title required (1-255 chars)";

  const startsAt = typeof b.startsAt === "string" ? b.startsAt : "";
  if (!startsAt || Number.isNaN(Date.parse(startsAt)))
    fields.startsAt = "startsAt must be an ISO datetime";

  let durationMinutes = 60;
  if (b.durationMinutes !== undefined) {
    if (
      typeof b.durationMinutes !== "number" ||
      !Number.isInteger(b.durationMinutes) ||
      b.durationMinutes < 5 ||
      b.durationMinutes > 600
    )
      fields.durationMinutes = "durationMinutes must be an integer 5-600";
    else durationMinutes = b.durationMinutes;
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { classId: b.classId as string, title, startsAt, durationMinutes };
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

export interface ClassroomTokenInput {
  /** The class whose live whiteboard the caller wants to connect to. */
  classId: string;
}

/** Validate the POST /api/me/classroom/token body. */
export function parseClassroomToken(body: unknown): ClassroomTokenInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.classId)) fields.classId = "classId must be a UUID";

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { classId: b.classId as string };
}

/** Grading scales an organization can standardize on. */
export const GRADING_SCALES = ["letter", "percentage", "gpa4", "gpa10"] as const;
export type GradingScale = (typeof GRADING_SCALES)[number];

export interface OrgSettingsInput {
  locale: string;
  gradingScale: GradingScale;
  featureFlags: Record<string, boolean>;
}

/** Validate the PUT /api/admin/organizations/[orgId]/settings body. */
export function parseOrgSettings(body: unknown): OrgSettingsInput {
  const fields: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;

  const locale = typeof b.locale === "string" ? b.locale.trim() : "";
  // BCP-47-ish: letters, digits, hyphens (e.g. en, en-US, pt-BR).
  if (!/^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/.test(locale))
    fields.locale = "locale must be a BCP-47 tag (e.g. en-US)";

  const gradingScale = typeof b.gradingScale === "string" ? b.gradingScale : "";
  if (!GRADING_SCALES.includes(gradingScale as GradingScale))
    fields.gradingScale = `gradingScale must be one of ${GRADING_SCALES.join(", ")}`;

  const featureFlags: Record<string, boolean> = {};
  if (b.featureFlags !== undefined && b.featureFlags !== null) {
    if (typeof b.featureFlags !== "object" || Array.isArray(b.featureFlags)) {
      fields.featureFlags = "featureFlags must be an object of booleans";
    } else {
      for (const [k, v] of Object.entries(b.featureFlags as Record<string, unknown>)) {
        if (typeof v !== "boolean") {
          fields.featureFlags = `featureFlags.${k} must be a boolean`;
          break;
        }
        if (k.length <= 64) featureFlags[k] = v;
      }
    }
  }

  if (Object.keys(fields).length > 0)
    throw new ValidationError("Invalid request body", fields);

  return { locale, gradingScale: gradingScale as GradingScale, featureFlags };
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

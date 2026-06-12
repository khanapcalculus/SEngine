/**
 * Hand-rolled validation for request bodies (Guideline #4: never trust client
 * data). Kept dependency-free and stateless for edge compatibility; swap for
 * zod later if desired without changing the route contracts.
 */

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

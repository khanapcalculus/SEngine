"use client";

/**
 * Interactive dashboard feature components (forms, gradebook, transcript,
 * tutor, tenant provisioning). Moved verbatim out of the former monolithic
 * page so each role-routed page composes only what its role may use. All are
 * prop-driven (scope/data/onDone) for reuse + testability.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { VALID_GRADES } from "../../../modules/sis/grading";
import {
  Section,
  ScopeHint,
  StatusBadge,
  btn,
  fmtErr,
  dim,
  errStyle,
  fieldErrorStyle,
  formGrid,
  inp,
  miniBtn,
  tenantCard,
  PROMOTION_OUTCOMES,
  type ClassRow,
  type EnrollmentRow,
  type StaffRow,
  type StudentRow,
  type TenantScope,
  type TranscriptData,
} from "./ui";

export function OnboardStaffForm({
  scope,
  onDone,
}: {
  scope: TenantScope;
  onDone: (m: string) => void;
}) {
  const [f, setF] = useState({
    email: "",
    fullName: "",
    department: "",
    hireDate: "",
    baseRate: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !scope.orgId || !scope.branchId;

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!f.email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email))
      errors.email = "Please enter a valid email address";
    if (!f.fullName.trim()) errors.fullName = "Full name is required";
    else if (f.fullName.length > 255)
      errors.fullName = "Full name must be 255 characters or less";
    if (!f.department.trim()) errors.department = "Department is required";
    else if (f.department.length > 128)
      errors.department = "Department must be 128 characters or less";
    if (!f.hireDate) errors.hireDate = "Hire date is required";
    else if (isNaN(Date.parse(f.hireDate)))
      errors.hireDate = "Please enter a valid date";
    if (f.baseRate !== "") {
      const r = Number(f.baseRate);
      if (!Number.isFinite(r) || r < 0 || r > 100000)
        errors.baseRate = "Hourly rate must be a number 0–100000";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!scope.orgId || !scope.branchId) {
      setErr("Select an organization and branch first.");
      return;
    }
    if (!validateForm()) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/staff/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: f.email,
          fullName: f.fullName,
          department: f.department,
          hireDate: f.hireDate,
          baseRate: f.baseRate !== "" ? Number(f.baseRate) : undefined,
          orgId: scope.orgId,
          branchId: scope.branchId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Onboarded ${f.fullName}. Temporary password: ${d.temporaryPassword}`);
      setF({ email: "", fullName: "", department: "", hireDate: "", baseRate: "" });
      setFieldErrors({});
    } catch {
      setErr("An unexpected error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Onboard staff">
      <ScopeHint scope={scope} />
      <form onSubmit={submit} style={formGrid}>
        <div>
          <input
            style={inp}
            placeholder="Email"
            type="email"
            disabled={disabled}
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
          {fieldErrors.email && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.email}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            placeholder="Full name"
            disabled={disabled}
            value={f.fullName}
            onChange={(e) => setF({ ...f, fullName: e.target.value })}
          />
          {fieldErrors.fullName && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.fullName}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            placeholder="Department"
            disabled={disabled}
            value={f.department}
            onChange={(e) => setF({ ...f, department: e.target.value })}
          />
          {fieldErrors.department && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.department}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            type="date"
            disabled={disabled}
            value={f.hireDate}
            onChange={(e) => setF({ ...f, hireDate: e.target.value })}
          />
          {fieldErrors.hireDate && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.hireDate}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            type="number"
            min="0"
            step="0.01"
            placeholder="Hourly rate (default 25.00)"
            disabled={disabled}
            value={f.baseRate}
            onChange={(e) => setF({ ...f, baseRate: e.target.value })}
          />
          {fieldErrors.baseRate && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.baseRate}
            </p>
          )}
        </div>
        {err && (
          <p role="alert" style={errStyle}>
            {err}
          </p>
        )}
        <button type="submit" disabled={busy || disabled} style={btn(busy || disabled)}>
          {busy ? "Saving…" : "Onboard"}
        </button>
      </form>
    </Section>
  );
}

export function EnrollStudentForm({
  scope,
  onDone,
}: {
  scope: TenantScope;
  onDone: (m: string) => void;
}) {
  const [f, setF] = useState({
    email: "",
    fullName: "",
    enrollmentDate: "",
    cohortYear: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !scope.orgId || !scope.branchId;

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!f.email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email))
      errors.email = "Please enter a valid email address";
    if (!f.fullName.trim()) errors.fullName = "Full name is required";
    else if (f.fullName.length > 255)
      errors.fullName = "Full name must be 255 characters or less";
    if (!f.enrollmentDate) errors.enrollmentDate = "Enrollment date is required";
    else if (isNaN(Date.parse(f.enrollmentDate)))
      errors.enrollmentDate = "Please enter a valid date";
    if (!f.cohortYear.trim()) errors.cohortYear = "Cohort year is required";
    else {
      const year = Number(f.cohortYear);
      if (isNaN(year) || year < 2000 || year > 2100)
        errors.cohortYear = "Please enter a valid year between 2000 and 2100";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!scope.orgId || !scope.branchId) {
      setErr("Select an organization and branch first.");
      return;
    }
    if (!validateForm()) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/students/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: f.email,
          fullName: f.fullName,
          enrollmentDate: f.enrollmentDate,
          cohortYear: Number(f.cohortYear),
          orgId: scope.orgId,
          branchId: scope.branchId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Enrolled ${f.fullName}. Temporary password: ${d.temporaryPassword}`);
      setF({ email: "", fullName: "", enrollmentDate: "", cohortYear: "" });
      setFieldErrors({});
    } catch {
      setErr("An unexpected error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Enroll student">
      <ScopeHint scope={scope} />
      <form onSubmit={submit} style={formGrid}>
        <div>
          <input
            style={inp}
            placeholder="Email"
            type="email"
            disabled={disabled}
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
          {fieldErrors.email && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.email}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            placeholder="Full name"
            disabled={disabled}
            value={f.fullName}
            onChange={(e) => setF({ ...f, fullName: e.target.value })}
          />
          {fieldErrors.fullName && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.fullName}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            type="date"
            disabled={disabled}
            value={f.enrollmentDate}
            onChange={(e) => setF({ ...f, enrollmentDate: e.target.value })}
          />
          {fieldErrors.enrollmentDate && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.enrollmentDate}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            placeholder="Cohort year (e.g. 2030)"
            type="number"
            disabled={disabled}
            value={f.cohortYear}
            onChange={(e) => setF({ ...f, cohortYear: e.target.value })}
          />
          {fieldErrors.cohortYear && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.cohortYear}
            </p>
          )}
        </div>
        {err && (
          <p role="alert" style={errStyle}>
            {err}
          </p>
        )}
        <button type="submit" disabled={busy || disabled} style={btn(busy || disabled)}>
          {busy ? "Saving…" : "Enroll"}
        </button>
      </form>
    </Section>
  );
}

export function CreateClassForm({
  scope,
  onDone,
}: {
  scope: TenantScope;
  onDone: (m: string) => void;
}) {
  const [f, setF] = useState({ subject: "", term: "", credits: "3" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !scope.branchId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!scope.branchId) {
      setErr("Select a branch first.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/classes/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: f.subject,
          term: f.term,
          credits: Number(f.credits),
          branchId: scope.branchId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Created class "${f.subject}".`);
      setF({ subject: "", term: "", credits: "3" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Create class">
      <ScopeHint scope={scope} />
      <form onSubmit={submit} style={formGrid}>
        <input
          style={inp}
          placeholder="Subject (e.g. Algebra 2)"
          required
          disabled={disabled}
          value={f.subject}
          onChange={(e) => setF({ ...f, subject: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Term (e.g. Fall 2026)"
          required
          disabled={disabled}
          value={f.term}
          onChange={(e) => setF({ ...f, term: e.target.value })}
        />
        <input
          style={inp}
          type="number"
          min={1}
          max={12}
          placeholder="Credits (1-12)"
          required
          disabled={disabled}
          value={f.credits}
          onChange={(e) => setF({ ...f, credits: e.target.value })}
        />
        {err && (
          <p role="alert" style={errStyle}>
            {err}
          </p>
        )}
        <button type="submit" disabled={busy || disabled} style={btn(busy || disabled)}>
          {busy ? "Saving…" : "Create class"}
        </button>
      </form>
    </Section>
  );
}

export function AssignClassForm({
  students,
  classes,
  onDone,
}: {
  students: StudentRow[];
  classes: ClassRow[];
  onDone: (m: string) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [classId, setClassId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!students.some((s) => s.studentProfileId === studentId)) setStudentId("");
  }, [studentId, students]);
  useEffect(() => {
    if (!classes.some((k) => k.id === classId)) setClassId("");
  }, [classId, classes]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/classes/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId, classId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone("Student assigned to class.");
      setStudentId("");
      setClassId("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Assign student to class">
      {students.length === 0 || classes.length === 0 ? (
        <p style={dim}>Add at least one student and one class first.</p>
      ) : (
        <form onSubmit={submit} style={formGrid}>
          <select
            style={inp}
            required
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">Select student…</option>
            {students.map((s) => (
              <option key={s.studentProfileId} value={s.studentProfileId}>
                {s.fullName}
              </option>
            ))}
          </select>
          <select
            style={inp}
            required
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject} ({c.term})
              </option>
            ))}
          </select>
          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}
          <button type="submit" disabled={busy} style={btn(busy)}>
            {busy ? "Saving…" : "Assign"}
          </button>
        </form>
      )}
    </Section>
  );
}

export function AssignStaffForm({
  staff,
  classes,
  onDone,
}: {
  staff: StaffRow[];
  classes: ClassRow[];
  onDone: (m: string) => void;
}) {
  const activeStaff = useMemo(
    () => staff.filter((s) => s.status === "active"),
    [staff],
  );
  const [staffId, setStaffId] = useState("");
  const [classId, setClassId] = useState("");
  const [role, setRole] = useState("lead");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeStaff.some((s) => s.staffProfileId === staffId)) setStaffId("");
  }, [staffId, activeStaff]);
  useEffect(() => {
    if (!classes.some((c) => c.id === classId)) setClassId("");
  }, [classId, classes]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/staff/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staffProfileId: staffId, classId, role }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone("Staff assigned to class.");
      setStaffId("");
      setClassId("");
      setRole("lead");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Assign staff to class">
      {activeStaff.length === 0 || classes.length === 0 ? (
        <p style={dim}>Add at least one active staff member and one class first.</p>
      ) : (
        <form onSubmit={submit} style={formGrid}>
          <select
            style={inp}
            required
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            <option value="">Select staff…</option>
            {activeStaff.map((s) => (
              <option key={s.staffProfileId} value={s.staffProfileId}>
                {s.fullName} ({s.department})
              </option>
            ))}
          </select>
          <select
            style={inp}
            required
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject} ({c.term})
              </option>
            ))}
          </select>
          <select style={inp} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="lead">lead</option>
            <option value="assistant">assistant</option>
          </select>
          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}
          <button type="submit" disabled={busy} style={btn(busy)}>
            {busy ? "Saving…" : "Assign staff"}
          </button>
        </form>
      )}
    </Section>
  );
}

export function Gradebook({
  enrollments,
  onDone,
}: {
  enrollments: EnrollmentRow[];
  onDone: (m: string) => void;
}) {
  const byClass = useMemo(() => {
    const map = new Map<string, EnrollmentRow[]>();
    for (const e of enrollments) {
      const list = map.get(e.classId) ?? [];
      list.push(e);
      map.set(e.classId, list);
    }
    return [...map.values()];
  }, [enrollments]);

  if (enrollments.length === 0) {
    return (
      <p style={dim}>
        No enrollments yet. Assign students to classes first, then grade them here.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {byClass.map((rows) => (
        <div key={rows[0].classId}>
          <strong style={{ fontSize: 13 }}>
            {rows[0].classSubject}{" "}
            <span style={{ opacity: 0.6 }}>
              ({rows[0].term} · {rows[0].credits} cr)
            </span>
          </strong>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              marginTop: 4,
            }}
          >
            <tbody>
              {rows.map((e) => (
                <GradeRow key={e.enrollmentId} e={e} onDone={onDone} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function GradeRow({ e, onDone }: { e: EnrollmentRow; onDone: (m: string) => void }) {
  const [grade, setGrade] = useState(e.finalGrade ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!grade) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/enrollments/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollmentId: e.enrollmentId, finalGrade: grade }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Graded ${e.studentName}: ${grade}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <td style={{ padding: 8 }}>{e.studentName}</td>
      <td style={{ padding: 8 }}>
        <StatusBadge status={e.status} />
      </td>
      <td style={{ padding: 8 }}>
        <select
          style={{ ...inp, padding: "4px 8px" }}
          value={grade}
          onChange={(ev) => setGrade(ev.target.value)}
        >
          <option value="">—</option>
          {VALID_GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: 8 }}>
        <button type="button" onClick={save} disabled={busy || !grade} style={miniBtn}>
          {busy ? "…" : "Save"}
        </button>
        {err && (
          <span style={{ ...errStyle, marginLeft: 6 }} role="alert">
            {err}
          </span>
        )}
      </td>
    </tr>
  );
}

export function PromoteStudentForm({
  students,
  classes,
  onDone,
}: {
  students: StudentRow[];
  classes: ClassRow[];
  onDone: (m: string) => void;
}) {
  const terms = useMemo(
    () => [...new Set(classes.map((c) => c.term))],
    [classes],
  );
  const [studentId, setStudentId] = useState("");
  const [term, setTerm] = useState("");
  const [outcome, setOutcome] = useState("promoted");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!students.some((s) => s.studentProfileId === studentId)) setStudentId("");
  }, [studentId, students]);
  useEffect(() => {
    if (!terms.includes(term)) setTerm("");
  }, [term, terms]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/students/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentProfileId: studentId, term, outcome }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Recorded ${outcome} for ${term}.`);
      setStudentId("");
      setTerm("");
      setOutcome("promoted");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Promote student">
      {students.length === 0 || terms.length === 0 ? (
        <p style={dim}>Add at least one student and one class (term) first.</p>
      ) : (
        <form onSubmit={submit} style={formGrid}>
          <select
            style={inp}
            required
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">Select student…</option>
            {students.map((s) => (
              <option key={s.studentProfileId} value={s.studentProfileId}>
                {s.fullName}
              </option>
            ))}
          </select>
          <select
            style={inp}
            required
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          >
            <option value="">Select term…</option>
            {terms.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select style={inp} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {PROMOTION_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}
          <button type="submit" disabled={busy} style={btn(busy)}>
            {busy ? "Saving…" : "Apply progression"}
          </button>
        </form>
      )}
    </Section>
  );
}

/** Renders an already-loaded transcript payload (shared by manager + student views). */
export function TranscriptCard({ data }: { data: TranscriptData }) {
  const gpa = (v: number | null) => (v === null ? "—" : v.toFixed(2));
  return (
    <div style={tenantCard}>
      <div style={{ marginBottom: 8 }}>
        <strong>{data.student.fullName}</strong> <StatusBadge status={data.student.status} />
        <div style={dim}>
          {data.student.email} · cohort {data.student.cohortYear} · level{" "}
          {data.student.currentLevel} · cumulative GPA {gpa(data.cumulativeGpa)} (
          {data.totalGradedCredits} cr)
          {data.student.graduationDate
            ? ` · graduated ${data.student.graduationDate}`
            : ""}
        </div>
      </div>
      {data.terms.length === 0 ? (
        <p style={dim}>No coursework recorded.</p>
      ) : (
        data.terms.map((t) => (
          <div key={t.term} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {t.term}{" "}
              <span style={{ ...dim, fontWeight: 400 }}>
                — term GPA {gpa(t.termGpa)} ({t.gradedCredits} cr)
              </span>
            </div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12 }}>
              {t.courses.map((c, i) => (
                <li key={i}>
                  {c.subject} ({c.credits} cr) — {c.grade ?? "ungraded"}{" "}
                  <span style={{ opacity: 0.5 }}>[{c.status}]</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {data.promotions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Progression history</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12 }}>
            {data.promotions.map((p, i) => (
              <li key={i}>
                {p.term}: {p.outcome} (level {p.fromLevel} → {p.toLevel}
                {p.termGpa ? `, GPA ${p.termGpa}` : ""})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TranscriptViewer({ students }: { students: StudentRow[] }) {
  const [studentId, setStudentId] = useState("");
  const [data, setData] = useState<TranscriptData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function view() {
    if (!studentId) return;
    setBusy(true);
    setErr(null);
    setData(null);
    try {
      const res = await fetch(`/api/students/${studentId}/transcript`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      setData(d);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Transcript">
      {students.length === 0 ? (
        <p style={dim}>No students to show a transcript for yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              style={{ ...inp, flex: 1 }}
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                setData(null);
              }}
            >
              <option value="">Select student…</option>
              {students.map((s) => (
                <option key={s.studentProfileId} value={s.studentProfileId}>
                  {s.fullName}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={view}
              disabled={busy || !studentId}
              style={{ ...btn(busy || !studentId), width: "auto", padding: "0 16px" }}
            >
              {busy ? "Loading…" : "View"}
            </button>
          </div>
          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}
          {data && <TranscriptCard data={data} />}
        </div>
      )}
    </Section>
  );
}

export function TutorPanel({ classes }: { classes: ClassRow[] }) {
  const [classId, setClassId] = useState("");
  const [query, setQuery] = useState("");
  const [whiteboard, setWhiteboard] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [contextSource, setContextSource] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!classes.some((k) => k.id === classId)) setClassId("");
  }, [classId, classes]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setAnswer(null);
    setContextSource(null);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/tutor-copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classId,
          query,
          whiteboardContext: whiteboard || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d) + " (is GEMMA_API_KEY configured?)");
      setAnswer(d.answer);
      setContextSource(typeof d.contextSource === "string" ? d.contextSource : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="AI Tutor (Gemma)">
      {classes.length === 0 ? (
        <p style={dim}>Create a class first to scope a tutor question.</p>
      ) : (
        <form onSubmit={submit} style={{ ...formGrid, maxWidth: 560 }}>
          <select
            style={inp}
            required
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject} ({c.term})
              </option>
            ))}
          </select>
          <textarea
            style={{ ...inp, minHeight: 64, fontFamily: "inherit" }}
            placeholder="Question for the tutor (e.g. Find the determinant of [[2,1],[1,3]])"
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <textarea
            style={{ ...inp, minHeight: 48, fontFamily: "inherit" }}
            placeholder="Optional whiteboard context"
            value={whiteboard}
            onChange={(e) => setWhiteboard(e.target.value)}
          />
          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}
          <button type="submit" disabled={busy} style={btn(busy)}>
            {busy ? "Asking Gemma…" : "Ask tutor"}
          </button>
          {answer && (
            <>
              {contextSource && contextSource !== "none" && <ContextBadge source={contextSource} />}
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  background: "#11162a",
                  padding: 12,
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                {answer}
              </pre>
            </>
          )}
        </form>
      )}
    </Section>
  );
}

/** Shows whether the tutor answer used the live whiteboard or a local fallback. */
function ContextBadge({ source }: { source: string }) {
  const live = source === "server";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        alignSelf: "flex-start",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color: live ? "#9be8b4" : "#ffcf8f",
        background: live ? "rgba(155,232,180,0.12)" : "rgba(255,207,143,0.12)",
        border: `1px solid ${live ? "rgba(155,232,180,0.4)" : "rgba(255,207,143,0.4)"}`,
      }}
      title={live ? "Read live from the class whiteboard's Durable Object" : "Live board unavailable — used the context you typed"}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: live ? "#9be8b4" : "#ffcf8f" }} />
      {live ? "Context: Live Board" : "Context: Local Fallback"}
    </span>
  );
}

export function CreateOrganizationForm({
  onCreated,
}: {
  onCreated: (org: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onCreated(d);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...formGrid, marginTop: 8, maxWidth: "none" }}>
      <input
        style={inp}
        placeholder="Organization name (e.g. West Network)"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {err && (
        <p role="alert" style={errStyle}>
          {err}
        </p>
      )}
      <button type="submit" disabled={busy} style={btn(busy)}>
        {busy ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}

export function CreateBranchForm({
  orgId,
  orgName,
  onCreated,
}: {
  orgId: string | null;
  orgName: string | null;
  onCreated: (branch: { id: string; orgId: string; location: string }) => void;
}) {
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("active");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !orgId;

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!location.trim()) errors.location = "Branch location is required";
    else if (location.length > 512)
      errors.location = "Location must be 512 characters or less";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) {
      setErr("Select an organization first.");
      return;
    }
    if (!validateForm()) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, location: location.trim(), status }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onCreated(d);
      setLocation("");
      setStatus("active");
      setFieldErrors({});
    } catch {
      setErr("An unexpected error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...formGrid, marginTop: 8, maxWidth: "none" }}>
      <p style={{ ...dim, margin: 0 }}>
        {orgId
          ? `Adds a branch to ${orgName ?? "the selected organization"}.`
          : "Select an organization above to add a branch."}
      </p>
      <div>
        <input
          style={inp}
          placeholder="Branch location (e.g. Riverside Campus)"
          disabled={disabled}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        {fieldErrors.location && (
          <p role="alert" style={fieldErrorStyle}>
            {fieldErrors.location}
          </p>
        )}
      </div>
      <select
        style={inp}
        disabled={disabled}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="active">active</option>
        <option value="pending">pending</option>
        <option value="inactive">inactive</option>
      </select>
      {err && (
        <p role="alert" style={errStyle}>
          {err}
        </p>
      )}
      <button type="submit" disabled={busy || disabled} style={btn(busy || disabled)}>
        {busy ? "Creating…" : "Create branch"}
      </button>
    </form>
  );
}

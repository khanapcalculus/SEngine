"use client";

/**
 * Authenticated admin dashboard. Standard, minimal UI (Guideline #2).
 *
 * Sections (all wired to the live APIs, org/branch taken from the verified
 * session — never typed by hand):
 *   - Staff roster        GET  /api/staff/branch/[branchId]
 *   - Student roster      GET  /api/students/branch/[branchId]
 *   - Classes             GET  /api/classes/branch/[branchId] + POST create/assign
 *   - AI Tutor (Gemma)    POST /api/ai/tutor-copilot
 *   - Audit log           GET  /api/audit/branch/[branchId]   (admins/managers)
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface Me {
  userId: string;
  role: string;
  orgId: string | null;
  branchId: string | null;
}
interface StaffRow {
  staffProfileId: string;
  fullName: string;
  email: string;
  department: string;
  status: string;
}
interface StudentRow {
  studentProfileId: string;
  fullName: string;
  email: string;
  cohortYear: number;
  status: string;
}
interface ClassRow {
  id: string;
  subject: string;
  term: string;
}
interface AuditRow {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
}

const isManager = (role?: string) =>
  role === "super_admin" || role === "branch_manager";

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);

  const branchId = me?.branchId ?? null;

  const refresh = useCallback(async (bid: string, role: string) => {
    const get = async (url: string) => {
      const r = await fetch(url);
      return r.ok ? r.json() : null;
    };
    const [s, st, c] = await Promise.all([
      get(`/api/staff/branch/${bid}`),
      get(`/api/students/branch/${bid}`),
      get(`/api/classes/branch/${bid}`),
    ]);
    if (s) setStaff(s.staff);
    if (st) setStudents(st.students);
    if (c) setClasses(c.classes);
    if (isManager(role)) {
      const a = await get(`/api/audit/branch/${bid}`);
      if (a) setAudit(a.entries);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        router.replace("/login");
        return;
      }
      const data: Me = await res.json();
      setMe(data);
      setLoading(false);
      if (data.branchId) refresh(data.branchId, data.role);
    })();
  }, [router, refresh]);

  const reload = () => branchId && me && refresh(branchId, me.role);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  function flash(msg: string) {
    setNotice(msg);
    reload();
  }

  if (loading) {
    return (
      <main style={page}>
        <p style={{ opacity: 0.6 }}>Loading…</p>
      </main>
    );
  }

  return (
    <main style={page}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Dashboard</h1>
        <span style={{ fontSize: 13, opacity: 0.6 }}>
          {me?.role} · branch {branchId?.slice(0, 8) ?? "—"}
        </span>
        <button
          onClick={logout}
          style={{ ...btn(false), marginLeft: "auto", width: "auto", padding: "6px 12px" }}
        >
          Sign out
        </button>
      </header>

      {notice && (
        <p
          style={{
            background: "#13351f",
            color: "#9be8b4",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {notice}
        </p>
      )}

      {!branchId && (
        <p style={{ color: "#ffcf8f", fontSize: 13 }}>
          This account has no branch assigned, so branch-scoped lists are empty.
        </p>
      )}

      {/* ── Rosters ── */}
      <Section title="Staff roster">
        <Roster
          rows={staff.map((s) => [s.fullName, s.email, s.department, s.status])}
          head={["Name", "Email", "Dept", "Status"]}
          empty="No active staff in this branch yet."
          keyOf={(_r, i) => staff[i].staffProfileId}
        />
      </Section>

      <Section title="Student roster">
        <Roster
          rows={students.map((s) => [
            s.fullName,
            s.email,
            String(s.cohortYear),
            s.status,
          ])}
          head={["Name", "Email", "Cohort", "Status"]}
          empty="No active students in this branch yet."
          keyOf={(_r, i) => students[i].studentProfileId}
        />
      </Section>

      {/* ── Classes ── */}
      <Section title="Classes">
        {classes.length === 0 ? (
          <p style={dim}>No classes yet.</p>
        ) : (
          <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13 }}>
            {classes.map((c) => (
              <li key={c.id}>
                {c.subject} — <span style={{ opacity: 0.6 }}>{c.term}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Forms ── */}
      <OnboardStaffForm me={me!} onDone={flash} />
      <EnrollStudentForm me={me!} onDone={flash} />
      {isManager(me?.role) && <CreateClassForm me={me!} onDone={flash} />}
      <AssignClassForm students={students} classes={classes} onDone={flash} />

      {/* ── AI Tutor ── */}
      <TutorPanel classes={classes} />

      {/* ── Audit ── */}
      {isManager(me?.role) && (
        <Section title="Audit log">
          {audit.length === 0 ? (
            <p style={dim}>No audit entries yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12 }}>
              {audit.map((a) => (
                <li
                  key={a.id}
                  style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <code style={{ color: "#7fd1ff", marginRight: 8 }}>{a.action}</code>
                  {a.summary}
                  <span style={{ opacity: 0.4, marginLeft: 8 }}>
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </main>
  );
}

/* ───────────────────────────── Forms ───────────────────────────── */
function OnboardStaffForm({ me, onDone }: { me: Me; onDone: (m: string) => void }) {
  const [f, setF] = useState({ email: "", fullName: "", department: "", hireDate: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/staff/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, orgId: me.orgId, branchId: me.branchId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Onboarded ${f.fullName}.`);
      setF({ email: "", fullName: "", department: "", hireDate: "" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Onboard staff">
      <form onSubmit={submit} style={formGrid}>
        <input style={inp} placeholder="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input style={inp} placeholder="Full name" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        <input style={inp} placeholder="Department" required value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
        <input style={inp} type="date" required value={f.hireDate} onChange={(e) => setF({ ...f, hireDate: e.target.value })} />
        {err && <p role="alert" style={errStyle}>{err}</p>}
        <button type="submit" disabled={busy} style={btn(busy)}>{busy ? "Saving…" : "Onboard"}</button>
      </form>
    </Section>
  );
}

function EnrollStudentForm({ me, onDone }: { me: Me; onDone: (m: string) => void }) {
  const [f, setF] = useState({ email: "", fullName: "", enrollmentDate: "", cohortYear: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/students/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: f.email, fullName: f.fullName, enrollmentDate: f.enrollmentDate,
          cohortYear: Number(f.cohortYear), orgId: me.orgId, branchId: me.branchId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Enrolled ${f.fullName}.`);
      setF({ email: "", fullName: "", enrollmentDate: "", cohortYear: "" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Enroll student">
      <form onSubmit={submit} style={formGrid}>
        <input style={inp} placeholder="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input style={inp} placeholder="Full name" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        <input style={inp} type="date" required value={f.enrollmentDate} onChange={(e) => setF({ ...f, enrollmentDate: e.target.value })} />
        <input style={inp} placeholder="Cohort year (e.g. 2030)" type="number" required value={f.cohortYear} onChange={(e) => setF({ ...f, cohortYear: e.target.value })} />
        {err && <p role="alert" style={errStyle}>{err}</p>}
        <button type="submit" disabled={busy} style={btn(busy)}>{busy ? "Saving…" : "Enroll"}</button>
      </form>
    </Section>
  );
}

function CreateClassForm({ me, onDone }: { me: Me; onDone: (m: string) => void }) {
  const [f, setF] = useState({ subject: "", term: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/classes/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, branchId: me.branchId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Created class "${f.subject}".`);
      setF({ subject: "", term: "" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Create class">
      <form onSubmit={submit} style={formGrid}>
        <input style={inp} placeholder="Subject (e.g. Algebra 2)" required value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
        <input style={inp} placeholder="Term (e.g. Fall 2026)" required value={f.term} onChange={(e) => setF({ ...f, term: e.target.value })} />
        {err && <p role="alert" style={errStyle}>{err}</p>}
        <button type="submit" disabled={busy} style={btn(busy)}>{busy ? "Saving…" : "Create class"}</button>
      </form>
    </Section>
  );
}

function AssignClassForm({
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
          <select style={inp} required value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select student…</option>
            {students.map((s) => (
              <option key={s.studentProfileId} value={s.studentProfileId}>{s.fullName}</option>
            ))}
          </select>
          <select style={inp} required value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.subject} ({c.term})</option>
            ))}
          </select>
          {err && <p role="alert" style={errStyle}>{err}</p>}
          <button type="submit" disabled={busy} style={btn(busy)}>{busy ? "Saving…" : "Assign"}</button>
        </form>
      )}
    </Section>
  );
}

function TutorPanel({ classes }: { classes: ClassRow[] }) {
  const [classId, setClassId] = useState("");
  const [query, setQuery] = useState("");
  const [whiteboard, setWhiteboard] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setAnswer(null);
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
          <select style={inp} required value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.subject} ({c.term})</option>
            ))}
          </select>
          <textarea style={{ ...inp, minHeight: 64, fontFamily: "inherit" }} placeholder="Question for the tutor (e.g. Find the determinant of [[2,1],[1,3]])" required value={query} onChange={(e) => setQuery(e.target.value)} />
          <textarea style={{ ...inp, minHeight: 48, fontFamily: "inherit" }} placeholder="Optional whiteboard context" value={whiteboard} onChange={(e) => setWhiteboard(e.target.value)} />
          {err && <p role="alert" style={errStyle}>{err}</p>}
          <button type="submit" disabled={busy} style={btn(busy)}>{busy ? "Asking Gemma…" : "Ask tutor"}</button>
          {answer && (
            <pre style={{ whiteSpace: "pre-wrap", background: "#11162a", padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.5, margin: 0 }}>
              {answer}
            </pre>
          )}
        </form>
      )}
    </Section>
  );
}

/* ───────────────────────────── Shared ──────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, opacity: 0.85, marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  );
}

function Roster({
  rows,
  head,
  empty,
  keyOf,
}: {
  rows: string[][];
  head: string[];
  empty: string;
  keyOf: (row: string[], i: number) => string;
}) {
  if (rows.length === 0) return <p style={dim}>{empty}</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: "left", opacity: 0.6 }}>
          {head.map((h) => (
            <th key={h} style={{ padding: "6px 8px", fontWeight: 500 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={keyOf(r, i)} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {r.map((cell, j) => (
              <td key={j} style={{ padding: 8 }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmtErr(d: { error?: string; fields?: Record<string, string> }): string {
  if (d.fields) return Object.entries(d.fields).map(([k, v]) => `${k}: ${v}`).join("; ");
  return d.error ?? "Request failed";
}

const page: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "40px 24px" };
const dim: React.CSSProperties = { opacity: 0.55, fontSize: 13 };
const formGrid: React.CSSProperties = { display: "grid", gap: 10, maxWidth: 420 };
const inp: React.CSSProperties = {
  padding: "9px 11px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
  background: "#11162a", color: "#e6e9f2", fontSize: 13,
};
const errStyle: React.CSSProperties = { color: "#ff8080", fontSize: 13, margin: 0 };
function btn(busy: boolean): React.CSSProperties {
  return {
    padding: "10px 12px", borderRadius: 8, border: "none",
    background: busy ? "#3a4570" : "#5570ff", color: "white",
    fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", width: "100%",
  };
}

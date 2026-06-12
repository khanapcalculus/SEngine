"use client";

/**
 * Authenticated admin dashboard. Standard, minimal UI (Guideline #2).
 *
 * On mount it calls /api/auth/me to confirm the session (redirecting to /login
 * if absent) and to read the caller's org/branch. It then loads the branch
 * staff roster and exposes two forms wired to the existing APIs:
 *   - Onboard staff   -> POST /api/staff/onboard
 *   - Enroll student  -> POST /api/students/enroll
 * org_id / branch_id are taken from the verified session, never typed by hand.
 */
import { useEffect, useState, type FormEvent } from "react";
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

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // --- auth gate + initial load ---
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
    })();
  }, [router]);

  async function refreshRoster(branchId: string) {
    const res = await fetch(`/api/staff/branch/${branchId}`);
    if (res.ok) {
      const data = await res.json();
      setStaff(data.staff ?? []);
    }
  }

  useEffect(() => {
    if (me?.branchId) refreshRoster(me.branchId);
  }, [me?.branchId]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (loading) {
    return <main style={page}><p style={{ opacity: 0.6 }}>Loading…</p></main>;
  }

  return (
    <main style={page}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Dashboard</h1>
        <span style={{ fontSize: 13, opacity: 0.6 }}>
          {me?.role} · branch {me?.branchId?.slice(0, 8) ?? "—"}
        </span>
        <button onClick={logout} style={{ ...btn(false), marginLeft: "auto", width: "auto", padding: "6px 12px" }}>
          Sign out
        </button>
      </header>

      {notice && (
        <p style={{ background: "#13351f", color: "#9be8b4", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
          {notice}
        </p>
      )}

      <Section title={`Staff roster${me?.branchId ? "" : " (no branch on this account)"}`}>
        {staff.length === 0 ? (
          <p style={{ opacity: 0.55, fontSize: 13 }}>No active staff in this branch yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.6 }}>
                <th style={th}>Name</th><th style={th}>Email</th><th style={th}>Dept</th><th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.staffProfileId} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <td style={td}>{s.fullName}</td>
                  <td style={td}>{s.email}</td>
                  <td style={td}>{s.department}</td>
                  <td style={td}>{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <OnboardStaffForm
        me={me!}
        onDone={(msg) => {
          setNotice(msg);
          if (me?.branchId) refreshRoster(me.branchId);
        }}
      />

      <EnrollStudentForm me={me!} onDone={setNotice} />
    </main>
  );
}

/* ────────────────────────── Onboard staff form ─────────────────── */
function OnboardStaffForm({ me, onDone }: { me: Me; onDone: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("");
  const [hireDate, setHireDate] = useState("");
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
        body: JSON.stringify({
          email, fullName, department, hireDate,
          orgId: me.orgId, branchId: me.branchId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(formatErr(data)); return; }
      onDone(`Onboarded ${fullName} (${email}).`);
      setEmail(""); setFullName(""); setDepartment(""); setHireDate("");
    } finally { setBusy(false); }
  }

  return (
    <Section title="Onboard staff">
      <form onSubmit={submit} style={formGrid}>
        <input style={inp} placeholder="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={inp} placeholder="Full name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <input style={inp} placeholder="Department" required value={department} onChange={(e) => setDepartment(e.target.value)} />
        <input style={inp} type="date" required value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
        {err && <p role="alert" style={errStyle}>{err}</p>}
        <button type="submit" disabled={busy} style={btn(busy)}>{busy ? "Saving…" : "Onboard"}</button>
      </form>
    </Section>
  );
}

/* ────────────────────────── Enroll student form ────────────────── */
function EnrollStudentForm({ me, onDone }: { me: Me; onDone: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState("");
  const [cohortYear, setCohortYear] = useState("");
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
          email, fullName, enrollmentDate,
          cohortYear: Number(cohortYear),
          orgId: me.orgId, branchId: me.branchId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(formatErr(data)); return; }
      onDone(`Enrolled ${fullName} (cohort ${cohortYear}).`);
      setEmail(""); setFullName(""); setEnrollmentDate(""); setCohortYear("");
    } finally { setBusy(false); }
  }

  return (
    <Section title="Enroll student">
      <form onSubmit={submit} style={formGrid}>
        <input style={inp} placeholder="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={inp} placeholder="Full name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <input style={inp} type="date" required value={enrollmentDate} onChange={(e) => setEnrollmentDate(e.target.value)} />
        <input style={inp} placeholder="Cohort year (e.g. 2030)" type="number" required value={cohortYear} onChange={(e) => setCohortYear(e.target.value)} />
        {err && <p role="alert" style={errStyle}>{err}</p>}
        <button type="submit" disabled={busy} style={btn(busy)}>{busy ? "Saving…" : "Enroll"}</button>
      </form>
    </Section>
  );
}

/* ────────────────────────────── shared ─────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, opacity: 0.85, marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  );
}

function formatErr(data: { error?: string; fields?: Record<string, string> }): string {
  if (data.fields) {
    return Object.entries(data.fields).map(([k, v]) => `${k}: ${v}`).join("; ");
  }
  return data.error ?? "Request failed";
}

const page: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "40px 24px" };
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "8px" };
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

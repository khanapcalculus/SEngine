"use client";

/**
 * Admissions — managers run the applicant funnel for their branch: capture an
 * application, move it under_review → accepted/rejected, then enroll an accepted
 * applicant (which creates a real student account and returns a temp password).
 */
import { useCallback, useEffect, useState } from "react";
import { RoleGuard } from "../_components/RoleGuard";
import { useDashboard } from "../DashboardProvider";
import {
  Section,
  dim,
  labelStyle,
  inp,
  errStyle,
  successStyle,
  miniBtn,
  StatusBadge,
} from "../_components/ui";

const MANAGERS = ["super_admin", "branch_manager"] as const;

interface Application {
  id: string;
  applicantName: string;
  applicantEmail: string;
  cohortYear: number;
  status: string;
  examScore: number | null;
  studentProfileId: string | null;
}

export default function AdmissionsPage() {
  return (
    <RoleGuard allow={[...MANAGERS]}>
      <AdmissionsInner />
    </RoleGuard>
  );
}

function AdmissionsInner() {
  const { scope } = useDashboard();
  const branchId = scope.branchId;

  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cohortYear, setCohortYear] = useState(new Date().getFullYear());
  const [examScore, setExamScore] = useState("");

  const load = useCallback(async () => {
    if (!branchId) {
      setApps([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const r = await fetch(`/api/admissions/branch/${branchId}`);
    const d = await r.json().catch(() => ({}));
    setApps(r.ok && Array.isArray(d.applications) ? d.applications : []);
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const errMsg = (d: { error?: string; fields?: Record<string, string> }) =>
    d.fields ? Object.values(d.fields).join("; ") : d.error ?? "Request failed.";

  const create = async () => {
    setError(null);
    setNotice(null);
    const r = await fetch("/api/admissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        branchId,
        applicantName: name.trim(),
        applicantEmail: email.trim(),
        cohortYear,
        examScore: examScore ? Number(examScore) : undefined,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(errMsg(d));
    setName("");
    setEmail("");
    setExamScore("");
    setNotice("Application added.");
    void load();
  };

  const decide = async (id: string, status: string) => {
    setError(null);
    const r = await fetch(`/api/admissions/${id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(errMsg(d));
    setNotice(`Application ${status}.`);
    void load();
  };

  const enroll = async (id: string) => {
    setError(null);
    const r = await fetch(`/api/admissions/${id}/enroll`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(errMsg(d));
    setNotice(`Enrolled — temporary password: ${d.temporaryPassword} (share securely with ${d.email}).`);
    void load();
  };

  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Admissions</h1>
      <p style={dim}>Capture applications, review, and enroll accepted applicants.</p>

      {notice && <p style={{ ...successStyle, marginTop: 12 }}>{notice}</p>}
      {error && <p style={{ ...errStyle, marginTop: 12 }}>{error}</p>}

      {!branchId ? (
        <p style={{ ...dim, marginTop: 20 }}>Select a branch to manage admissions.</p>
      ) : (
        <>
          <Section title="New application">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
              <label style={labelStyle}>Name<input style={inp} value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label style={labelStyle}>Email<input style={inp} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <label style={labelStyle}>Cohort year<input type="number" style={{ ...inp, width: 110 }} value={cohortYear} onChange={(e) => setCohortYear(Number(e.target.value))} /></label>
              <label style={labelStyle}>Exam score<input type="number" style={{ ...inp, width: 110 }} value={examScore} onChange={(e) => setExamScore(e.target.value)} placeholder="optional" /></label>
              <button type="button" style={primary} onClick={create} disabled={!name.trim() || !email.trim()}>Add</button>
            </div>
          </Section>

          <Section title="Applications">
            {loading ? (
              <p style={dim}>Loading…</p>
            ) : apps.length === 0 ? (
              <p style={dim}>No applications yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.6 }}>
                    <th style={th}>Applicant</th><th style={th}>Cohort</th><th style={th}>Exam</th><th style={th}>Status</th><th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => (
                    <tr key={a.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      <td style={td}>{a.applicantName}<div style={{ ...dim, opacity: 0.6 }}>{a.applicantEmail}</div></td>
                      <td style={td}>{a.cohortYear}</td>
                      <td style={td}>{a.examScore ?? "—"}</td>
                      <td style={td}><StatusBadge status={a.status} /></td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {a.status !== "enrolled" && (
                          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                            {a.status === "submitted" && (
                              <button type="button" style={miniBtn} onClick={() => decide(a.id, "under_review")}>Review</button>
                            )}
                            {a.status !== "accepted" && a.status !== "rejected" && (
                              <button type="button" style={{ ...miniBtn, color: "#9be8b4" }} onClick={() => decide(a.id, "accepted")}>Accept</button>
                            )}
                            {a.status !== "rejected" && (
                              <button type="button" style={{ ...miniBtn, color: "#ff8080" }} onClick={() => decide(a.id, "rejected")}>Reject</button>
                            )}
                            {a.status === "accepted" && (
                              <button type="button" style={{ ...miniBtn, background: "#5570ff", color: "#fff", borderColor: "#5570ff" }} onClick={() => enroll(a.id)}>Enroll →</button>
                            )}
                          </span>
                        )}
                        {a.status === "enrolled" && <span style={dim}>student created</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </>
  );
}

const primary: React.CSSProperties = {
  padding: "9px 14px", borderRadius: 8, border: "none", background: "#5570ff",
  color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", height: 38,
};
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "8px 8px" };

"use client";

/**
 * Guardians — managers link parent accounts to students so parents can view
 * their children. The parent account must already exist (with the parent role);
 * this only creates the link. Branch-scoped via the dashboard scope.
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
  isManager,
} from "../_components/ui";
import { GUARDIAN_RELATIONSHIPS } from "../../../lib/validation";

const MANAGERS = ["super_admin", "branch_manager"] as const;

interface GuardianRow {
  id: string;
  parentName: string;
  parentEmail: string;
  studentName: string;
  studentProfileId: string;
  relationship: string;
}

export default function GuardiansPage() {
  return (
    <RoleGuard allow={[...MANAGERS]}>
      <GuardiansInner />
    </RoleGuard>
  );
}

function GuardiansInner() {
  const { scope, students, me } = useDashboard();
  const branchId = scope.branchId;
  const canManage = isManager(me.role);

  const [rows, setRows] = useState<GuardianRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [parentEmail, setParentEmail] = useState("");
  const [studentProfileId, setStudentProfileId] = useState("");
  const [relationship, setRelationship] = useState<string>("guardian");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const r = await fetch(`/api/guardians/branch/${branchId}`);
    const d = await r.json().catch(() => ({}));
    setRows(r.ok && Array.isArray(d.guardians) ? d.guardians : []);
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!studentProfileId && students.length > 0)
      setStudentProfileId(students[0].studentProfileId);
  }, [students, studentProfileId]);

  const submit = async () => {
    setError(null);
    setNotice(null);
    const r = await fetch("/api/guardians", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentEmail: parentEmail.trim(), studentProfileId, relationship }),
    });
    setSubmitting(true);
    const d = await r.json().catch(() => ({}));
    setSubmitting(false);
    if (!r.ok) {
      setError(d.fields ? Object.values(d.fields).join("; ") : d.error ?? "Could not link.");
      return;
    }
    setNotice(`Linked ${parentEmail} to ${d.parentName ? "" : ""}the student.`);
    setParentEmail("");
    void load();
  };

  const unlink = async (id: string) => {
    if (!window.confirm("Remove this guardian link?")) return;
    const r = await fetch(`/api/guardians/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "Could not remove link.");
      return;
    }
    setNotice("Removed guardian link.");
    void load();
  };

  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Guardians</h1>
      <p style={dim}>Link parent accounts to students. Parents then see their children under “My Children”.</p>

      {notice && <p style={{ ...successStyle, marginTop: 12 }}>{notice}</p>}
      {error && <p style={{ ...errStyle, marginTop: 12 }}>{error}</p>}

      {!branchId ? (
        <p style={{ ...dim, marginTop: 20 }}>Select a branch to manage guardians.</p>
      ) : (
        <>
          {canManage && (
            <Section title="Link a parent">
              <div style={{ display: "grid", gap: 10, maxWidth: 440 }}>
                <label style={labelStyle}>
                  Parent email
                  <input
                    style={inp}
                    value={parentEmail}
                    placeholder="parent@example.com"
                    onChange={(e) => setParentEmail(e.target.value)}
                  />
                </label>
                <label style={labelStyle}>
                  Student
                  {students.length === 0 ? (
                    <span style={dim}>No active students in this branch.</span>
                  ) : (
                    <select style={inp} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
                      {students.map((s) => (
                        <option key={s.studentProfileId} value={s.studentProfileId}>
                          {s.fullName} ({s.email})
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <label style={labelStyle}>
                  Relationship
                  <select style={inp} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                    {GUARDIAN_RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting || students.length === 0 || !parentEmail.trim()}
                  style={{
                    padding: "9px 14px",
                    borderRadius: 8,
                    border: "none",
                    background:
                      submitting || students.length === 0 || !parentEmail.trim()
                        ? "rgba(85,112,255,0.4)"
                        : "#5570ff",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: submitting ? "default" : "pointer",
                    justifySelf: "start",
                  }}
                >
                  {submitting ? "Linking…" : "Link parent"}
                </button>
              </div>
            </Section>
          )}

          <Section title="Existing links">
            {loading ? (
              <p style={dim}>Loading…</p>
            ) : rows.length === 0 ? (
              <p style={dim}>No guardian links in this branch yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.6 }}>
                    <th style={th}>Parent</th>
                    <th style={th}>Email</th>
                    <th style={th}>Student</th>
                    <th style={th}>Relationship</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => (
                    <tr key={g.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      <td style={td}>{g.parentName}</td>
                      <td style={td}>{g.parentEmail}</td>
                      <td style={td}>{g.studentName}</td>
                      <td style={td}>{g.relationship}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {canManage && (
                          <button type="button" style={{ ...miniBtn, color: "#ff8080" }} onClick={() => unlink(g.id)}>
                            Unlink
                          </button>
                        )}
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

const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "8px 8px" };

"use client";

/**
 * Alumni — managers graduate active students (issuing a verifiable credential)
 * and review the branch's alumni with their diploma serials. Each serial can be
 * confirmed by anyone at the public /verify page.
 */
import { useCallback, useEffect, useState } from "react";
import { RoleGuard } from "../_components/RoleGuard";
import { useDashboard } from "../DashboardProvider";
import { Section, dim, errStyle, successStyle, miniBtn } from "../_components/ui";

const MANAGERS = ["super_admin", "branch_manager"] as const;

interface AlumniRow {
  studentProfileId: string;
  fullName: string;
  email: string;
  graduationDate: string | null;
  title: string | null;
  serial: string | null;
  issuedDate: string | null;
}

export default function AlumniPage() {
  return (
    <RoleGuard allow={[...MANAGERS]}>
      <AlumniInner />
    </RoleGuard>
  );
}

function AlumniInner() {
  const { scope, students, reload } = useDashboard();
  const branchId = scope.branchId;
  const [alumni, setAlumni] = useState<AlumniRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branchId) {
      setAlumni([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const r = await fetch(`/api/alumni/branch/${branchId}`);
    const d = await r.json().catch(() => ({}));
    setAlumni(r.ok && Array.isArray(d.alumni) ? d.alumni : []);
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const errMsg = (d: { error?: string; fields?: Record<string, string> }) =>
    d.fields ? Object.values(d.fields).join("; ") : d.error ?? "Request failed.";

  const graduate = async (studentProfileId: string, name: string) => {
    const title = window.prompt(`Credential title to issue to ${name}:`, "High School Diploma");
    if (title === null) return;
    if (!title.trim()) {
      setError("A credential title is required.");
      return;
    }
    setError(null);
    const r = await fetch(`/api/students/${studentProfileId}/graduate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(errMsg(d));
    setNotice(`${name} graduated. Credential serial: ${d.serial}`);
    reload(); // refresh the active-students list (they're no longer active)
    void load();
  };

  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Alumni</h1>
      <p style={dim}>
        Graduate students and issue credentials. Anyone can confirm a credential at{" "}
        <a href="/verify" style={{ color: "#7fb0ff" }}>/verify</a>.
      </p>

      {notice && <p style={{ ...successStyle, marginTop: 12 }}>{notice}</p>}
      {error && <p style={{ ...errStyle, marginTop: 12 }}>{error}</p>}

      {!branchId ? (
        <p style={{ ...dim, marginTop: 20 }}>Select a branch to manage alumni.</p>
      ) : (
        <>
          <Section title="Graduate an active student">
            {students.length === 0 ? (
              <p style={dim}>No active students in this branch.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                {students.map((s) => (
                  <li key={s.studentProfileId} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ flex: 1 }}>{s.fullName} <span style={{ ...dim, opacity: 0.6 }}>({s.email})</span></span>
                    <button type="button" style={miniBtn} onClick={() => graduate(s.studentProfileId, s.fullName)}>
                      Graduate & issue diploma
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Alumni">
            {loading ? (
              <p style={dim}>Loading…</p>
            ) : alumni.length === 0 ? (
              <p style={dim}>No alumni yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.6 }}>
                    <th style={th}>Name</th><th style={th}>Graduated</th><th style={th}>Credential</th><th style={th}>Serial</th>
                  </tr>
                </thead>
                <tbody>
                  {alumni.map((a, i) => (
                    <tr key={`${a.studentProfileId}-${i}`} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      <td style={td}>{a.fullName}<div style={{ ...dim, opacity: 0.6 }}>{a.email}</div></td>
                      <td style={td}>{a.graduationDate ?? "—"}</td>
                      <td style={td}>{a.title ?? "—"}</td>
                      <td style={{ ...td, fontFamily: "monospace" }}>
                        {a.serial ? (
                          <a href={`/verify?serial=${encodeURIComponent(a.serial)}`} style={{ color: "#7fb0ff" }}>{a.serial}</a>
                        ) : "—"}
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

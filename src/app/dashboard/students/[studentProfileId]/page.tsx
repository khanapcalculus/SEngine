"use client";

/**
 * Student 360 — a manager's consolidated view of one student: transcript, fee
 * invoices, issued credentials, and linked guardians. Each panel reads its own
 * branch-scoped endpoint; guardians are filtered from the branch guardian list.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { RoleGuard } from "../../_components/RoleGuard";
import { useDashboard } from "../../DashboardProvider";
import { TranscriptCard } from "../../_components/forms";
import { Section, dim, type TranscriptData } from "../../_components/ui";

const MANAGERS = ["super_admin", "branch_manager"] as const;

interface Invoice { id: string; description: string; amountDue: string; amountPaid: string; currency: string; status: string; dueDate: string | null }
interface Credential { id: string; title: string; program: string | null; serial: string; gpa: string | null; issuedDate: string }
interface Guardian { id: string; parentName: string; parentEmail: string; studentProfileId: string; relationship: string }

export default function StudentProfilePage() {
  return (
    <RoleGuard allow={[...MANAGERS]}>
      <StudentProfileInner />
    </RoleGuard>
  );
}

function StudentProfileInner() {
  const params = useParams();
  const id = typeof params.studentProfileId === "string"
    ? params.studentProfileId
    : Array.isArray(params.studentProfileId) ? params.studentProfileId[0] : "";
  const { scope } = useDashboard();

  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const get = async (u: string) => {
      const r = await fetch(u);
      return r.ok ? r.json() : null;
    };
    const [tr, fees, creds, guards] = await Promise.all([
      get(`/api/students/${id}/transcript`),
      get(`/api/fees/invoices/student/${id}`),
      get(`/api/students/${id}/credentials`),
      scope.branchId ? get(`/api/guardians/branch/${scope.branchId}`) : Promise.resolve(null),
    ]);
    setTranscript(tr ?? null);
    setInvoices(Array.isArray(fees?.invoices) ? fees.invoices : []);
    setCredentials(Array.isArray(creds?.credentials) ? creds.credentials : []);
    setGuardians(
      Array.isArray(guards?.guardians)
        ? guards.guardians.filter((g: Guardian) => g.studentProfileId === id)
        : [],
    );
    setLoading(false);
  }, [id, scope.branchId]);

  useEffect(() => { void load(); }, [load]);

  const name = transcript?.student?.fullName ?? "Student";

  return (
    <>
      <Link href="/dashboard/students" style={{ color: "#7fb0ff", fontSize: 13, textDecoration: "none" }}>← Students</Link>
      <h1 style={{ fontSize: 22, margin: "6px 0 4px" }}>{name}</h1>
      {transcript?.student && (
        <p style={dim}>
          Cohort {transcript.student.cohortYear} · level {transcript.student.currentLevel} · {transcript.student.status}
          {transcript.student.graduationDate ? ` · graduated ${transcript.student.graduationDate}` : ""}
        </p>
      )}

      {loading ? (
        <p style={{ ...dim, marginTop: 20 }}>Loading…</p>
      ) : (
        <>
          <Section title="Credentials">
            {credentials.length === 0 ? <p style={dim}>None issued.</p> : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "grid", gap: 4 }}>
                {credentials.map((c) => (
                  <li key={c.id}>
                    <strong>{c.title}</strong>{c.program ? ` — ${c.program}` : ""} · issued {c.issuedDate} ·{" "}
                    <a href={`/verify?serial=${encodeURIComponent(c.serial)}`} style={{ color: "#7fb0ff", fontFamily: "monospace" }}>{c.serial}</a>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Fees">
            {invoices.length === 0 ? <p style={dim}>No invoices.</p> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ textAlign: "left", opacity: 0.6 }}>
                  <th style={th}>Description</th><th style={th}>Due</th><th style={th}>Paid</th><th style={th}>Status</th>
                </tr></thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      <td style={td}>{inv.description}</td>
                      <td style={td}>{inv.amountDue} {inv.currency}</td>
                      <td style={td}>{inv.amountPaid} {inv.currency}</td>
                      <td style={td}>{inv.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Guardians">
            {guardians.length === 0 ? <p style={dim}>No guardians linked.</p> : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "grid", gap: 4 }}>
                {guardians.map((g) => (
                  <li key={g.id}>{g.parentName} <span style={dim}>({g.parentEmail}) · {g.relationship}</span></li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Transcript">
            {transcript ? <TranscriptCard data={transcript} /> : <p style={dim}>No transcript available.</p>}
          </Section>
        </>
      )}
    </>
  );
}

const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "8px 8px" };

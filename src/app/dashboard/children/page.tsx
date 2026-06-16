"use client";

/**
 * My Children — a parent's view of the students they guardian. Lists each child
 * and lazy-loads that child's transcript on expand. Every read is gated
 * server-side by a guardianship row (the parent supplies no ids of their own).
 */
import { useEffect, useState } from "react";
import { RoleGuard } from "../_components/RoleGuard";
import { TranscriptCard } from "../_components/forms";
import { Section, dim, type TranscriptData } from "../_components/ui";

interface Child {
  studentProfileId: string;
  fullName: string;
  cohortYear: number;
  currentLevel: number;
  status: string;
  relationship: string;
}

export default function ChildrenPage() {
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/me/children");
      const d = await r.json().catch(() => ({}));
      setChildren(r.ok && Array.isArray(d.children) ? d.children : []);
      setLoading(false);
    })();
  }, []);

  return (
    <RoleGuard allow={["parent"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>My Children</h1>
      <p style={dim}>View your children&apos;s academic records.</p>

      <Section title="Children">
        {loading ? (
          <p style={dim}>Loading…</p>
        ) : children.length === 0 ? (
          <p style={dim}>No students are linked to your account yet. Ask your school to link you.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {children.map((c) => (
              <ChildCard
                key={c.studentProfileId}
                child={c}
                open={openId === c.studentProfileId}
                onToggle={() =>
                  setOpenId((id) => (id === c.studentProfileId ? null : c.studentProfileId))
                }
              />
            ))}
          </div>
        )}
      </Section>
    </RoleGuard>
  );
}

interface Invoice {
  id: string;
  description: string;
  amountDue: string;
  amountPaid: string;
  currency: string;
  status: string;
  dueDate: string | null;
}

function ChildCard({
  child,
  open,
  onToggle,
}: {
  child: Child;
  open: boolean;
  onToggle: () => void;
}) {
  const [data, setData] = useState<TranscriptData | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || data || loading) return;
    setLoading(true);
    (async () => {
      const [tr, fr] = await Promise.all([
        fetch(`/api/me/children/${child.studentProfileId}/transcript`),
        fetch(`/api/me/children/${child.studentProfileId}/fees`),
      ]);
      if (tr.ok) setData(await tr.json());
      else setErr("Transcript unavailable.");
      if (fr.ok) {
        const d = await fr.json();
        setInvoices(Array.isArray(d.invoices) ? d.invoices : []);
      }
      setLoading(false);
    })();
  }, [open, data, loading, child.studentProfileId]);

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, background: "#0f1424" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 14px",
          background: "transparent",
          border: "none",
          color: "#e6e9f2",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{child.fullName}</span>{" "}
          <span style={{ ...dim, opacity: 0.7 }}>
            ({child.relationship} · cohort {child.cohortYear} · level {child.currentLevel} · {child.status})
          </span>
        </span>
        <span style={{ opacity: 0.6 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px" }}>
          {loading ? (
            <p style={dim}>Loading…</p>
          ) : (
            <>
              {data ? <TranscriptCard data={data} /> : <p style={dim}>{err ?? "No transcript yet."}</p>}
              {invoices && invoices.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Fees</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", opacity: 0.6 }}>
                        <th style={feeTh}>Description</th><th style={feeTh}>Due</th><th style={feeTh}>Paid</th><th style={feeTh}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                          <td style={feeTd}>{inv.description}{inv.dueDate ? <span style={{ ...dim, opacity: 0.6 }}> · due {inv.dueDate}</span> : null}</td>
                          <td style={feeTd}>{inv.amountDue} {inv.currency}</td>
                          <td style={feeTd}>{inv.amountPaid} {inv.currency}</td>
                          <td style={feeTd}>{inv.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const feeTh: React.CSSProperties = { padding: "5px 8px", fontWeight: 500 };
const feeTd: React.CSSProperties = { padding: "6px 8px" };

"use client";

/**
 * Fees — managers raise invoices against a student and record payments. The
 * paid amount and status are maintained server-side from the payment ledger.
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

interface Invoice {
  id: string;
  description: string;
  amountDue: string;
  amountPaid: string;
  currency: string;
  status: string;
  dueDate: string | null;
}

export default function FeesPage() {
  return (
    <RoleGuard allow={[...MANAGERS]}>
      <FeesInner />
    </RoleGuard>
  );
}

function FeesInner() {
  const { scope, students } = useDashboard();
  const branchId = scope.branchId;
  const [studentId, setStudentId] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [amountDue, setAmountDue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (!studentId && students.length > 0) setStudentId(students[0].studentProfileId);
  }, [students, studentId]);

  const load = useCallback(async () => {
    if (!studentId) {
      setInvoices([]);
      return;
    }
    const r = await fetch(`/api/fees/invoices/student/${studentId}`);
    const d = await r.json().catch(() => ({}));
    setInvoices(r.ok && Array.isArray(d.invoices) ? d.invoices : []);
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const errMsg = (d: { error?: string; fields?: Record<string, string> }) =>
    d.fields ? Object.values(d.fields).join("; ") : d.error ?? "Request failed.";

  const createInvoice = async () => {
    setError(null);
    setNotice(null);
    const r = await fetch("/api/fees/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentProfileId: studentId,
        description: description.trim(),
        amountDue: Number(amountDue),
        currency,
        dueDate: dueDate || undefined,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(errMsg(d));
    setDescription("");
    setAmountDue("");
    setDueDate("");
    setNotice("Invoice created.");
    void load();
  };

  const pay = async (id: string, balance: number, currencyCode: string) => {
    const raw = window.prompt(`Payment amount (${currencyCode}). Balance: ${balance.toFixed(2)}`, balance.toFixed(2));
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid positive amount.");
      return;
    }
    setError(null);
    const r = await fetch(`/api/fees/invoices/${id}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(errMsg(d));
    setNotice("Payment recorded.");
    void load();
  };

  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Fees</h1>
      <p style={dim}>Raise invoices and record payments. Balances update automatically.</p>

      {notice && <p style={{ ...successStyle, marginTop: 12 }}>{notice}</p>}
      {error && <p style={{ ...errStyle, marginTop: 12 }}>{error}</p>}

      {!branchId ? (
        <p style={{ ...dim, marginTop: 20 }}>Select a branch to manage fees.</p>
      ) : students.length === 0 ? (
        <p style={{ ...dim, marginTop: 20 }}>No active students in this branch.</p>
      ) : (
        <>
          <label style={{ ...labelStyle, maxWidth: 360, marginTop: 16 }}>
            Student
            <select style={inp} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              {students.map((s) => (
                <option key={s.studentProfileId} value={s.studentProfileId}>
                  {s.fullName} ({s.email})
                </option>
              ))}
            </select>
          </label>

          <Section title="New invoice">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
              <label style={{ ...labelStyle, flex: 1, minWidth: 180 }}>Description<input style={inp} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Term 1 tuition" /></label>
              <label style={labelStyle}>Amount<input type="number" min="0" step="0.01" style={{ ...inp, width: 120 }} value={amountDue} onChange={(e) => setAmountDue(e.target.value)} /></label>
              <label style={labelStyle}>Currency<input style={{ ...inp, width: 70 }} value={currency} onChange={(e) => setCurrency(e.target.value)} /></label>
              <label style={labelStyle}>Due date<input type="date" style={inp} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
              <button type="button" style={primary} onClick={createInvoice} disabled={!description.trim() || !amountDue}>Add</button>
            </div>
          </Section>

          <Section title="Invoices">
            {invoices.length === 0 ? (
              <p style={dim}>No invoices for this student.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.6 }}>
                    <th style={th}>Description</th><th style={th}>Due</th><th style={th}>Paid</th><th style={th}>Status</th><th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const balance = Number(inv.amountDue) - Number(inv.amountPaid);
                    return (
                      <tr key={inv.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <td style={td}>{inv.description}{inv.dueDate ? <div style={{ ...dim, opacity: 0.6 }}>due {inv.dueDate}</div> : null}</td>
                        <td style={td}>{inv.amountDue} {inv.currency}</td>
                        <td style={td}>{inv.amountPaid} {inv.currency}</td>
                        <td style={td}><StatusBadge status={inv.status} /></td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {inv.status !== "paid" && inv.status !== "void" && (
                            <button type="button" style={miniBtn} onClick={() => pay(inv.id, balance, inv.currency)}>Record payment</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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

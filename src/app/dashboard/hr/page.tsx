"use client";

/**
 * HR Operations — managers record attendance, payroll, and performance reviews
 * for staff in their branch. Pick a staff member, then work the three panels.
 * All writes are branch-scoped + audited server-side.
 */
import { useCallback, useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";
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
} from "../_components/ui";
import { STAFF_ATTENDANCE_STATUSES, STAFF_DOCUMENT_CATEGORIES } from "../../../lib/validation";

const MANAGERS = ["super_admin", "branch_manager"] as const;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface AttendanceRow { id: string; date: string; status: string; notes: string | null }
interface PayrollRow {
  id: string; periodStart: string; periodEnd: string; grossAmount: string;
  deductions: string; netAmount: string; currency: string; status: string; paidAt: string | null;
}
interface ReviewRow { id: string; reviewDate: string; rating: number; summary: string }
interface DocumentRow { id: string; category: string; fileName: string; contentType: string | null; url: string }

export default function HrPage() {
  return (
    <RoleGuard allow={[...MANAGERS]}>
      <HrInner />
    </RoleGuard>
  );
}

function HrInner() {
  const { scope, staff } = useDashboard();
  const branchId = scope.branchId;
  const [staffId, setStaffId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [payroll, setPayroll] = useState<PayrollRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);

  useEffect(() => {
    if (!staffId && staff.length > 0) setStaffId(staff[0].staffProfileId);
  }, [staff, staffId]);

  const loadAll = useCallback(async () => {
    if (!staffId) return;
    const get = async (u: string) => {
      const r = await fetch(u);
      return r.ok ? r.json() : null;
    };
    const [a, p, rv, dc] = await Promise.all([
      get(`/api/hr/attendance/staff/${staffId}`),
      get(`/api/hr/payroll/staff/${staffId}`),
      get(`/api/hr/performance/staff/${staffId}`),
      get(`/api/hr/documents/${staffId}`),
    ]);
    setAttendance(Array.isArray(a?.records) ? a.records : []);
    setPayroll(Array.isArray(p?.records) ? p.records : []);
    setReviews(Array.isArray(rv?.reviews) ? rv.reviews : []);
    setDocuments(Array.isArray(dc?.documents) ? dc.documents : []);
  }, [staffId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const flash = (msg: string) => {
    setNotice(msg);
    setError(null);
    void loadAll();
  };
  const fail = (msg: string) => {
    setError(msg);
    setNotice(null);
  };

  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>HR Operations</h1>
      <p style={dim}>Attendance, payroll, and performance for branch staff.</p>

      {notice && <p style={{ ...successStyle, marginTop: 12 }}>{notice}</p>}
      {error && <p style={{ ...errStyle, marginTop: 12 }}>{error}</p>}

      {!branchId ? (
        <p style={{ ...dim, marginTop: 20 }}>Select a branch to manage HR.</p>
      ) : staff.length === 0 ? (
        <p style={{ ...dim, marginTop: 20 }}>No staff in this branch yet.</p>
      ) : (
        <>
          <label style={{ ...labelStyle, maxWidth: 360, marginTop: 16 }}>
            Staff member
            <select style={inp} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {staff.map((s) => (
                <option key={s.staffProfileId} value={s.staffProfileId}>
                  {s.fullName} · {s.department} ({s.status})
                </option>
              ))}
            </select>
          </label>

          <AttendancePanel staffId={staffId} rows={attendance} onDone={flash} onError={fail} />
          <PayrollPanel staffId={staffId} rows={payroll} onDone={flash} onError={fail} />
          <PerformancePanel staffId={staffId} rows={reviews} onDone={flash} onError={fail} />
          <DocumentsPanel staffId={staffId} rows={documents} onDone={flash} onError={fail} />
        </>
      )}
    </>
  );
}

function errMsg(d: { error?: string; fields?: Record<string, string> }): string {
  return d.fields ? Object.values(d.fields).join("; ") : d.error ?? "Request failed.";
}

/* ── Attendance ─────────────────────────────────────────────────── */
function AttendancePanel({
  staffId, rows, onDone, onError,
}: { staffId: string; rows: AttendanceRow[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [date, setDate] = useState(todayISO());
  const [status, setStatus] = useState<string>("present");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    const r = await fetch("/api/hr/attendance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ staffProfileId: staffId, date, status, notes: notes || undefined }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return onError(errMsg(d));
    setNotes("");
    onDone(`Attendance saved (${status}).`);
  };

  return (
    <Section title="Attendance">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginBottom: 12 }}>
        <label style={labelStyle}>Date<input type="date" style={inp} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label style={labelStyle}>Status
          <select style={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STAFF_ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </label>
        <label style={{ ...labelStyle, flex: 1, minWidth: 160 }}>Notes<input style={inp} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" /></label>
        <button type="button" style={primary} onClick={submit}>Save</button>
      </div>
      {rows.length === 0 ? <p style={dim}>No attendance recorded.</p> : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {rows.slice(0, 14).map((a) => (
            <li key={a.id}>{a.date} — <strong>{a.status.replace("_", " ")}</strong>{a.notes ? ` · ${a.notes}` : ""}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ── Payroll ────────────────────────────────────────────────────── */
function PayrollPanel({
  staffId, rows, onDone, onError,
}: { staffId: string; rows: PayrollRow[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [periodStart, setPeriodStart] = useState(todayISO());
  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [gross, setGross] = useState("");
  const [deductions, setDeductions] = useState("");
  const [currency, setCurrency] = useState("USD");

  const submit = async () => {
    const r = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        staffProfileId: staffId,
        periodStart, periodEnd,
        grossAmount: Number(gross),
        deductions: deductions ? Number(deductions) : undefined,
        currency,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return onError(errMsg(d));
    setGross(""); setDeductions("");
    onDone("Payroll record created.");
  };

  const markPaid = async (id: string) => {
    const r = await fetch(`/api/hr/payroll/${id}/paid`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return onError(errMsg(d));
    onDone("Marked paid.");
  };

  return (
    <Section title="Payroll">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginBottom: 12 }}>
        <label style={labelStyle}>Period start<input type="date" style={inp} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></label>
        <label style={labelStyle}>Period end<input type="date" style={inp} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></label>
        <label style={labelStyle}>Gross<input type="number" min="0" step="0.01" style={{ ...inp, width: 110 }} value={gross} onChange={(e) => setGross(e.target.value)} /></label>
        <label style={labelStyle}>Deductions<input type="number" min="0" step="0.01" style={{ ...inp, width: 110 }} value={deductions} onChange={(e) => setDeductions(e.target.value)} placeholder="0" /></label>
        <label style={labelStyle}>Currency<input style={{ ...inp, width: 70 }} value={currency} onChange={(e) => setCurrency(e.target.value)} /></label>
        <button type="button" style={primary} onClick={submit} disabled={!gross}>Add</button>
      </div>
      {rows.length === 0 ? <p style={dim}>No payroll records.</p> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ textAlign: "left", opacity: 0.6 }}>
            <th style={th}>Period</th><th style={th}>Gross</th><th style={th}>Net</th><th style={th}>Status</th><th style={th} />
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={td}>{p.periodStart} → {p.periodEnd}</td>
                <td style={td}>{p.grossAmount} {p.currency}</td>
                <td style={td}>{p.netAmount} {p.currency}</td>
                <td style={td}>{p.status}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {p.status !== "paid" && <button type="button" style={miniBtn} onClick={() => markPaid(p.id)}>Mark paid</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/* ── Performance ────────────────────────────────────────────────── */
function PerformancePanel({
  staffId, rows, onDone, onError,
}: { staffId: string; rows: ReviewRow[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [reviewDate, setReviewDate] = useState(todayISO());
  const [rating, setRating] = useState(4);
  const [summary, setSummary] = useState("");

  const submit = async () => {
    const r = await fetch("/api/hr/performance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ staffProfileId: staffId, reviewDate, rating, summary }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return onError(errMsg(d));
    setSummary("");
    onDone("Review recorded.");
  };

  return (
    <Section title="Performance reviews">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginBottom: 12 }}>
        <label style={labelStyle}>Date<input type="date" style={inp} value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} /></label>
        <label style={labelStyle}>Rating
          <select style={inp} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
          </select>
        </label>
        <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>Summary<input style={inp} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Evaluation notes" /></label>
        <button type="button" style={primary} onClick={submit} disabled={!summary.trim()}>Add</button>
      </div>
      {rows.length === 0 ? <p style={dim}>No reviews yet.</p> : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "grid", gap: 4 }}>
          {rows.map((rv) => (
            <li key={rv.id}><strong>{rv.rating}/5</strong> · {rv.reviewDate} — {rv.summary}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ── Documents ──────────────────────────────────────────────────── */
function DocumentsPanel({
  staffId, rows, onDone, onError,
}: { staffId: string; rows: DocumentRow[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [category, setCategory] = useState<string>("contract");
  const [busy, setBusy] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      // 1) bytes go straight to Blob via the scoped handshake.
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: `/api/hr/documents/${staffId}/upload`,
      });
      // 2) register the metadata (works in dev + prod).
      const r = await fetch(`/api/hr/documents/${staffId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          url: blob.url,
          storageKey: blob.pathname,
          category,
          contentType: file.type || undefined,
          sizeBytes: file.size,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return onError(d.fields ? Object.values(d.fields).join("; ") : d.error ?? "Could not save document.");
      onDone(`Uploaded ${file.name}.`);
    } catch (err) {
      onError(err instanceof Error ? `Upload failed: ${err.message}` : "Upload failed (is BLOB_READ_WRITE_TOKEN set?)");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Onboarding documents">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginBottom: 12 }}>
        <label style={labelStyle}>Category
          <select style={inp} value={category} onChange={(e) => setCategory(e.target.value)}>
            {STAFF_DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ ...labelStyle }}>
          File
          <input type="file" onChange={onFile} disabled={busy} style={{ fontSize: 13 }} />
        </label>
        {busy && <span style={dim}>Uploading…</span>}
      </div>
      {rows.length === 0 ? <p style={dim}>No documents uploaded.</p> : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "grid", gap: 4 }}>
          {rows.map((d) => (
            <li key={d.id}>
              <span style={{ textTransform: "capitalize", opacity: 0.7 }}>{d.category}:</span>{" "}
              <a href={d.url} target="_blank" rel="noreferrer" style={{ color: "#7fb0ff" }}>{d.fileName}</a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const primary: React.CSSProperties = {
  padding: "9px 14px", borderRadius: 8, border: "none", background: "#5570ff",
  color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", height: 38,
};
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "8px 8px" };

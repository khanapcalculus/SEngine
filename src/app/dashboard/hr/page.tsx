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
  sessionsWorked?: number | null; hoursWorked?: string | null; hourlyRate?: string | null;
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
  const { scope, staff, reload } = useDashboard();
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

          <CompensationPanel
            key={staffId}
            staffId={staffId}
            currentRate={staff.find((s) => s.staffProfileId === staffId)?.baseRate ?? null}
            onSaved={(m) => { setNotice(m); setError(null); reload(); }}
            onError={fail}
          />
          <RunPayrollBar branchId={branchId} onDone={flash} onError={fail} />
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

/* ── Compensation: edit a staff member's hourly base rate ─────────── */
function CompensationPanel({
  staffId, currentRate, onSaved, onError,
}: { staffId: string; currentRate: string | null; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [rate, setRate] = useState(currentRate ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      onError("Hourly rate must be a number between 0 and 100000.");
      return;
    }
    setBusy(true);
    const r = await fetch(`/api/staff/${staffId}/rate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRate: n }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return onError(errMsg(d));
    onSaved(`Hourly rate set to ${d.baseRate}.`);
  };

  return (
    <Section title="Compensation">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
        <label style={labelStyle}>
          Hourly base rate
          <input
            type="number" min="0" step="0.01"
            style={{ ...inp, width: 140 }}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        <button type="button" style={{ ...primary, opacity: busy ? 0.6 : 1 }} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save rate"}
        </button>
        {currentRate && <span style={dim}>Current: {currentRate}</span>}
      </div>
      <p style={{ ...dim, marginTop: 8 }}>Used by the automated payroll engine for future runs.</p>
    </Section>
  );
}

/* ── Automated payroll run (branch-wide, one transaction) ─────────── */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
/** First day of `YYYY-MM` and first day of the following month, as ISO dates. */
function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, end };
}

function RunPayrollBar({
  branchId, onDone, onError,
}: { branchId: string; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [month, setMonth] = useState(currentMonth());
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const { start, end } = monthBounds(month);
    if (!window.confirm(`Run payroll for all active staff for ${month}? This posts immutable ledger entries.`)) return;
    setBusy(true);
    const r = await fetch("/api/hr/payroll/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branchId, periodStart: start, periodEnd: end }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return onError(errMsg(d));
    onDone(
      `Payroll run for ${month}: ${d.created} created, ${d.skipped} skipped, net ${Number(d.totalNet).toFixed(2)} ${d.currency}.`,
    );
  };

  return (
    <Section title="Run payroll">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
        <label style={labelStyle}>
          Pay month
          <input type="month" style={inp} value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button type="button" style={{ ...primary, opacity: busy ? 0.6 : 1 }} onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run Monthly Payroll"}
        </button>
      </div>
      <p style={{ ...dim, marginTop: 8 }}>
        Calculates each active tutor’s pay from their scheduled sessions × hourly rate − 15% deductions, in one
        atomic transaction. Re-running a month skips staff already paid for it.
      </p>
    </Section>
  );
}

/* ── Payroll (read-only ledger; generated by the automated run) ───── */
function PayrollPanel({
  staffId, rows, onDone, onError,
}: { staffId: string; rows: PayrollRow[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  void staffId;
  const markPaid = async (id: string) => {
    const r = await fetch(`/api/hr/payroll/${id}/paid`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return onError(errMsg(d));
    onDone("Marked paid.");
  };

  return (
    <Section title="Payroll ledger">
      <p style={{ ...dim, marginTop: 0 }}>
        Records are generated by the automated monthly run (hours × rate − {Math.round(0.15 * 100)}%) and are immutable.
      </p>
      {rows.length === 0 ? <p style={dim}>No payroll records. Use “Run Monthly Payroll” above.</p> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ textAlign: "left", opacity: 0.6 }}>
            <th style={th}>Period</th><th style={th}>Sessions</th><th style={th}>Hours</th><th style={th}>Rate</th>
            <th style={th}>Gross</th><th style={th}>Net</th><th style={th}>Status</th><th style={th} />
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={td}>{p.periodStart} → {p.periodEnd}</td>
                <td style={td}>{p.sessionsWorked ?? "—"}</td>
                <td style={td}>{p.hoursWorked ?? "—"}</td>
                <td style={td}>{p.hourlyRate ? `${p.hourlyRate} ${p.currency}` : "—"}</td>
                <td style={td}>{p.grossAmount} {p.currency}</td>
                <td style={td}><strong>{p.netAmount}</strong> {p.currency}</td>
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

"use client";

/**
 * Shared dashboard UI: types, style tokens, helpers, and presentational
 * primitives extracted from the former monolithic dashboard page so every
 * role-routed page can reuse them.
 */
import type { CSSProperties, ReactNode } from "react";

/* ─────────────────────────────── Types ─────────────────────────── */
export interface Me {
  userId: string;
  role: string;
  orgId: string | null;
  branchId: string | null;
}
export interface TenantBranch {
  id: string;
  orgId: string;
  location: string;
  status: string;
}
export interface TenantOrganization {
  id: string;
  name: string;
  branches: TenantBranch[];
}
export interface TenantScope {
  orgId: string | null;
  branchId: string | null;
  orgName: string | null;
  branchName: string | null;
  branchStatus: string | null;
}
export interface StaffRow {
  staffProfileId: string;
  fullName: string;
  email: string;
  department: string;
  status: string;
  baseRate?: string;
}
export interface StudentRow {
  studentProfileId: string;
  fullName: string;
  email: string;
  cohortYear: number;
  status: string;
}
export interface ClassRow {
  id: string;
  subject: string;
  term: string;
  credits: number;
}
export interface EnrollmentRow {
  enrollmentId: string;
  classId: string;
  classSubject: string;
  term: string;
  credits: number;
  studentProfileId: string;
  studentName: string;
  status: string;
  finalGrade: string | null;
}
export interface AuditRow {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
}
export interface AssignmentRow {
  assignmentId: string;
  classId: string;
  staffProfileId: string;
  fullName: string;
  email: string;
  department: string;
  role: string;
}
export interface TranscriptData {
  student: {
    fullName: string;
    email: string;
    cohortYear: number;
    status: string;
    currentLevel: number;
    enrollmentDate: string;
    graduationDate: string | null;
  };
  terms: Array<{
    term: string;
    courses: Array<{
      subject: string;
      credits: number;
      grade: string | null;
      status: string;
    }>;
    termGpa: number | null;
    gradedCredits: number;
  }>;
  cumulativeGpa: number | null;
  totalGradedCredits: number;
  promotions: Array<{
    term: string;
    fromLevel: number;
    toLevel: number;
    termGpa: string | null;
    outcome: string;
  }>;
}

export const PROMOTION_OUTCOMES = [
  "promoted",
  "retained",
  "graduated",
] as const;

/* ────────────────────────────── Helpers ────────────────────────── */
export const isManager = (role?: string) =>
  role === "super_admin" || role === "branch_manager";
export const isSuperAdmin = (role?: string) => role === "super_admin";

export function fmtErr(d: {
  error?: string;
  fields?: Record<string, string>;
}): string {
  if (d.fields) {
    return Object.entries(d.fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
  }
  return d.error ?? "Request failed";
}

export function pickInitialScope(
  organizations: TenantOrganization[],
  fallbackBranchId: string | null,
): { orgId: string | null; branchId: string | null } {
  if (organizations.length === 0) return { orgId: null, branchId: null };
  const matchingOrg = fallbackBranchId
    ? (organizations.find((org) =>
        org.branches.some((branch) => branch.id === fallbackBranchId),
      ) ?? null)
    : null;
  const org = matchingOrg ?? organizations[0];
  const branch =
    org.branches.find((c) => c.id === fallbackBranchId) ??
    org.branches[0] ??
    null;
  return { orgId: org.id, branchId: branch?.id ?? null };
}

/** Allowed lifecycle actions per current status (mirrors the server's rules). */
export const STAFF_ACTIONS: Record<string, { label: string; status: string }[]> =
  {
    onboarding: [{ label: "Activate", status: "active" }],
    active: [
      { label: "Set on leave", status: "on_leave" },
      { label: "Retire", status: "retired" },
      { label: "Terminate", status: "terminated" },
    ],
    on_leave: [
      { label: "Reactivate", status: "active" },
      { label: "Retire", status: "retired" },
      { label: "Terminate", status: "terminated" },
    ],
    retired: [],
    terminated: [],
  };

const STATUS_COLORS: Record<string, string> = {
  active: "#9be8b4",
  onboarding: "#7fd1ff",
  on_leave: "#ffcf8f",
  retired: "#c9b6ff",
  terminated: "#ff8080",
  enrolled: "#7fd1ff",
  completed: "#9be8b4",
  withdrawn: "#ff8080",
  graduated: "#c9b6ff",
  dropped: "#ff8080",
};

/* ───────────────────────────── Primitives ──────────────────────── */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, opacity: 0.85, marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  );
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={metricCard}>
      <div style={{ ...dim, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: STATUS_COLORS[status] ?? "#e6e9f2",
        background: "rgba(255,255,255,0.06)",
        borderRadius: 6,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export function Roster({
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
            <th key={h} style={{ padding: "6px 8px", fontWeight: 500 }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={keyOf(r, i)}
            style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
          >
            {r.map((cell, j) => (
              <td key={j} style={{ padding: 8 }}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StaffLifecycleRoster({
  staff,
  canManage,
  onChange,
}: {
  staff: StaffRow[];
  canManage: boolean;
  onChange: (id: string, status: string, label: string) => void;
}) {
  if (staff.length === 0) {
    return <p style={dim}>No staff in this branch yet.</p>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: "left", opacity: 0.6 }}>
          {["Name", "Email", "Dept", "Status"].map((h) => (
            <th key={h} style={{ padding: "6px 8px", fontWeight: 500 }}>
              {h}
            </th>
          ))}
          {canManage && (
            <th style={{ padding: "6px 8px", fontWeight: 500 }}>Actions</th>
          )}
        </tr>
      </thead>
      <tbody>
        {staff.map((s) => {
          const actions = STAFF_ACTIONS[s.status] ?? [];
          return (
            <tr
              key={s.staffProfileId}
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
            >
              <td style={{ padding: 8 }}>{s.fullName}</td>
              <td style={{ padding: 8 }}>{s.email}</td>
              <td style={{ padding: 8 }}>{s.department}</td>
              <td style={{ padding: 8 }}>
                <StatusBadge status={s.status} />
              </td>
              {canManage && (
                <td style={{ padding: 8 }}>
                  {actions.length === 0 ? (
                    <span style={dim}>—</span>
                  ) : (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {actions.map((a) => (
                        <button
                          key={a.status}
                          type="button"
                          onClick={() =>
                            onChange(s.staffProfileId, a.status, a.label.toLowerCase())
                          }
                          style={miniBtn}
                        >
                          {a.label}
                        </button>
                      ))}
                    </span>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function TenantOverview({
  organizations,
  renderOrgAction,
}: {
  organizations: TenantOrganization[];
  /** Optional per-org footer (e.g. an "Add branch" control). */
  renderOrgAction?: (org: TenantOrganization) => ReactNode;
}) {
  if (organizations.length === 0) {
    return <p style={dim}>No organizations found yet.</p>;
  }
  return (
    <div style={tenantOverview}>
      {organizations.map((org) => (
        <div key={org.id} style={tenantCard}>
          <strong style={{ display: "block", marginBottom: 8 }}>
            {org.name}
          </strong>
          {org.branches.length === 0 ? (
            <p style={{ ...dim, margin: 0 }}>No branches yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {org.branches.map((branch) => (
                <li key={branch.id}>
                  {branch.location} ({branch.status})
                </li>
              ))}
            </ul>
          )}
          {renderOrgAction && <div style={{ marginTop: 10 }}>{renderOrgAction(org)}</div>}
        </div>
      ))}
    </div>
  );
}

export function ScopeHint({ scope }: { scope: TenantScope }) {
  if (!scope.orgId || !scope.branchId) {
    return <p style={dim}>Select a branch scope to enable this form.</p>;
  }
  return (
    <p style={dim}>
      Scope: {scope.orgName ?? "Organization"} /{" "}
      {scope.branchName ?? scope.branchId}
    </p>
  );
}

export function btn(disabled: boolean): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 8,
    border: "none",
    background: disabled ? "#3a4570" : "#5570ff",
    color: "white",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    width: "100%",
  };
}

/* ────────────────────────────── Styles ─────────────────────────── */
export const dim: CSSProperties = { opacity: 0.55, fontSize: 13 };
export const formGrid: CSSProperties = { display: "grid", gap: 10, maxWidth: 420 };
export const tenantGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  marginBottom: 16,
};
export const tenantOverview: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};
export const tenantCard: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: 12,
  background: "#0f1424",
};
export const metricGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 12,
  marginBottom: 16,
};
export const metricCard: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: 12,
  background: "#0f1424",
};
export const labelStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 13,
};
export const inp: CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "#11162a",
  color: "#e6e9f2",
  fontSize: 13,
};
export const errStyle: CSSProperties = {
  color: "#ff8080",
  fontSize: 13,
  margin: 0,
};
export const fieldErrorStyle: CSSProperties = {
  color: "#ff8080",
  fontSize: 12,
  margin: "4px 0 0 0",
  padding: 0,
};
export const miniBtn: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "#1a2138",
  color: "#e6e9f2",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};
export const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "rgba(255,255,255,0.06)",
  borderRadius: 6,
  padding: "2px 8px",
  fontSize: 12,
};
export const chipX: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#ff8080",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
  marginLeft: 2,
};
export const warnStyle: CSSProperties = {
  background: "#352713",
  color: "#ffcf8f",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
};
export const successStyle: CSSProperties = {
  background: "#13351f",
  color: "#9be8b4",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
};

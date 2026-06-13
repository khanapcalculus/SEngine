"use client";

/**
 * Overview — the role-aware landing page (open to every role). Super admins see
 * network metrics, branch managers see their branch summary + recent activity,
 * teachers/students see a welcome pointing at their tools. All deeper features
 * live on their own role-guarded routes.
 */
import { useDashboard } from "./DashboardProvider";
import { RoleGuard } from "./_components/RoleGuard";
import {
  Section,
  MetricCard,
  metricGrid,
  dim,
  isManager,
  isSuperAdmin,
} from "./_components/ui";
import type { Role } from "../../lib/rbac";

const ALL_ROLES: Role[] = [
  "super_admin",
  "branch_manager",
  "teacher",
  "student",
  "parent",
];

export default function OverviewPage() {
  const { me, scope, staff, students, classes, tenantTree, audit } =
    useDashboard();

  return (
    <RoleGuard allow={ALL_ROLES}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Overview</h1>
      <p style={dim}>Signed in as {me.role}.</p>

      {isSuperAdmin(me.role) && (
        <Section title="Network">
          <div style={metricGrid}>
            <MetricCard label="Organizations" value={String(tenantTree.length)} />
            <MetricCard
              label="Branches"
              value={String(
                tenantTree.reduce((s, o) => s + o.branches.length, 0),
              )}
            />
            <MetricCard label="Selected branch" value={scope.branchName ?? "None"} />
          </div>
        </Section>
      )}

      {isManager(me.role) && (
        <Section title="Branch summary">
          {scope.branchId ? (
            <div style={metricGrid}>
              <MetricCard label="Staff" value={String(staff.length)} />
              <MetricCard label="Students" value={String(students.length)} />
              <MetricCard label="Classes" value={String(classes.length)} />
              <MetricCard
                label="Branch status"
                value={scope.branchStatus ?? "Assigned"}
              />
            </div>
          ) : (
            <p style={dim}>Select a branch from the top bar to load data.</p>
          )}
        </Section>
      )}

      {isManager(me.role) && (
        <Section title="Recent activity">
          {audit.length === 0 ? (
            <p style={dim}>No audit entries yet.</p>
          ) : (
            <ul
              style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12 }}
            >
              {audit.slice(0, 12).map((a) => (
                <li
                  key={a.id}
                  style={{
                    padding: "6px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <code style={{ color: "#7fd1ff", marginRight: 8 }}>
                    {a.action}
                  </code>
                  {a.summary}
                  <span style={{ opacity: 0.4, marginLeft: 8 }}>
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {!isManager(me.role) && (
        <Section title="Welcome">
          <p style={dim}>Use the sidebar to access your tools.</p>
        </Section>
      )}
    </RoleGuard>
  );
}

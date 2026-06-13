"use client";

/**
 * Dashboard shell: wraps every /dashboard/* page in the shared DashboardProvider
 * and renders the role-filtered sidebar, a top bar (role label, super-admin
 * scope switcher, sign-out), and the global notice/error banners. Individual
 * pages stay thin and wrap their body in <RoleGuard>.
 */
import type { ReactNode } from "react";
import { DashboardProvider, useDashboard } from "./DashboardProvider";
import { Sidebar } from "./_components/Sidebar";
import {
  isSuperAdmin,
  inp,
  btn,
  dim,
  successStyle,
  warnStyle,
} from "./_components/ui";

function ScopeSwitcher() {
  const {
    tenantTree,
    selectedOrgId,
    selectedBranchId,
    onOrgChange,
    setSelectedBranchId,
  } = useDashboard();
  const org = tenantTree.find((o) => o.id === selectedOrgId) ?? null;
  const branches = org?.branches ?? [];
  const compact = { ...inp, padding: "5px 8px", fontSize: 12 };
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <select
        style={compact}
        value={selectedOrgId}
        onChange={(e) => onOrgChange(e.target.value)}
        disabled={tenantTree.length === 0}
      >
        <option value="">Org…</option>
        {tenantTree.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select
        style={compact}
        value={selectedBranchId}
        onChange={(e) => setSelectedBranchId(e.target.value)}
        disabled={branches.length === 0}
      >
        <option value="">Branch…</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.location}
          </option>
        ))}
      </select>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { me, scope, notice, tenantError, actionError, logout } = useDashboard();
  const branchLabel =
    scope.branchName ??
    (scope.branchId ? `branch ${scope.branchId.slice(0, 8)}` : "no branch");

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <span style={{ fontSize: 13, ...dim }}>
            {me.role} · {branchLabel}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
            {isSuperAdmin(me.role) && <ScopeSwitcher />}
            <button
              onClick={logout}
              style={{ ...btn(false), width: "auto", padding: "6px 12px" }}
            >
              Sign out
            </button>
          </div>
        </header>

        <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 24px 64px" }}>
          {notice && <p style={successStyle}>{notice}</p>}
          {tenantError && <p style={warnStyle}>{tenantError}</p>}
          {actionError && (
            <p role="alert" style={warnStyle}>
              {actionError}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
      <Shell>{children}</Shell>
    </DashboardProvider>
  );
}

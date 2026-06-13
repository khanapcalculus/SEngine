"use client";

/** Organizations — cross-tenant management + provisioning (super_admin only). */
import { useDashboard } from "../DashboardProvider";
import { RoleGuard } from "../_components/RoleGuard";
import {
  CreateOrganizationForm,
  CreateBranchForm,
} from "../_components/forms";
import {
  Section,
  MetricCard,
  TenantOverview,
  metricGrid,
  tenantGrid,
  tenantCard,
  labelStyle,
  inp,
} from "../_components/ui";

export default function OrganizationsPage() {
  const {
    scope,
    tenantTree,
    selectedOrgId,
    selectedBranchId,
    onOrgChange,
    setSelectedBranchId,
    handleOrgCreated,
    handleBranchCreated,
  } = useDashboard();
  const org = tenantTree.find((o) => o.id === selectedOrgId) ?? null;
  const branches = org?.branches ?? [];

  return (
    <RoleGuard allow={["super_admin"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Organizations</h1>

      <Section title="Network">
        <div style={metricGrid}>
          <MetricCard label="Organizations" value={String(tenantTree.length)} />
          <MetricCard
            label="Branches"
            value={String(tenantTree.reduce((s, o) => s + o.branches.length, 0))}
          />
          <MetricCard label="Selected org" value={scope.orgName ?? "None"} />
          <MetricCard label="Selected branch" value={scope.branchName ?? "None"} />
        </div>

        <div style={tenantGrid}>
          <label style={labelStyle}>
            Organization
            <select
              style={inp}
              value={selectedOrgId}
              onChange={(e) => onOrgChange(e.target.value)}
              disabled={tenantTree.length === 0}
            >
              <option value="">Select organization…</option>
              {tenantTree.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.branches.length} branches)
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Branch
            <select
              style={inp}
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              disabled={branches.length === 0}
            >
              <option value="">Select branch…</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.location} ({b.status})
                </option>
              ))}
            </select>
          </label>
        </div>

        <TenantOverview organizations={tenantTree} />
      </Section>

      <Section title="Provision tenants">
        <div style={tenantGrid}>
          <div style={tenantCard}>
            <strong style={{ fontSize: 12, opacity: 0.7 }}>New organization</strong>
            <CreateOrganizationForm onCreated={handleOrgCreated} />
          </div>
          <div style={tenantCard}>
            <strong style={{ fontSize: 12, opacity: 0.7 }}>New branch</strong>
            <CreateBranchForm
              orgId={selectedOrgId || null}
              orgName={org?.name ?? null}
              onCreated={handleBranchCreated}
            />
          </div>
        </div>
      </Section>
    </RoleGuard>
  );
}

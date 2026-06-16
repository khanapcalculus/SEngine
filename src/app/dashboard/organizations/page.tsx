"use client";

/** Organizations — cross-tenant management + provisioning (super_admin only). */
import { useState } from "react";
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
  type TenantOrganization,
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

        <TenantOverview
          organizations={tenantTree}
          renderOrgAction={(org) => (
            <OrgBranchAdder org={org} onCreated={handleBranchCreated} />
          )}
        />
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

/**
 * Per-organization "Add branch" affordance shown inside each org card in the
 * overview. Previously the only way to add a branch was the single global form
 * bound to the org dropdown, so adding branches to an existing org was easy to
 * miss; this binds directly to `org.id`.
 */
function OrgBranchAdder({
  org,
  onCreated,
}: {
  org: TenantOrganization;
  onCreated: (branch: { id: string; orgId: string; location: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: 7,
          border: "1px solid rgba(120,130,170,0.4)",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        {open ? "Cancel" : "+ Add branch"}
      </button>
      {open && (
        <CreateBranchForm
          orgId={org.id}
          orgName={org.name}
          onCreated={(b) => {
            onCreated(b);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

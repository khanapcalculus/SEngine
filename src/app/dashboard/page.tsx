"use client";

/**
 * Authenticated admin dashboard.
 *
 * Super admins can now switch organization/branch context from live tenant
 * data. Branch-scoped modules (rosters, classes, audit, onboarding) continue
 * to call the existing APIs, but they are now driven by the selected branch
 * instead of the login branch alone.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { VALID_GRADES } from "../../modules/sis/grading";

const PROMOTION_OUTCOMES = ["promoted", "retained", "graduated"] as const;

interface Me {
  userId: string;
  role: string;
  orgId: string | null;
  branchId: string | null;
}

interface TenantBranch {
  id: string;
  orgId: string;
  location: string;
  status: string;
}

interface TenantOrganization {
  id: string;
  name: string;
  branches: TenantBranch[];
}

interface TenantScope {
  orgId: string | null;
  branchId: string | null;
  orgName: string | null;
  branchName: string | null;
  branchStatus: string | null;
}

interface StaffRow {
  staffProfileId: string;
  fullName: string;
  email: string;
  department: string;
  status: string;
}

interface StudentRow {
  studentProfileId: string;
  fullName: string;
  email: string;
  cohortYear: number;
  status: string;
}

interface ClassRow {
  id: string;
  subject: string;
  term: string;
  credits: number;
}

interface EnrollmentRow {
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

interface AuditRow {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
}

interface AssignmentRow {
  assignmentId: string;
  classId: string;
  staffProfileId: string;
  fullName: string;
  email: string;
  department: string;
  role: string;
}

const isManager = (role?: string) =>
  role === "super_admin" || role === "branch_manager";
const isSuperAdmin = (role?: string) => role === "super_admin";

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [tenantTree, setTenantTree] = useState<TenantOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);

  const clearBranchData = useCallback(() => {
    setStaff([]);
    setStudents([]);
    setClasses([]);
    setAudit([]);
    setAssignments([]);
    setEnrollments([]);
  }, []);

  const refresh = useCallback(
    async (bid: string, role: string) => {
      const get = async (url: string) => {
        const r = await fetch(url);
        return r.ok ? r.json() : null;
      };

      const [s, st, c, asg, enr] = await Promise.all([
        get(`/api/staff/branch/${bid}`),
        get(`/api/students/branch/${bid}`),
        get(`/api/classes/branch/${bid}`),
        get(`/api/staff/assignments/branch/${bid}`),
        get(`/api/enrollments/branch/${bid}`),
      ]);

      setStaff(Array.isArray(s?.staff) ? s.staff : []);
      setStudents(Array.isArray(st?.students) ? st.students : []);
      setClasses(Array.isArray(c?.classes) ? c.classes : []);
      setAssignments(Array.isArray(asg?.assignments) ? asg.assignments : []);
      setEnrollments(Array.isArray(enr?.enrollments) ? enr.enrollments : []);

      if (isManager(role)) {
        const a = await get(`/api/audit/branch/${bid}`);
        setAudit(Array.isArray(a?.entries) ? a.entries : []);
      } else {
        setAudit([]);
      }
    },
    [],
  );

  const loadTenantTree = useCallback(async (): Promise<TenantOrganization[]> => {
    const res = await fetch("/api/admin/tenant-tree");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(fmtErr(data));
    }
    return Array.isArray(data.organizations) ? data.organizations : [];
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          router.replace("/login");
          return;
        }

        const data: Me = await res.json();
        if (!active) return;
        setMe(data);

        if (isSuperAdmin(data.role)) {
          try {
            const organizations = await loadTenantTree();
            if (!active) return;
            setTenantTree(organizations);
            const initial = pickInitialScope(organizations, data.branchId);
            setSelectedOrgId(initial.orgId ?? "");
            setSelectedBranchId(initial.branchId ?? "");
          } catch (err) {
            if (!active) return;
            setTenantError(
              err instanceof Error
                ? err.message
                : "Unable to load organizations.",
            );
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [router, loadTenantTree]);

  const selectedOrg = useMemo(
    () => tenantTree.find((org) => org.id === selectedOrgId) ?? null,
    [tenantTree, selectedOrgId],
  );

  const branchesForSelectedOrg = selectedOrg?.branches ?? [];

  const selectedBranch = useMemo(
    () =>
      branchesForSelectedOrg.find((branch) => branch.id === selectedBranchId) ??
      null,
    [branchesForSelectedOrg, selectedBranchId],
  );

  useEffect(() => {
    if (!isSuperAdmin(me?.role) || !selectedOrg) return;
    if (
      selectedBranchId &&
      selectedOrg.branches.some((branch) => branch.id === selectedBranchId)
    ) {
      return;
    }
    setSelectedBranchId(selectedOrg.branches[0]?.id ?? "");
  }, [me?.role, selectedOrg, selectedBranchId]);

  const scope: TenantScope = useMemo(() => {
    if (isSuperAdmin(me?.role)) {
      return {
        orgId: selectedOrg?.id ?? null,
        branchId: selectedBranch?.id ?? null,
        orgName: selectedOrg?.name ?? null,
        branchName: selectedBranch?.location ?? null,
        branchStatus: selectedBranch?.status ?? null,
      };
    }

    return {
      orgId: me?.orgId ?? null,
      branchId: me?.branchId ?? null,
      orgName: null,
      branchName: null,
      branchStatus: null,
    };
  }, [me?.branchId, me?.orgId, me?.role, selectedBranch, selectedOrg]);

  useEffect(() => {
    if (!me) return;
    if (!scope.branchId) {
      clearBranchData();
      return;
    }
    void refresh(scope.branchId, me.role);
  }, [clearBranchData, me, refresh, scope.branchId]);

  const reload = () => scope.branchId && me && refresh(scope.branchId, me.role);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  function flash(msg: string) {
    setActionError(null);
    setNotice(msg);
    reload();
  }

  async function onUnassign(assignmentId: string) {
    if (!window.confirm("Remove this staff assignment?")) return;
    const res = await fetch("/api/staff/unassign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(null);
      setActionError(fmtErr(d));
      return;
    }
    flash("Removed staff assignment.");
  }

  async function onStaffStatusChange(
    staffProfileId: string,
    status: string,
    label: string,
  ) {
    if (
      (status === "retired" || status === "terminated") &&
      !window.confirm(
        `Mark this staff member as ${status}? This is a recorded lifecycle change.`,
      )
    ) {
      return;
    }
    const res = await fetch("/api/staff/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ staffProfileId, status }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(null);
      setActionError(fmtErr(d));
      return;
    }
    flash(`Staff ${label}.`);
  }

  function onOrgChange(nextOrgId: string) {
    setSelectedOrgId(nextOrgId);
    const nextOrg = tenantTree.find((org) => org.id === nextOrgId) ?? null;
    setSelectedBranchId(nextOrg?.branches[0]?.id ?? "");
    setNotice(null);
  }

  // Reload the org->branch tree after a provisioning mutation and optionally
  // jump the selection to the freshly-created org/branch.
  const refreshTenantTree = useCallback(
    async (select?: { orgId?: string; branchId?: string }) => {
      const organizations = await loadTenantTree();
      setTenantTree(organizations);
      if (select?.orgId !== undefined) setSelectedOrgId(select.orgId);
      if (select?.branchId !== undefined) setSelectedBranchId(select.branchId);
      return organizations;
    },
    [loadTenantTree],
  );

  const handleOrgCreated = useCallback(
    async (org: { id: string; name: string }) => {
      setTenantError(null);
      setNotice(`Created organization "${org.name}".`);
      try {
        await refreshTenantTree({ orgId: org.id });
      } catch (err) {
        setTenantError(
          err instanceof Error ? err.message : "Failed to reload organizations.",
        );
      }
    },
    [refreshTenantTree],
  );

  const handleBranchCreated = useCallback(
    async (branch: { id: string; orgId: string; location: string }) => {
      setTenantError(null);
      setNotice(`Created branch "${branch.location}".`);
      try {
        await refreshTenantTree({ orgId: branch.orgId, branchId: branch.id });
      } catch (err) {
        setTenantError(
          err instanceof Error ? err.message : "Failed to reload organizations.",
        );
      }
    },
    [refreshTenantTree],
  );

  const currentScopeLabel =
    scope.branchName ??
    (scope.branchId ? `branch ${scope.branchId.slice(0, 8)}` : "no branch");

  const networkBranchCount = tenantTree.reduce(
    (sum, org) => sum + org.branches.length,
    0,
  );

  const scopeHelp = isSuperAdmin(me?.role)
    ? "Select an organization and branch to manage rosters, classes, and audit logs."
    : "This account uses its verified branch assignment for branch-scoped actions.";

  const assignmentsByClass = useMemo(() => {
    const map: Record<string, AssignmentRow[]> = {};
    for (const a of assignments) (map[a.classId] ??= []).push(a);
    return map;
  }, [assignments]);

  if (loading) {
    return (
      <main style={page}>
        <p style={{ opacity: 0.6 }}>Loading…</p>
      </main>
    );
  }

  return (
    <main style={page}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Dashboard</h1>
          <span style={{ fontSize: 13, opacity: 0.6 }}>
            {me?.role} · {currentScopeLabel}
          </span>
        </div>
        <button
          onClick={logout}
          style={{
            ...btn(false),
            marginLeft: "auto",
            width: "auto",
            padding: "6px 12px",
          }}
        >
          Sign out
        </button>
      </header>

      {notice && (
        <p style={successStyle}>
          {notice}
        </p>
      )}

      {tenantError && (
        <p style={warnStyle}>
          {tenantError}
        </p>
      )}

      {actionError && (
        <p role="alert" style={warnStyle}>
          {actionError}
        </p>
      )}

      <Section title="Scope">
        <p style={{ ...dim, marginTop: 0 }}>{scopeHelp}</p>
        {isSuperAdmin(me?.role) ? (
          <>
            <div style={metricGrid}>
              <MetricCard label="Organizations" value={String(tenantTree.length)} />
              <MetricCard label="Branches" value={String(networkBranchCount)} />
              <MetricCard
                label="Selected org"
                value={scope.orgName ?? "None"}
              />
              <MetricCard
                label="Selected branch"
                value={scope.branchName ?? "None"}
              />
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
                  {tenantTree.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.branches.length} branches)
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
                  disabled={branchesForSelectedOrg.length === 0}
                >
                  <option value="">Select branch…</option>
                  {branchesForSelectedOrg.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.location} ({branch.status})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <TenantOverview organizations={tenantTree} />

            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 13, opacity: 0.8, margin: "0 0 4px" }}>
                Provision tenants
              </h3>
              <p style={{ ...dim, marginTop: 0 }}>
                Create new organizations and branches for the network.
              </p>
              <div style={tenantGrid}>
                <div style={tenantCard}>
                  <strong style={{ fontSize: 12, opacity: 0.7 }}>
                    New organization
                  </strong>
                  <CreateOrganizationForm onCreated={handleOrgCreated} />
                </div>
                <div style={tenantCard}>
                  <strong style={{ fontSize: 12, opacity: 0.7 }}>
                    New branch
                  </strong>
                  <CreateBranchForm
                    orgId={selectedOrgId || null}
                    orgName={selectedOrg?.name ?? null}
                    onCreated={handleBranchCreated}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <p style={dim}>
            Active branch: {currentScopeLabel}
          </p>
        )}
      </Section>

      {!scope.branchId && (
        <p style={warnStyle}>
          Select a branch to load branch-scoped data.
        </p>
      )}

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
          <p style={dim}>No branch selected yet.</p>
        )}
      </Section>

      <Section title="Staff roster">
        <StaffLifecycleRoster
          staff={staff}
          canManage={isManager(me?.role)}
          onChange={onStaffStatusChange}
        />
      </Section>

      <Section title="Student roster">
        <Roster
          rows={students.map((s) => [
            s.fullName,
            s.email,
            String(s.cohortYear),
            s.status,
          ])}
          head={["Name", "Email", "Cohort", "Status"]}
          empty="No active students in this branch yet."
          keyOf={(_r, i) => students[i].studentProfileId}
        />
      </Section>

      <Section title="Classes">
        {classes.length === 0 ? (
          <p style={dim}>No classes yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 13 }}>
            {classes.map((c) => {
              const staffOfClass = assignmentsByClass[c.id] ?? [];
              return (
                <li
                  key={c.id}
                  style={{
                    padding: "8px 0",
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div>
                    {c.subject} -{" "}
                    <span style={{ opacity: 0.6 }}>
                      {c.term} · {c.credits} cr
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    {staffOfClass.length === 0 ? (
                      <span style={dim}>No staff assigned.</span>
                    ) : (
                      staffOfClass.map((a) => (
                        <span key={a.assignmentId} style={chip}>
                          {a.fullName}{" "}
                          <span style={{ opacity: 0.6 }}>({a.role})</span>
                          {isManager(me?.role) && (
                            <button
                              type="button"
                              onClick={() => onUnassign(a.assignmentId)}
                              style={chipX}
                              title="Unassign"
                              aria-label={`Unassign ${a.fullName}`}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <OnboardStaffForm scope={scope} onDone={flash} />
      <EnrollStudentForm scope={scope} onDone={flash} />
      {isManager(me?.role) && <CreateClassForm scope={scope} onDone={flash} />}
      <AssignClassForm students={students} classes={classes} onDone={flash} />
      {isManager(me?.role) && (
        <AssignStaffForm staff={staff} classes={classes} onDone={flash} />
      )}

      {(isManager(me?.role) || me?.role === "teacher") && (
        <Section title="Gradebook">
          <Gradebook enrollments={enrollments} onDone={flash} />
        </Section>
      )}

      {isManager(me?.role) && (
        <PromoteStudentForm
          students={students}
          classes={classes}
          onDone={flash}
        />
      )}

      {isManager(me?.role) && <TranscriptViewer students={students} />}

      <TutorPanel classes={classes} />

      {isManager(me?.role) && (
        <Section title="Audit log">
          {audit.length === 0 ? (
            <p style={dim}>No audit entries yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12 }}>
              {audit.map((a) => (
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
    </main>
  );
}

function OnboardStaffForm({
  scope,
  onDone,
}: {
  scope: TenantScope;
  onDone: (m: string) => void;
}) {
  const [f, setF] = useState({
    email: "",
    fullName: "",
    department: "",
    hireDate: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !scope.orgId || !scope.branchId;

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    
    if (!f.email.trim()) {
      errors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
      errors.email = "Please enter a valid email address";
    }
    
    if (!f.fullName.trim()) {
      errors.fullName = "Full name is required";
    } else if (f.fullName.length > 255) {
      errors.fullName = "Full name must be 255 characters or less";
    }
    
    if (!f.department.trim()) {
      errors.department = "Department is required";
    } else if (f.department.length > 128) {
      errors.department = "Department must be 128 characters or less";
    }
    
    if (!f.hireDate) {
      errors.hireDate = "Hire date is required";
    } else if (isNaN(Date.parse(f.hireDate))) {
      errors.hireDate = "Please enter a valid date";
    }
    
    setFieldErrors(errors);
    console.log("Form Validation Errors:", errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    console.log("Form submission triggered");
    
    if (!scope.orgId || !scope.branchId) {
      setErr("Select an organization and branch first.");
      console.log("Scope validation failed: orgId or branchId missing");
      return;
    }

    if (!validateForm()) {
      console.log("Form validation failed, blocking submission");
      return;
    }

    setErr(null);
    setBusy(true);
    console.log("Sending request to /api/staff/onboard with data:", f);
    
    try {
      const res = await fetch("/api/staff/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...f,
          orgId: scope.orgId,
          branchId: scope.branchId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      console.log("API Response:", { status: res.status, data: d });
      
      if (!res.ok) {
        console.log("API request failed with error:", d);
        return setErr(fmtErr(d));
      }
      
      const temporaryPassword = d.temporaryPassword;
      console.log("Form submission successful, temporary password generated");
      onDone(`Onboarded ${f.fullName}. Temporary password: ${temporaryPassword}`);
      setF({ email: "", fullName: "", department: "", hireDate: "" });
      setFieldErrors({});
    } catch (error) {
      console.error("Form submission error:", error);
      setErr("An unexpected error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Onboard staff">
      <ScopeHint scope={scope} />
      <form onSubmit={submit} style={formGrid}>
        <div>
          <input
            style={inp}
            placeholder="Email"
            type="email"
            disabled={disabled}
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
          {fieldErrors.email && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.email}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            placeholder="Full name"
            disabled={disabled}
            value={f.fullName}
            onChange={(e) => setF({ ...f, fullName: e.target.value })}
          />
          {fieldErrors.fullName && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.fullName}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            placeholder="Department"
            disabled={disabled}
            value={f.department}
            onChange={(e) => setF({ ...f, department: e.target.value })}
          />
          {fieldErrors.department && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.department}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            type="date"
            disabled={disabled}
            value={f.hireDate}
            onChange={(e) => setF({ ...f, hireDate: e.target.value })}
          />
          {fieldErrors.hireDate && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.hireDate}
            </p>
          )}
        </div>
        {err && (
          <p role="alert" style={errStyle}>
            {err}
          </p>
        )}
        <button type="submit" disabled={busy || disabled} style={btn(busy || disabled)}>
          {busy ? "Saving…" : "Onboard"}
        </button>
      </form>
    </Section>
  );
}

function EnrollStudentForm({
  scope,
  onDone,
}: {
  scope: TenantScope;
  onDone: (m: string) => void;
}) {
  const [f, setF] = useState({
    email: "",
    fullName: "",
    enrollmentDate: "",
    cohortYear: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !scope.orgId || !scope.branchId;

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    
    if (!f.email.trim()) {
      errors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
      errors.email = "Please enter a valid email address";
    }
    
    if (!f.fullName.trim()) {
      errors.fullName = "Full name is required";
    } else if (f.fullName.length > 255) {
      errors.fullName = "Full name must be 255 characters or less";
    }
    
    if (!f.enrollmentDate) {
      errors.enrollmentDate = "Enrollment date is required";
    } else if (isNaN(Date.parse(f.enrollmentDate))) {
      errors.enrollmentDate = "Please enter a valid date";
    }
    
    if (!f.cohortYear.trim()) {
      errors.cohortYear = "Cohort year is required";
    } else {
      const year = Number(f.cohortYear);
      if (isNaN(year) || year < 2000 || year > 2100) {
        errors.cohortYear = "Please enter a valid year between 2000 and 2100";
      }
    }
    
    setFieldErrors(errors);
    console.log("Enroll Student Form Validation Errors:", errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    console.log("Enroll Student Form submission triggered");
    
    if (!scope.orgId || !scope.branchId) {
      setErr("Select an organization and branch first.");
      console.log("Scope validation failed: orgId or branchId missing");
      return;
    }

    if (!validateForm()) {
      console.log("Form validation failed, blocking submission");
      return;
    }

    setErr(null);
    setBusy(true);
    console.log("Sending request to /api/students/enroll with data:", f);
    
    try {
      const res = await fetch("/api/students/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: f.email,
          fullName: f.fullName,
          enrollmentDate: f.enrollmentDate,
          cohortYear: Number(f.cohortYear),
          orgId: scope.orgId,
          branchId: scope.branchId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      console.log("API Response:", { status: res.status, data: d });
      
      if (!res.ok) {
        console.log("API request failed with error:", d);
        return setErr(fmtErr(d));
      }
      
      const temporaryPassword = d.temporaryPassword;
      console.log("Form submission successful, temporary password generated");
      onDone(`Enrolled ${f.fullName}. Temporary password: ${temporaryPassword}`);
      setF({ email: "", fullName: "", enrollmentDate: "", cohortYear: "" });
      setFieldErrors({});
    } catch (error) {
      console.error("Form submission error:", error);
      setErr("An unexpected error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Enroll student">
      <ScopeHint scope={scope} />
      <form onSubmit={submit} style={formGrid}>
        <div>
          <input
            style={inp}
            placeholder="Email"
            type="email"
            disabled={disabled}
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
          {fieldErrors.email && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.email}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            placeholder="Full name"
            disabled={disabled}
            value={f.fullName}
            onChange={(e) => setF({ ...f, fullName: e.target.value })}
          />
          {fieldErrors.fullName && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.fullName}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            type="date"
            disabled={disabled}
            value={f.enrollmentDate}
            onChange={(e) => setF({ ...f, enrollmentDate: e.target.value })}
          />
          {fieldErrors.enrollmentDate && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.enrollmentDate}
            </p>
          )}
        </div>
        <div>
          <input
            style={inp}
            placeholder="Cohort year (e.g. 2030)"
            type="number"
            disabled={disabled}
            value={f.cohortYear}
            onChange={(e) => setF({ ...f, cohortYear: e.target.value })}
          />
          {fieldErrors.cohortYear && (
            <p role="alert" style={fieldErrorStyle}>
              {fieldErrors.cohortYear}
            </p>
          )}
        </div>
        {err && (
          <p role="alert" style={errStyle}>
            {err}
          </p>
        )}
        <button type="submit" disabled={busy || disabled} style={btn(busy || disabled)}>
          {busy ? "Saving…" : "Enroll"}
        </button>
      </form>
    </Section>
  );
}

function CreateClassForm({
  scope,
  onDone,
}: {
  scope: TenantScope;
  onDone: (m: string) => void;
}) {
  const [f, setF] = useState({ subject: "", term: "", credits: "3" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !scope.branchId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!scope.branchId) {
      setErr("Select a branch first.");
      return;
    }

    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/classes/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: f.subject,
          term: f.term,
          credits: Number(f.credits),
          branchId: scope.branchId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Created class "${f.subject}".`);
      setF({ subject: "", term: "", credits: "3" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Create class">
      <ScopeHint scope={scope} />
      <form onSubmit={submit} style={formGrid}>
        <input
          style={inp}
          placeholder="Subject (e.g. Algebra 2)"
          required
          disabled={disabled}
          value={f.subject}
          onChange={(e) => setF({ ...f, subject: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Term (e.g. Fall 2026)"
          required
          disabled={disabled}
          value={f.term}
          onChange={(e) => setF({ ...f, term: e.target.value })}
        />
        <input
          style={inp}
          type="number"
          min={1}
          max={12}
          placeholder="Credits (1-12)"
          required
          disabled={disabled}
          value={f.credits}
          onChange={(e) => setF({ ...f, credits: e.target.value })}
        />
        {err && (
          <p role="alert" style={errStyle}>
            {err}
          </p>
        )}
        <button type="submit" disabled={busy || disabled} style={btn(busy || disabled)}>
          {busy ? "Saving…" : "Create class"}
        </button>
      </form>
    </Section>
  );
}

function AssignClassForm({
  students,
  classes,
  onDone,
}: {
  students: StudentRow[];
  classes: ClassRow[];
  onDone: (m: string) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [classId, setClassId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!students.some((student) => student.studentProfileId === studentId)) {
      setStudentId("");
    }
  }, [studentId, students]);

  useEffect(() => {
    if (!classes.some((klass) => klass.id === classId)) {
      setClassId("");
    }
  }, [classId, classes]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/classes/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId, classId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone("Student assigned to class.");
      setStudentId("");
      setClassId("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Assign student to class">
      {students.length === 0 || classes.length === 0 ? (
        <p style={dim}>Add at least one student and one class first.</p>
      ) : (
        <form onSubmit={submit} style={formGrid}>
          <select
            style={inp}
            required
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">Select student…</option>
            {students.map((s) => (
              <option key={s.studentProfileId} value={s.studentProfileId}>
                {s.fullName}
              </option>
            ))}
          </select>
          <select
            style={inp}
            required
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject} ({c.term})
              </option>
            ))}
          </select>
          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}
          <button type="submit" disabled={busy} style={btn(busy)}>
            {busy ? "Saving…" : "Assign"}
          </button>
        </form>
      )}
    </Section>
  );
}

function AssignStaffForm({
  staff,
  classes,
  onDone,
}: {
  staff: StaffRow[];
  classes: ClassRow[];
  onDone: (m: string) => void;
}) {
  // Only active staff can be routed to a roster (the service rejects others).
  const activeStaff = useMemo(
    () => staff.filter((s) => s.status === "active"),
    [staff],
  );
  const [staffId, setStaffId] = useState("");
  const [classId, setClassId] = useState("");
  const [role, setRole] = useState("lead");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeStaff.some((s) => s.staffProfileId === staffId)) setStaffId("");
  }, [staffId, activeStaff]);

  useEffect(() => {
    if (!classes.some((c) => c.id === classId)) setClassId("");
  }, [classId, classes]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/staff/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staffProfileId: staffId, classId, role }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone("Staff assigned to class.");
      setStaffId("");
      setClassId("");
      setRole("lead");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Assign staff to class">
      {activeStaff.length === 0 || classes.length === 0 ? (
        <p style={dim}>
          Add at least one active staff member and one class first.
        </p>
      ) : (
        <form onSubmit={submit} style={formGrid}>
          <select
            style={inp}
            required
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            <option value="">Select staff…</option>
            {activeStaff.map((s) => (
              <option key={s.staffProfileId} value={s.staffProfileId}>
                {s.fullName} ({s.department})
              </option>
            ))}
          </select>
          <select
            style={inp}
            required
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject} ({c.term})
              </option>
            ))}
          </select>
          <select
            style={inp}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="lead">lead</option>
            <option value="assistant">assistant</option>
          </select>
          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}
          <button type="submit" disabled={busy} style={btn(busy)}>
            {busy ? "Saving…" : "Assign staff"}
          </button>
        </form>
      )}
    </Section>
  );
}

function Gradebook({
  enrollments,
  onDone,
}: {
  enrollments: EnrollmentRow[];
  onDone: (m: string) => void;
}) {
  const byClass = useMemo(() => {
    const map = new Map<string, EnrollmentRow[]>();
    for (const e of enrollments) {
      const list = map.get(e.classId) ?? [];
      list.push(e);
      map.set(e.classId, list);
    }
    return [...map.values()];
  }, [enrollments]);

  if (enrollments.length === 0) {
    return (
      <p style={dim}>
        No enrollments yet. Assign students to classes first, then grade them
        here.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {byClass.map((rows) => (
        <div key={rows[0].classId}>
          <strong style={{ fontSize: 13 }}>
            {rows[0].classSubject}{" "}
            <span style={{ opacity: 0.6 }}>
              ({rows[0].term} · {rows[0].credits} cr)
            </span>
          </strong>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              marginTop: 4,
            }}
          >
            <tbody>
              {rows.map((e) => (
                <GradeRow key={e.enrollmentId} e={e} onDone={onDone} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function GradeRow({
  e,
  onDone,
}: {
  e: EnrollmentRow;
  onDone: (m: string) => void;
}) {
  const [grade, setGrade] = useState(e.finalGrade ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!grade) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/enrollments/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollmentId: e.enrollmentId, finalGrade: grade }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Graded ${e.studentName}: ${grade}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <td style={{ padding: 8 }}>{e.studentName}</td>
      <td style={{ padding: 8 }}>
        <StatusBadge status={e.status} />
      </td>
      <td style={{ padding: 8 }}>
        <select
          style={{ ...inp, padding: "4px 8px" }}
          value={grade}
          onChange={(ev) => setGrade(ev.target.value)}
        >
          <option value="">—</option>
          {VALID_GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: 8 }}>
        <button
          type="button"
          onClick={save}
          disabled={busy || !grade}
          style={miniBtn}
        >
          {busy ? "…" : "Save"}
        </button>
        {err && (
          <span style={{ ...errStyle, marginLeft: 6 }} role="alert">
            {err}
          </span>
        )}
      </td>
    </tr>
  );
}

function PromoteStudentForm({
  students,
  classes,
  onDone,
}: {
  students: StudentRow[];
  classes: ClassRow[];
  onDone: (m: string) => void;
}) {
  const terms = useMemo(
    () => [...new Set(classes.map((c) => c.term))],
    [classes],
  );
  const [studentId, setStudentId] = useState("");
  const [term, setTerm] = useState("");
  const [outcome, setOutcome] = useState("promoted");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!students.some((s) => s.studentProfileId === studentId)) setStudentId("");
  }, [studentId, students]);
  useEffect(() => {
    if (!terms.includes(term)) setTerm("");
  }, [term, terms]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/students/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentProfileId: studentId, term, outcome }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Recorded ${outcome} for ${term}.`);
      setStudentId("");
      setTerm("");
      setOutcome("promoted");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Promote student">
      {students.length === 0 || terms.length === 0 ? (
        <p style={dim}>Add at least one student and one class (term) first.</p>
      ) : (
        <form onSubmit={submit} style={formGrid}>
          <select
            style={inp}
            required
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">Select student…</option>
            {students.map((s) => (
              <option key={s.studentProfileId} value={s.studentProfileId}>
                {s.fullName}
              </option>
            ))}
          </select>
          <select
            style={inp}
            required
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          >
            <option value="">Select term…</option>
            {terms.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            style={inp}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            {PROMOTION_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}
          <button type="submit" disabled={busy} style={btn(busy)}>
            {busy ? "Saving…" : "Apply progression"}
          </button>
        </form>
      )}
    </Section>
  );
}

interface TranscriptData {
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

function TranscriptViewer({ students }: { students: StudentRow[] }) {
  const [studentId, setStudentId] = useState("");
  const [data, setData] = useState<TranscriptData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function view() {
    if (!studentId) return;
    setBusy(true);
    setErr(null);
    setData(null);
    try {
      const res = await fetch(`/api/students/${studentId}/transcript`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      setData(d);
    } finally {
      setBusy(false);
    }
  }

  const gpa = (v: number | null) => (v === null ? "—" : v.toFixed(2));

  return (
    <Section title="Transcript">
      {students.length === 0 ? (
        <p style={dim}>No students to show a transcript for yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              style={{ ...inp, flex: 1 }}
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                setData(null);
              }}
            >
              <option value="">Select student…</option>
              {students.map((s) => (
                <option key={s.studentProfileId} value={s.studentProfileId}>
                  {s.fullName}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={view}
              disabled={busy || !studentId}
              style={{ ...btn(busy || !studentId), width: "auto", padding: "0 16px" }}
            >
              {busy ? "Loading…" : "View"}
            </button>
          </div>

          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}

          {data && (
            <div style={tenantCard}>
              <div style={{ marginBottom: 8 }}>
                <strong>{data.student.fullName}</strong>{" "}
                <StatusBadge status={data.student.status} />
                <div style={dim}>
                  {data.student.email} · cohort {data.student.cohortYear} · level{" "}
                  {data.student.currentLevel} · cumulative GPA{" "}
                  {gpa(data.cumulativeGpa)} ({data.totalGradedCredits} cr)
                  {data.student.graduationDate
                    ? ` · graduated ${data.student.graduationDate}`
                    : ""}
                </div>
              </div>

              {data.terms.length === 0 ? (
                <p style={dim}>No coursework recorded.</p>
              ) : (
                data.terms.map((t) => (
                  <div key={t.term} style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {t.term}{" "}
                      <span style={{ ...dim, fontWeight: 400 }}>
                        — term GPA {gpa(t.termGpa)} ({t.gradedCredits} cr)
                      </span>
                    </div>
                    <ul
                      style={{
                        margin: "4px 0 0",
                        paddingLeft: 16,
                        fontSize: 12,
                      }}
                    >
                      {t.courses.map((c, i) => (
                        <li key={i}>
                          {c.subject} ({c.credits} cr) —{" "}
                          {c.grade ?? "ungraded"}{" "}
                          <span style={{ opacity: 0.5 }}>[{c.status}]</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}

              {data.promotions.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    Progression history
                  </div>
                  <ul
                    style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12 }}
                  >
                    {data.promotions.map((p, i) => (
                      <li key={i}>
                        {p.term}: {p.outcome} (level {p.fromLevel} → {p.toLevel}
                        {p.termGpa ? `, GPA ${p.termGpa}` : ""})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function TutorPanel({ classes }: { classes: ClassRow[] }) {
  const [classId, setClassId] = useState("");
  const [query, setQuery] = useState("");
  const [whiteboard, setWhiteboard] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!classes.some((klass) => klass.id === classId)) {
      setClassId("");
    }
  }, [classId, classes]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setAnswer(null);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/tutor-copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classId,
          query,
          whiteboardContext: whiteboard || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d) + " (is GEMMA_API_KEY configured?)");
      setAnswer(d.answer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="AI Tutor (Gemma)">
      {classes.length === 0 ? (
        <p style={dim}>Create a class first to scope a tutor question.</p>
      ) : (
        <form onSubmit={submit} style={{ ...formGrid, maxWidth: 560 }}>
          <select
            style={inp}
            required
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject} ({c.term})
              </option>
            ))}
          </select>
          <textarea
            style={{ ...inp, minHeight: 64, fontFamily: "inherit" }}
            placeholder="Question for the tutor (e.g. Find the determinant of [[2,1],[1,3]])"
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <textarea
            style={{ ...inp, minHeight: 48, fontFamily: "inherit" }}
            placeholder="Optional whiteboard context"
            value={whiteboard}
            onChange={(e) => setWhiteboard(e.target.value)}
          />
          {err && (
            <p role="alert" style={errStyle}>
              {err}
            </p>
          )}
          <button type="submit" disabled={busy} style={btn(busy)}>
            {busy ? "Asking Gemma…" : "Ask tutor"}
          </button>
          {answer && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#11162a",
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {answer}
            </pre>
          )}
        </form>
      )}
    </Section>
  );
}

function CreateOrganizationForm({
  onCreated,
}: {
  onCreated: (org: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onCreated(d);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...formGrid, marginTop: 8, maxWidth: "none" }}>
      <input
        style={inp}
        placeholder="Organization name (e.g. West Network)"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {err && (
        <p role="alert" style={errStyle}>
          {err}
        </p>
      )}
      <button type="submit" disabled={busy} style={btn(busy)}>
        {busy ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}

function CreateBranchForm({
  orgId,
  orgName,
  onCreated,
}: {
  orgId: string | null;
  orgName: string | null;
  onCreated: (branch: {
    id: string;
    orgId: string;
    location: string;
  }) => void;
}) {
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("active");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !orgId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) {
      setErr("Select an organization first.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, location, status }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onCreated(d);
      setLocation("");
      setStatus("active");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...formGrid, marginTop: 8, maxWidth: "none" }}>
      <p style={{ ...dim, margin: 0 }}>
        {orgId
          ? `Adds a branch to ${orgName ?? "the selected organization"}.`
          : "Select an organization above to add a branch."}
      </p>
      <input
        style={inp}
        placeholder="Branch location (e.g. Riverside Campus)"
        required
        disabled={disabled}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
      />
      <select
        style={inp}
        disabled={disabled}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="active">active</option>
        <option value="pending">pending</option>
        <option value="inactive">inactive</option>
      </select>
      {err && (
        <p role="alert" style={errStyle}>
          {err}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || disabled}
        style={btn(busy || disabled)}
      >
        {busy ? "Creating…" : "Create branch"}
      </button>
    </form>
  );
}

function TenantOverview({
  organizations,
}: {
  organizations: TenantOrganization[];
}) {
  if (organizations.length === 0) {
    return <p style={dim}>No organizations found yet.</p>;
  }

  return (
    <div style={tenantOverview}>
      {organizations.map((org) => (
        <div key={org.id} style={tenantCard}>
          <strong style={{ display: "block", marginBottom: 8 }}>{org.name}</strong>
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
        </div>
      ))}
    </div>
  );
}

function ScopeHint({ scope }: { scope: TenantScope }) {
  if (!scope.orgId || !scope.branchId) {
    return <p style={dim}>Select a branch scope to enable this form.</p>;
  }

  return (
    <p style={dim}>
      Scope: {scope.orgName ?? "Organization"} / {scope.branchName ?? scope.branchId}
    </p>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={metricCard}>
      <div style={{ ...dim, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, opacity: 0.85, marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  );
}

/** Allowed lifecycle actions per current status (mirrors the server's rules). */
const STAFF_ACTIONS: Record<string, { label: string; status: string }[]> = {
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
  // enrollment statuses
  enrolled: "#7fd1ff",
  completed: "#9be8b4",
  withdrawn: "#ff8080",
  // student statuses
  graduated: "#c9b6ff",
  dropped: "#ff8080",
};

function StatusBadge({ status }: { status: string }) {
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

function StaffLifecycleRoster({
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
                            onChange(
                              s.staffProfileId,
                              a.status,
                              a.label.toLowerCase(),
                            )
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

function Roster({
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

function pickInitialScope(
  organizations: TenantOrganization[],
  fallbackBranchId: string | null,
): { orgId: string | null; branchId: string | null } {
  if (organizations.length === 0) {
    return { orgId: null, branchId: null };
  }

  const matchingOrg = fallbackBranchId
    ? organizations.find((org) =>
        org.branches.some((branch) => branch.id === fallbackBranchId),
      ) ?? null
    : null;

  const org = matchingOrg ?? organizations[0];
  const branch =
    org.branches.find((candidate) => candidate.id === fallbackBranchId) ??
    org.branches[0] ??
    null;

  return {
    orgId: org.id,
    branchId: branch?.id ?? null,
  };
}

function fmtErr(d: { error?: string; fields?: Record<string, string> }): string {
  if (d.fields) {
    return Object.entries(d.fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
  }
  return d.error ?? "Request failed";
}

const page: React.CSSProperties = {
  maxWidth: 960,
  margin: "0 auto",
  padding: "40px 24px 64px",
};
const dim: React.CSSProperties = { opacity: 0.55, fontSize: 13 };
const formGrid: React.CSSProperties = {
  display: "grid",
  gap: 10,
  maxWidth: 420,
};
const tenantGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  marginBottom: 16,
};
const tenantOverview: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};
const tenantCard: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: 12,
  background: "#0f1424",
};
const metricGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 12,
  marginBottom: 16,
};
const metricCard: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: 12,
  background: "#0f1424",
};
const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 13,
};
const inp: React.CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "#11162a",
  color: "#e6e9f2",
  fontSize: 13,
};
const errStyle: React.CSSProperties = {
  color: "#ff8080",
  fontSize: 13,
  margin: 0,
};
const fieldErrorStyle: React.CSSProperties = {
  color: "#ff8080",
  fontSize: 12,
  margin: "4px 0 0 0",
  padding: 0,
};
const miniBtn: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "#1a2138",
  color: "#e6e9f2",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};
const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "rgba(255,255,255,0.06)",
  borderRadius: 6,
  padding: "2px 8px",
  fontSize: 12,
};
const chipX: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#ff8080",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
  marginLeft: 2,
};
const warnStyle: React.CSSProperties = {
  background: "#352713",
  color: "#ffcf8f",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
};
const successStyle: React.CSSProperties = {
  background: "#13351f",
  color: "#9be8b4",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
};

function btn(disabled: boolean): React.CSSProperties {
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

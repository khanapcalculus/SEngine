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
}

interface AuditRow {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
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

  const [tenantTree, setTenantTree] = useState<TenantOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);

  const clearBranchData = useCallback(() => {
    setStaff([]);
    setStudents([]);
    setClasses([]);
    setAudit([]);
  }, []);

  const refresh = useCallback(
    async (bid: string, role: string) => {
      const get = async (url: string) => {
        const r = await fetch(url);
        return r.ok ? r.json() : null;
      };

      const [s, st, c] = await Promise.all([
        get(`/api/staff/branch/${bid}`),
        get(`/api/students/branch/${bid}`),
        get(`/api/classes/branch/${bid}`),
      ]);

      setStaff(Array.isArray(s?.staff) ? s.staff : []);
      setStudents(Array.isArray(st?.students) ? st.students : []);
      setClasses(Array.isArray(c?.classes) ? c.classes : []);

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
    setNotice(msg);
    reload();
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
        <Roster
          rows={staff.map((s) => [s.fullName, s.email, s.department, s.status])}
          head={["Name", "Email", "Dept", "Status"]}
          empty="No active staff in this branch yet."
          keyOf={(_r, i) => staff[i].staffProfileId}
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
          <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13 }}>
            {classes.map((c) => (
              <li key={c.id}>
                {c.subject} - <span style={{ opacity: 0.6 }}>{c.term}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <OnboardStaffForm scope={scope} onDone={flash} />
      <EnrollStudentForm scope={scope} onDone={flash} />
      {isManager(me?.role) && <CreateClassForm scope={scope} onDone={flash} />}
      <AssignClassForm students={students} classes={classes} onDone={flash} />

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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !scope.orgId || !scope.branchId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!scope.orgId || !scope.branchId) {
      setErr("Select an organization and branch first.");
      return;
    }

    setErr(null);
    setBusy(true);
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
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Onboarded ${f.fullName}.`);
      setF({ email: "", fullName: "", department: "", hireDate: "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Onboard staff">
      <ScopeHint scope={scope} />
      <form onSubmit={submit} style={formGrid}>
        <input
          style={inp}
          placeholder="Email"
          type="email"
          required
          disabled={disabled}
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Full name"
          required
          disabled={disabled}
          value={f.fullName}
          onChange={(e) => setF({ ...f, fullName: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Department"
          required
          disabled={disabled}
          value={f.department}
          onChange={(e) => setF({ ...f, department: e.target.value })}
        />
        <input
          style={inp}
          type="date"
          required
          disabled={disabled}
          value={f.hireDate}
          onChange={(e) => setF({ ...f, hireDate: e.target.value })}
        />
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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = !scope.orgId || !scope.branchId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!scope.orgId || !scope.branchId) {
      setErr("Select an organization and branch first.");
      return;
    }

    setErr(null);
    setBusy(true);
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
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Enrolled ${f.fullName}.`);
      setF({ email: "", fullName: "", enrollmentDate: "", cohortYear: "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Enroll student">
      <ScopeHint scope={scope} />
      <form onSubmit={submit} style={formGrid}>
        <input
          style={inp}
          placeholder="Email"
          type="email"
          required
          disabled={disabled}
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Full name"
          required
          disabled={disabled}
          value={f.fullName}
          onChange={(e) => setF({ ...f, fullName: e.target.value })}
        />
        <input
          style={inp}
          type="date"
          required
          disabled={disabled}
          value={f.enrollmentDate}
          onChange={(e) => setF({ ...f, enrollmentDate: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Cohort year (e.g. 2030)"
          type="number"
          required
          disabled={disabled}
          value={f.cohortYear}
          onChange={(e) => setF({ ...f, cohortYear: e.target.value })}
        />
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
  const [f, setF] = useState({ subject: "", term: "" });
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
        body: JSON.stringify({ ...f, branchId: scope.branchId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Created class "${f.subject}".`);
      setF({ subject: "", term: "" });
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

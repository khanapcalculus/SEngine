"use client";

/**
 * Shared dashboard state. Fetches the caller (/api/auth/me) once, manages the
 * super-admin org/branch scope, loads the branch-scoped datasets, and exposes
 * mutation handlers — so the role-routed pages stay thin and never re-fetch the
 * identity. Replaces the giant single-page component's local state.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  fmtErr,
  isManager,
  isSuperAdmin,
  pickInitialScope,
  type AssignmentRow,
  type AuditRow,
  type ClassRow,
  type EnrollmentRow,
  type Me,
  type StaffRow,
  type StudentRow,
  type TenantOrganization,
  type TenantScope,
} from "./_components/ui";

interface DashboardValue {
  me: Me;
  scope: TenantScope;
  tenantTree: TenantOrganization[];
  selectedOrgId: string;
  selectedBranchId: string;
  onOrgChange: (orgId: string) => void;
  setSelectedBranchId: (branchId: string) => void;
  staff: StaffRow[];
  students: StudentRow[];
  classes: ClassRow[];
  assignments: AssignmentRow[];
  enrollments: EnrollmentRow[];
  audit: AuditRow[];
  assignmentsByClass: Record<string, AssignmentRow[]>;
  notice: string | null;
  tenantError: string | null;
  actionError: string | null;
  flash: (msg: string) => void;
  reload: () => void;
  logout: () => Promise<void>;
  onStaffStatusChange: (id: string, status: string, label: string) => void;
  onUnassign: (assignmentId: string) => void;
  refreshTenantTree: (select?: {
    orgId?: string;
    branchId?: string;
  }) => Promise<TenantOrganization[]>;
  handleOrgCreated: (org: { id: string; name: string }) => Promise<void>;
  handleBranchCreated: (b: {
    id: string;
    orgId: string;
    location: string;
  }) => Promise<void>;
}

const Ctx = createContext<DashboardValue | null>(null);

export function useDashboard(): DashboardValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDashboard must be used within DashboardProvider");
  return v;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
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

  const refresh = useCallback(async (bid: string, role: string) => {
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
  }, []);

  const loadTenantTree = useCallback(async (): Promise<TenantOrganization[]> => {
    const res = await fetch("/api/admin/tenant-tree");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(fmtErr(data));
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
            const orgs = await loadTenantTree();
            if (!active) return;
            setTenantTree(orgs);
            const initial = pickInitialScope(orgs, data.branchId);
            setSelectedOrgId(initial.orgId ?? "");
            setSelectedBranchId(initial.branchId ?? "");
          } catch (err) {
            if (!active) return;
            setTenantError(
              err instanceof Error ? err.message : "Unable to load organizations.",
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
    () => tenantTree.find((o) => o.id === selectedOrgId) ?? null,
    [tenantTree, selectedOrgId],
  );
  const selectedBranch = useMemo(
    () => selectedOrg?.branches.find((b) => b.id === selectedBranchId) ?? null,
    [selectedOrg, selectedBranchId],
  );

  useEffect(() => {
    if (!isSuperAdmin(me?.role) || !selectedOrg) return;
    if (
      selectedBranchId &&
      selectedOrg.branches.some((b) => b.id === selectedBranchId)
    )
      return;
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

  const reload = useCallback(() => {
    if (scope.branchId && me) void refresh(scope.branchId, me.role);
  }, [scope.branchId, me, refresh]);

  const flash = useCallback(
    (msg: string) => {
      setActionError(null);
      setNotice(msg);
      reload();
    },
    [reload],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }, [router]);

  const onUnassign = useCallback(
    async (assignmentId: string) => {
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
    },
    [flash],
  );

  const onStaffStatusChange = useCallback(
    async (staffProfileId: string, status: string, label: string) => {
      if (
        (status === "retired" || status === "terminated") &&
        !window.confirm(
          `Mark this staff member as ${status}? This is a recorded lifecycle change.`,
        )
      )
        return;
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
    },
    [flash],
  );

  const onOrgChange = useCallback(
    (nextOrgId: string) => {
      setSelectedOrgId(nextOrgId);
      const nextOrg = tenantTree.find((o) => o.id === nextOrgId) ?? null;
      setSelectedBranchId(nextOrg?.branches[0]?.id ?? "");
      setNotice(null);
    },
    [tenantTree],
  );

  const refreshTenantTree = useCallback(
    async (select?: { orgId?: string; branchId?: string }) => {
      const orgs = await loadTenantTree();
      setTenantTree(orgs);
      if (select?.orgId !== undefined) setSelectedOrgId(select.orgId);
      if (select?.branchId !== undefined) setSelectedBranchId(select.branchId);
      return orgs;
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

  const assignmentsByClass = useMemo(() => {
    const map: Record<string, AssignmentRow[]> = {};
    for (const a of assignments) (map[a.classId] ??= []).push(a);
    return map;
  }, [assignments]);

  if (loading) {
    return (
      <main style={{ padding: "40px 24px" }}>
        <p style={{ opacity: 0.6 }}>Loading…</p>
      </main>
    );
  }
  if (!me) return null; // redirecting to /login

  const value: DashboardValue = {
    me,
    scope,
    tenantTree,
    selectedOrgId,
    selectedBranchId,
    onOrgChange,
    setSelectedBranchId,
    staff,
    students,
    classes,
    assignments,
    enrollments,
    audit,
    assignmentsByClass,
    notice,
    tenantError,
    actionError,
    flash,
    reload,
    logout,
    onStaffStatusChange,
    onUnassign,
    refreshTenantTree,
    handleOrgCreated,
    handleBranchCreated,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

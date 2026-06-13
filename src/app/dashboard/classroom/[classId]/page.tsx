"use client";

/**
 * Classroom — the per-class LMS view (assignments + discussions). Reached from
 * a teacher's My Classes or a student's My Transcript. Any class member may open
 * it; the APIs enforce membership, so non-members see a friendly notice.
 */
import { useParams } from "next/navigation";
import { useDashboard } from "../../DashboardProvider";
import { RoleGuard } from "../../_components/RoleGuard";
import { AssignmentsPanel, DiscussionsPanel } from "../../_components/lms";
import { isManager, dim } from "../../_components/ui";
import type { Role } from "../../../../lib/rbac";

const MEMBERS: Role[] = ["super_admin", "branch_manager", "teacher", "student"];

export default function ClassroomPage() {
  const params = useParams();
  const classId =
    typeof params.classId === "string"
      ? params.classId
      : Array.isArray(params.classId)
        ? params.classId[0]
        : "";
  const { me } = useDashboard();
  const canManage = isManager(me.role) || me.role === "teacher";
  const isStudent = me.role === "student";

  return (
    <RoleGuard allow={MEMBERS}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Classroom</h1>
      <p style={dim}>Class {classId.slice(0, 8)}…</p>
      {classId ? (
        <>
          <AssignmentsPanel
            classId={classId}
            canManage={canManage}
            isStudent={isStudent}
          />
          <DiscussionsPanel classId={classId} />
        </>
      ) : (
        <p style={dim}>No class selected.</p>
      )}
    </RoleGuard>
  );
}

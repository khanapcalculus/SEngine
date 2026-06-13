"use client";

/** Students — enrollment, roster, term promotion, and transcript view (managers). */
import { useDashboard } from "../DashboardProvider";
import { RoleGuard } from "../_components/RoleGuard";
import {
  EnrollStudentForm,
  AssignClassForm,
  PromoteStudentForm,
  TranscriptViewer,
} from "../_components/forms";
import { Section, Roster, warnStyle } from "../_components/ui";

export default function StudentsPage() {
  const { scope, students, classes, flash } = useDashboard();

  return (
    <RoleGuard allow={["super_admin", "branch_manager"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Students</h1>

      {!scope.branchId && (
        <p style={warnStyle}>Select a branch to load students.</p>
      )}

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

      <EnrollStudentForm scope={scope} onDone={flash} />
      <AssignClassForm students={students} classes={classes} onDone={flash} />
      <PromoteStudentForm students={students} classes={classes} onDone={flash} />
      <TranscriptViewer students={students} />
    </RoleGuard>
  );
}

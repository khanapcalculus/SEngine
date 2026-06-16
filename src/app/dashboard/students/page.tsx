"use client";

/** Students — enrollment, roster, term promotion, and transcript view (managers). */
import Link from "next/link";
import { useDashboard } from "../DashboardProvider";
import { RoleGuard } from "../_components/RoleGuard";
import {
  EnrollStudentForm,
  AssignClassForm,
  PromoteStudentForm,
  TranscriptViewer,
} from "../_components/forms";
import { Section, Roster, warnStyle, dim } from "../_components/ui";

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

      {students.length > 0 && (
        <Section title="Student profiles (360°)">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "grid", gap: 4 }}>
            {students.map((s) => (
              <li key={s.studentProfileId}>
                <Link href={`/dashboard/students/${s.studentProfileId}`} style={{ color: "#7fb0ff" }}>
                  {s.fullName}
                </Link>{" "}
                <span style={dim}>— transcript, fees, credentials, guardians</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <EnrollStudentForm scope={scope} onDone={flash} />
      <AssignClassForm students={students} classes={classes} onDone={flash} />
      <PromoteStudentForm students={students} classes={classes} onDone={flash} />
      <TranscriptViewer students={students} />
    </RoleGuard>
  );
}

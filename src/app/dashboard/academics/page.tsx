"use client";

/** Gradebook — branch-wide grade entry (managers). */
import { useDashboard } from "../DashboardProvider";
import { RoleGuard } from "../_components/RoleGuard";
import { Gradebook } from "../_components/forms";
import { Section, warnStyle } from "../_components/ui";

export default function AcademicsPage() {
  const { scope, enrollments, flash } = useDashboard();

  return (
    <RoleGuard allow={["super_admin", "branch_manager"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Gradebook</h1>
      {!scope.branchId && (
        <p style={warnStyle}>Select a branch to load the gradebook.</p>
      )}
      <Section title="Gradebook">
        <Gradebook enrollments={enrollments} onDone={flash} />
      </Section>
    </RoleGuard>
  );
}

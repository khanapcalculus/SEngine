"use client";

/** Gradebook — branch-wide grade entry + classroom links (managers). */
import Link from "next/link";
import { useDashboard } from "../DashboardProvider";
import { RoleGuard } from "../_components/RoleGuard";
import { Gradebook } from "../_components/forms";
import { Section, dim, warnStyle } from "../_components/ui";

export default function AcademicsPage() {
  const { scope, classes, enrollments, flash } = useDashboard();

  return (
    <RoleGuard allow={["super_admin", "branch_manager"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Gradebook</h1>
      {!scope.branchId && (
        <p style={warnStyle}>Select a branch to load the gradebook.</p>
      )}

      <Section title="Classrooms">
        {classes.length === 0 ? (
          <p style={dim}>No classes yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {classes.map((c) => (
              <li key={c.id}>
                <Link href={`/dashboard/classroom/${c.id}`} style={{ color: "#7fb0ff" }}>
                  {c.subject}
                </Link>{" "}
                <span style={{ opacity: 0.6 }}>
                  ({c.term} · {c.credits} cr)
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Gradebook">
        <Gradebook enrollments={enrollments} onDone={flash} />
      </Section>
    </RoleGuard>
  );
}

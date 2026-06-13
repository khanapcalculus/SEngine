"use client";

/** Staff (HR) — onboarding, lifecycle/termination, and class staffing (managers). */
import { useDashboard } from "../DashboardProvider";
import { RoleGuard } from "../_components/RoleGuard";
import { OnboardStaffForm, AssignStaffForm } from "../_components/forms";
import {
  Section,
  StaffLifecycleRoster,
  chip,
  chipX,
  dim,
  warnStyle,
} from "../_components/ui";

export default function StaffPage() {
  const {
    scope,
    staff,
    classes,
    assignmentsByClass,
    onStaffStatusChange,
    onUnassign,
    flash,
  } = useDashboard();

  return (
    <RoleGuard allow={["super_admin", "branch_manager"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Staff (HR)</h1>

      {!scope.branchId && (
        <p style={warnStyle}>Select a branch to load staff.</p>
      )}

      <Section title="Staff roster">
        <StaffLifecycleRoster
          staff={staff}
          canManage
          onChange={onStaffStatusChange}
        />
      </Section>

      <OnboardStaffForm scope={scope} onDone={flash} />
      <AssignStaffForm staff={staff} classes={classes} onDone={flash} />

      <Section title="Class staffing">
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
                          <button
                            type="button"
                            onClick={() => onUnassign(a.assignmentId)}
                            style={chipX}
                            title="Unassign"
                            aria-label={`Unassign ${a.fullName}`}
                          >
                            ×
                          </button>
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
    </RoleGuard>
  );
}

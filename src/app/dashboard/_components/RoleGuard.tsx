"use client";

/**
 * Client-side page guard. Renders its children only when the authenticated
 * caller's role is permitted; otherwise shows the 403 component. This is the
 * UX intercept (a Tutor typing /dashboard/staff sees "Not authorized"); the
 * real enforcement is the API `requireRole` guards + edge middleware.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { useDashboard } from "../DashboardProvider";
import { canAccess, type Role } from "../../../lib/rbac";
import { dim } from "./ui";

export function Forbidden403() {
  return (
    <div style={{ padding: "40px 0", maxWidth: 480 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>403 — Not authorized</h1>
      <p style={dim}>
        Your role does not have access to this page. If you believe this is a
        mistake, contact your administrator.
      </p>
      <Link
        href="/dashboard"
        style={{ color: "#7fb0ff", fontSize: 14, display: "inline-block", marginTop: 12 }}
      >
        ← Back to your dashboard
      </Link>
    </div>
  );
}

export function RoleGuard({
  allow,
  children,
}: {
  allow: Role[];
  children: ReactNode;
}) {
  const { me } = useDashboard();
  if (!canAccess(me.role, allow)) return <Forbidden403 />;
  return <>{children}</>;
}

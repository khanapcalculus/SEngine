"use client";

/**
 * Role-filtered navigation sidebar. Renders only the NAV_ITEMS the caller's
 * role is allowed to see (a Tutor never even sees the HR/Org links), and
 * highlights the active route.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, canAccess } from "../../../lib/rbac";
import { useDashboard } from "../DashboardProvider";

export function Sidebar() {
  const { me } = useDashboard();
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((n) => canAccess(me.role, n.allowedRoles));

  return (
    <nav
      style={{
        width: 210,
        flexShrink: 0,
        borderRight: "1px solid rgba(255,255,255,0.08)",
        padding: "20px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, padding: "0 8px 12px" }}>
        SEngine
      </div>
      {items.map((n) => {
        const active =
          n.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            style={{
              display: "block",
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 13,
              textDecoration: "none",
              color: active ? "#fff" : "#c7cde0",
              background: active ? "#5570ff" : "transparent",
              fontWeight: active ? 600 : 400,
            }}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

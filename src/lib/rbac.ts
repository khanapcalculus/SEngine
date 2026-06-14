/**
 * Edge-safe role-based access matrix — the single source of truth for which
 * roles may see which dashboard routes. Imported by BOTH the client `Sidebar`
 * and the edge `middleware.ts`, so it must stay dependency-free (NO drizzle /
 * node imports). The five roles mirror `userRoleEnum` in `db/schema.ts`.
 */
export type Role =
  | "super_admin"
  | "branch_manager"
  | "teacher"
  | "student"
  | "parent";

export interface NavItem {
  href: string;
  label: string;
  allowedRoles: Role[];
}

const MANAGERS: Role[] = ["super_admin", "branch_manager"];
const ALL: Role[] = [
  "super_admin",
  "branch_manager",
  "teacher",
  "student",
  "parent",
];

/** Sidebar order = matrix order. Each link renders only for its allowedRoles. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", allowedRoles: ALL },
  {
    href: "/dashboard/organizations",
    label: "Organizations",
    allowedRoles: ["super_admin"],
  },
  {
    href: "/dashboard/users",
    label: "User Management",
    allowedRoles: ["super_admin"],
  },
  { href: "/dashboard/staff", label: "Staff (HR)", allowedRoles: MANAGERS },
  { href: "/dashboard/students", label: "Students", allowedRoles: MANAGERS },
  { href: "/dashboard/academics", label: "Gradebook", allowedRoles: MANAGERS },
  {
    href: "/dashboard/tutor",
    label: "AI Tutor",
    allowedRoles: ["super_admin", "branch_manager", "teacher"],
  },
  {
    href: "/dashboard/my-classes",
    label: "My Classes",
    allowedRoles: ["teacher"],
  },
  {
    href: "/dashboard/transcript",
    label: "My Transcript",
    allowedRoles: ["student"],
  },
  {
    href: "/dashboard/whiteboard",
    label: "Whiteboard",
    allowedRoles: ["teacher", "student"],
  },
  {
    href: "/dashboard/settings",
    label: "Platform Settings",
    allowedRoles: ["super_admin"],
  },
];

/** True when `role` is permitted by an allowed-roles list. */
export function canAccess(role: string | undefined, allowed: Role[]): boolean {
  return !!role && (allowed as string[]).includes(role);
}

/**
 * The nav item governing a pathname — exact match first, then the longest href
 * prefix (so `/dashboard/staff/123` is gated by the `/dashboard/staff` rule).
 * The bare `/dashboard` (Overview) is open to all roles, so it never blocks.
 */
export function navItemForPath(pathname: string): NavItem | undefined {
  const exact = NAV_ITEMS.find((n) => n.href === pathname);
  if (exact) return exact;
  return NAV_ITEMS.filter(
    (n) => n.href !== "/dashboard" && pathname.startsWith(n.href + "/"),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}

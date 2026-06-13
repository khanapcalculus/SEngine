"use client";

/** Platform Settings — super_admin only. Shell + the password-bootstrap admin tool. */
import { useEffect, useState } from "react";
import { RoleGuard } from "../_components/RoleGuard";
import { Section, dim, miniBtn, fmtErr } from "../_components/ui";

interface PwUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

function UsersWithoutPasswords() {
  const [users, setUsers] = useState<PwUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/users-without-passwords");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(fmtErr(d));
        return;
      }
      setUsers(Array.isArray(d.users) ? d.users : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <p style={dim}>Loading…</p>;
  if (err) return <p style={dim}>{err}</p>;
  if (users.length === 0)
    return <p style={dim}>All users have a password set. ✓</p>;

  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 13 }}>
      {users.map((u) => (
        <li
          key={u.id}
          style={{
            padding: "8px 0",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <span>
            {u.fullName} <span style={dim}>({u.email} · {u.role})</span>
          </span>
          <button
            type="button"
            style={{ ...miniBtn, marginLeft: "auto" }}
            onClick={() => void load()}
            title="Refresh list"
          >
            refresh
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function SettingsPage() {
  return (
    <RoleGuard allow={["super_admin"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Platform Settings</h1>
      <p style={dim}>Network-wide configuration and account maintenance.</p>

      <Section title="Accounts needing a password">
        <p style={{ ...dim, marginTop: 0 }}>
          Users created without a local password (e.g. SSO-only or
          not-yet-activated). Use the reset-password flow to set one.
        </p>
        <UsersWithoutPasswords />
      </Section>

      <Section title="Network configuration">
        <p style={dim}>
          Locale, grading scale, and feature flags are stored per organization in
          global settings. A management UI for these is planned.
        </p>
      </Section>
    </RoleGuard>
  );
}

"use client";

/** Platform Settings — super_admin only. Org config + the password-bootstrap admin tool. */
import { useCallback, useEffect, useState } from "react";
import { RoleGuard } from "../_components/RoleGuard";
import { useDashboard } from "../DashboardProvider";
import { Section, dim, labelStyle, inp, miniBtn, successStyle, errStyle, fmtErr } from "../_components/ui";
import { GRADING_SCALES } from "../../../lib/validation";

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
        <OrgSettingsForm />
      </Section>
    </RoleGuard>
  );
}

/** Per-organization global settings editor (locale, grading scale, feature flags). */
function OrgSettingsForm() {
  const { scope, tenantTree, selectedOrgId } = useDashboard();
  // Prefer the explicitly selected org; fall back to the caller's own / first org.
  const orgId = selectedOrgId || scope.orgId || tenantTree[0]?.id || "";

  const [locale, setLocale] = useState("en-US");
  const [gradingScale, setGradingScale] = useState<string>("letter");
  const [flagsText, setFlagsText] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const r = await fetch(`/api/admin/organizations/${orgId}/settings`);
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setLocale(d.locale ?? "en-US");
      setGradingScale(d.gradingScale ?? "letter");
      setFlagsText(JSON.stringify(d.featureFlags ?? {}, null, 2));
    } else {
      setError(fmtErr(d));
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setError(null);
    setNotice(null);
    let featureFlags: Record<string, boolean>;
    try {
      featureFlags = JSON.parse(flagsText || "{}");
    } catch {
      setError("Feature flags must be valid JSON (an object of booleans).");
      return;
    }
    const r = await fetch(`/api/admin/organizations/${orgId}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale, gradingScale, featureFlags }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(d.fields ? Object.values(d.fields).join("; ") : fmtErr(d));
      return;
    }
    setNotice("Settings saved.");
  };

  if (!orgId) return <p style={dim}>No organization in scope.</p>;
  if (loading) return <p style={dim}>Loading…</p>;

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 460 }}>
      <p style={{ ...dim, margin: 0 }}>
        Stored per organization in <code>organizations.global_settings</code>. Applies network-wide for this tenant.
      </p>
      {notice && <p style={{ ...successStyle, margin: 0 }}>{notice}</p>}
      {error && <p style={{ ...errStyle, margin: 0 }}>{error}</p>}

      <label style={labelStyle}>
        Locale (BCP-47)
        <input style={inp} value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en-US" />
      </label>
      <label style={labelStyle}>
        Grading scale
        <select style={inp} value={gradingScale} onChange={(e) => setGradingScale(e.target.value)}>
          {GRADING_SCALES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </label>
      <label style={labelStyle}>
        Feature flags (JSON object of booleans)
        <textarea
          value={flagsText}
          onChange={(e) => setFlagsText(e.target.value)}
          rows={5}
          style={{ ...inp, fontFamily: "monospace", resize: "vertical" }}
        />
      </label>
      <button
        type="button"
        onClick={save}
        style={{ ...miniBtn, justifySelf: "start", background: "#5570ff", borderColor: "#5570ff", color: "#fff", padding: "8px 16px", fontSize: 13 }}
      >
        Save settings
      </button>
    </div>
  );
}

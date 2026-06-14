"use client";

/**
 * User Management — super_admin only. Lists every network account and lets an
 * admin edit a profile (PATCH /api/admin/users/[id]) or set/reset a login
 * password (POST /api/auth/reset-password). One row expands into one action at a
 * time. All mutations re-fetch the list so the table reflects committed state.
 */
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { RoleGuard } from "../_components/RoleGuard";
import {
  Section,
  StatusBadge,
  btn,
  fmtErr,
  dim,
  errStyle,
  successStyle,
  fieldErrorStyle,
  formGrid,
  inp,
  miniBtn,
  labelStyle,
} from "../_components/ui";

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  globalStatus: string;
  hasPassword: boolean;
  orgId: string | null;
  createdAt: string;
}

type RowAction = { id: string; mode: "edit" | "reset" } | null;

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<RowAction>(null);

  async function load(flash?: string) {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await fetch("/api/admin/users");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadErr(fmtErr(d));
        return;
      }
      setUsers(Array.isArray(d.users) ? d.users : []);
      if (flash) setNotice(flash);
    } catch {
      setLoadErr("Unable to load users. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    );
  }, [users, query]);

  function onMutated(msg: string) {
    setAction(null);
    void load(msg);
  }

  return (
    <RoleGuard allow={["super_admin"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>User Management</h1>
      <p style={dim}>
        Edit profiles and set login passwords for any account on the network.
      </p>

      {notice && (
        <p style={{ ...successStyle, marginTop: 12 }} role="status">
          {notice}
        </p>
      )}

      <Section title={`Accounts (${users.length})`}>
        <input
          style={{ ...inp, maxWidth: 320, marginBottom: 12 }}
          placeholder="Search by name, email, or role…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {loading ? (
          <p style={dim}>Loading…</p>
        ) : loadErr ? (
          <p style={errStyle} role="alert">
            {loadErr}
          </p>
        ) : filtered.length === 0 ? (
          <p style={dim}>No users match “{query}”.</p>
        ) : (
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.6 }}>
                {["Name", "Email", "Role", "Status", "Password", "Actions"].map(
                  (h) => (
                    <th key={h} style={{ padding: "6px 8px", fontWeight: 500 }}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const open = action?.id === u.id ? action.mode : null;
                return (
                  <Fragment key={u.id}>
                    <tr
                      style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <td style={{ padding: 8 }}>{u.fullName}</td>
                      <td style={{ padding: 8 }}>{u.email}</td>
                      <td style={{ padding: 8 }}>{u.role.replace("_", " ")}</td>
                      <td style={{ padding: 8 }}>
                        <StatusBadge status={u.globalStatus} />
                      </td>
                      <td style={{ padding: 8 }}>
                        {u.hasPassword ? (
                          <span style={{ color: "#9be8b4" }}>✓ set</span>
                        ) : (
                          <span style={{ color: "#ffcf8f" }}>needs reset</span>
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        <span style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            style={miniBtn}
                            onClick={() =>
                              setAction(
                                open === "edit" ? null : { id: u.id, mode: "edit" },
                              )
                            }
                          >
                            {open === "edit" ? "Close" : "Edit"}
                          </button>
                          <button
                            type="button"
                            style={miniBtn}
                            onClick={() =>
                              setAction(
                                open === "reset"
                                  ? null
                                  : { id: u.id, mode: "reset" },
                              )
                            }
                          >
                            {open === "reset" ? "Close" : "Reset password"}
                          </button>
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${u.id}-panel`}>
                        <td
                          colSpan={6}
                          style={{
                            padding: "4px 8px 16px",
                            background: "#0f1424",
                          }}
                        >
                          {open === "edit" ? (
                            <EditUserForm
                              user={u}
                              onDone={onMutated}
                              onCancel={() => setAction(null)}
                            />
                          ) : (
                            <ResetPasswordForm
                              user={u}
                              onDone={onMutated}
                              onCancel={() => setAction(null)}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </RoleGuard>
  );
}

/* ─────────────────────────── Edit profile ──────────────────────── */
function EditUserForm({
  user,
  onDone,
  onCancel,
}: {
  user: AdminUser;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = fullName.trim() !== user.fullName || email.trim() !== user.email;

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!fullName.trim()) e.fullName = "Full name is required";
    else if (fullName.length > 255) e.fullName = "Must be 255 characters or less";
    if (!email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = "Please enter a valid email address";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    // Only send changed fields (the API accepts a partial update).
    const body: { fullName?: string; email?: string } = {};
    if (fullName.trim() !== user.fullName) body.fullName = fullName.trim();
    if (email.trim() !== user.email) body.email = email.trim();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Updated ${d.fullName ?? user.fullName}.`);
    } catch {
      setErr("An unexpected error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...formGrid, maxWidth: 480 }}>
      <strong style={{ fontSize: 12, opacity: 0.7 }}>Edit profile</strong>
      <label style={labelStyle}>
        Full name
        <input
          style={inp}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        {fieldErrors.fullName && (
          <p role="alert" style={fieldErrorStyle}>
            {fieldErrors.fullName}
          </p>
        )}
      </label>
      <label style={labelStyle}>
        Email
        <input
          style={inp}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {fieldErrors.email && (
          <p role="alert" style={fieldErrorStyle}>
            {fieldErrors.email}
          </p>
        )}
      </label>
      {err && (
        <p role="alert" style={errStyle}>
          {err}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={busy || !dirty}
          style={{ ...btn(busy || !dirty), width: "auto", padding: "0 16px" }}
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} style={miniBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ───────────────────────── Reset password ──────────────────────── */
/** Browser-side temporary password generator (12 chars, alphanumeric). */
function generatePassword(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const buf = new Uint8Array(12);
  window.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

function ResetPasswordForm({
  user,
  onDone,
  onCancel,
}: {
  user: AdminUser;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (password.length < 8) {
      setFieldErr("Password must be at least 8 characters");
      return;
    }
    setFieldErr(null);
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, newPassword: password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d));
      onDone(`Password set for ${user.email}.`);
    } catch {
      setErr("An unexpected error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...formGrid, maxWidth: 480 }}>
      <strong style={{ fontSize: 12, opacity: 0.7 }}>
        Set a new password for {user.fullName}
      </strong>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ ...inp, flex: 1 }}
          type={reveal ? "text" : "password"}
          placeholder="New password (min 8 chars)"
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="button"
          style={miniBtn}
          onClick={() => setReveal((r) => !r)}
        >
          {reveal ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          style={miniBtn}
          onClick={() => {
            setPassword(generatePassword());
            setReveal(true);
          }}
        >
          Generate
        </button>
      </div>
      {fieldErr && (
        <p role="alert" style={fieldErrorStyle}>
          {fieldErr}
        </p>
      )}
      <p style={{ ...dim, margin: 0 }}>
        Copy the password before saving — it is hashed on the server and cannot
        be shown again.
      </p>
      {err && (
        <p role="alert" style={errStyle}>
          {err}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={busy || password.length < 8}
          style={{
            ...btn(busy || password.length < 8),
            width: "auto",
            padding: "0 16px",
          }}
        >
          {busy ? "Saving…" : "Set password"}
        </button>
        <button type="button" onClick={onCancel} style={miniBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

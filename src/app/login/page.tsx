"use client";

/**
 * Login screen. Standard accessible form (Guideline #2: no invented component
 * libraries). Posts to /api/auth/login, which sets the httpOnly session cookie;
 * on success we navigate to /dashboard. The cookie rides along automatically on
 * subsequent same-origin requests.
 */
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Login failed (${res.status})`);
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 380, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Sign in</h1>
      <p style={{ opacity: 0.6, marginTop: 0, fontSize: 14 }}>
        Global Educational ERP &amp; LMS
      </p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 14, marginTop: 24 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {error && (
          <p role="alert" style={{ color: "#ff8080", fontSize: 13, margin: 0 }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} style={buttonStyle(busy)}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "#11162a",
  color: "#e6e9f2",
  fontSize: 14,
};

function buttonStyle(busy: boolean): React.CSSProperties {
  return {
    padding: "11px 12px",
    borderRadius: 8,
    border: "none",
    background: busy ? "#3a4570" : "#5570ff",
    color: "white",
    fontSize: 14,
    fontWeight: 600,
    cursor: busy ? "default" : "pointer",
  };
}

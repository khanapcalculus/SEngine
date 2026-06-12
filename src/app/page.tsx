/**
 * Landing / status page. Intentionally minimal (Guideline #2: Zero
 * Hallucination UI) — it confirms the app is serving and lists the live API
 * surface. The real product UIs (whiteboard canvas, dashboards) are built in
 * later, explicitly-scoped phases.
 */

const ENDPOINTS: Array<{ method: string; path: string; note: string }> = [
  { method: "POST", path: "/api/auth/login", note: "Issue session token" },
  { method: "POST", path: "/api/staff/onboard", note: "HR — create staff" },
  {
    method: "GET",
    path: "/api/staff/branch/[branchId]",
    note: "HR — active roster",
  },
  { method: "POST", path: "/api/students/enroll", note: "SIS — enroll student" },
  { method: "POST", path: "/api/classes/assign", note: "SIS — assign to class" },
  {
    method: "POST",
    path: "/api/ai/tutor-copilot",
    note: "LMS — Gemma 4 tutor",
  },
  { method: "GET", path: "/api/health", note: "Liveness probe" },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>
        Global Educational ERP &amp; LMS
      </h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        Multi-tenant platform · API is live.
      </p>
      <p style={{ marginTop: 16 }}>
        <a
          href="/login"
          style={{
            display: "inline-block",
            padding: "9px 16px",
            borderRadius: 8,
            background: "#5570ff",
            color: "white",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Sign in →
        </a>
      </p>

      <h2 style={{ fontSize: 16, marginTop: 32, opacity: 0.8 }}>API surface</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {ENDPOINTS.map((e) => (
          <li
            key={e.method + e.path}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "baseline",
              padding: "8px 0",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <code
              style={{
                fontSize: 12,
                fontWeight: 700,
                width: 48,
                color: "#7fd1ff",
              }}
            >
              {e.method}
            </code>
            <code style={{ fontSize: 13 }}>{e.path}</code>
            <span style={{ fontSize: 12, opacity: 0.55, marginLeft: "auto" }}>
              {e.note}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}

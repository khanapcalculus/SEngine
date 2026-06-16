"use client";

/**
 * Public credential verification. Anyone (employer, registrar) can paste a
 * diploma serial and confirm it's genuine. Lives OUTSIDE /dashboard so it needs
 * no login — the API exposes only holder name, title, issue date, and issuing
 * branch. The serial may be prefilled via ?serial= (read from the URL on mount
 * to avoid a Suspense boundary).
 */
import { useEffect, useState } from "react";

interface Result {
  valid: boolean;
  holderName?: string;
  title?: string;
  program?: string | null;
  issuedDate?: string;
  branchLocation?: string;
}

export default function VerifyPage() {
  const [serial, setSerial] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const verify = async (s: string) => {
    const clean = s.trim();
    if (!clean) return;
    setLoading(true);
    setChecked(false);
    try {
      const r = await fetch(`/api/credentials/verify/${encodeURIComponent(clean)}`);
      const d = await r.json().catch(() => ({ valid: false }));
      setResult(d);
    } catch {
      setResult({ valid: false });
    } finally {
      setLoading(false);
      setChecked(true);
    }
  };

  // Prefill + auto-verify from ?serial= on first load.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("serial");
    if (fromUrl) {
      setSerial(fromUrl);
      void verify(fromUrl);
    }
  }, []);

  return (
    <main style={{ minHeight: "100vh", background: "#0f1424", color: "#e6e9f2", display: "flex", justifyContent: "center", padding: "48px 20px" }}>
      <div style={{ width: "100%", maxWidth: 520 }}>
        <h1 style={{ fontSize: 24, marginBottom: 6 }}>Verify a credential</h1>
        <p style={{ opacity: 0.6, fontSize: 14, marginTop: 0 }}>
          Enter the serial printed on the diploma to confirm it was issued by the institution.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); void verify(serial); }}
          style={{ display: "flex", gap: 8, marginTop: 16 }}
        >
          <input
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            placeholder="SE-XXXX-XXXX-XXXX"
            style={{ flex: 1, padding: "11px 13px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "#11162a", color: "#e6e9f2", fontSize: 15, fontFamily: "monospace" }}
          />
          <button type="submit" disabled={loading || !serial.trim()} style={{ padding: "11px 18px", borderRadius: 8, border: "none", background: "#5570ff", color: "#fff", fontSize: 15, fontWeight: 600, cursor: loading ? "default" : "pointer" }}>
            {loading ? "Checking…" : "Verify"}
          </button>
        </form>

        {checked && result && (
          <div
            style={{
              marginTop: 24,
              padding: 20,
              borderRadius: 12,
              border: `1px solid ${result.valid ? "rgba(155,232,180,0.4)" : "rgba(255,128,128,0.4)"}`,
              background: result.valid ? "rgba(19,53,31,0.5)" : "rgba(53,19,19,0.5)",
            }}
          >
            {result.valid ? (
              <>
                <div style={{ color: "#9be8b4", fontWeight: 700, fontSize: 16, marginBottom: 12 }}>✓ Genuine credential</div>
                <Field label="Holder" value={result.holderName} />
                <Field label="Credential" value={result.title} />
                {result.program ? <Field label="Program" value={result.program} /> : null}
                <Field label="Issued" value={result.issuedDate} />
                <Field label="Issuing branch" value={result.branchLocation} />
              </>
            ) : (
              <div style={{ color: "#ff9d9d", fontWeight: 600 }}>
                ✕ No credential matches that serial.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "4px 0", fontSize: 14 }}>
      <span style={{ width: 120, opacity: 0.55 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value ?? "—"}</span>
    </div>
  );
}

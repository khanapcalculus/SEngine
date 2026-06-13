"use client";

/** My Transcript — a student's own enrollments + transcript (self-service). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { RoleGuard } from "../_components/RoleGuard";
import { TranscriptCard } from "../_components/forms";
import { Section, dim, type TranscriptData } from "../_components/ui";

interface MyEnrollment {
  classId: string;
  classSubject: string;
  term: string;
  credits: number;
  status: string;
  finalGrade: string | null;
}

export default function TranscriptPage() {
  const [data, setData] = useState<TranscriptData | null>(null);
  const [enr, setEnr] = useState<MyEnrollment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const tr = await fetch("/api/me/transcript");
        if (tr.ok) setData(await tr.json());
        else setErr("No transcript available for your account yet.");
        const e = await fetch("/api/me/enrollments");
        if (e.ok) {
          const d = await e.json();
          setEnr(Array.isArray(d.enrollments) ? d.enrollments : []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <RoleGuard allow={["student"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>My Transcript</h1>
      {loading ? (
        <p style={dim}>Loading…</p>
      ) : (
        <>
          <Section title="My Enrollments">
            {enr.length === 0 ? (
              <p style={dim}>You have no enrollments yet.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {enr.map((e, i) => (
                  <li key={i}>
                    <Link href={`/dashboard/classroom/${e.classId}`} style={{ color: "#7fb0ff" }}>
                      {e.classSubject}
                    </Link>{" "}
                    ({e.credits} cr · {e.term}) — {e.finalGrade ?? "ungraded"}{" "}
                    <span style={{ opacity: 0.5 }}>[{e.status}]</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Transcript">
            {data ? (
              <TranscriptCard data={data} />
            ) : (
              <p style={dim}>{err ?? "No transcript yet."}</p>
            )}
          </Section>
        </>
      )}
    </RoleGuard>
  );
}

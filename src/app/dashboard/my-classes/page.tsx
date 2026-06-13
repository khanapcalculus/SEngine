"use client";

/** My Classes — a teacher's assigned classes + a gradebook limited to them. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RoleGuard } from "../_components/RoleGuard";
import { Gradebook } from "../_components/forms";
import { Section, dim, successStyle, type EnrollmentRow } from "../_components/ui";

interface MyClass {
  classId: string;
  subject: string;
  term: string;
  credits: number;
  role: string;
}

export default function MyClassesPage() {
  const [classes, setClasses] = useState<MyClass[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const get = async (u: string) => {
      const r = await fetch(u);
      return r.ok ? r.json() : null;
    };
    const [c, g] = await Promise.all([
      get("/api/me/classes"),
      get("/api/me/gradebook"),
    ]);
    setClasses(Array.isArray(c?.classes) ? c.classes : []);
    setEnrollments(Array.isArray(g?.enrollments) ? g.enrollments : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onGraded = (m: string) => {
    setNotice(m);
    void load();
  };

  return (
    <RoleGuard allow={["teacher"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>My Classes</h1>
      {notice && <p style={successStyle}>{notice}</p>}

      <Section title="Assigned classes">
        {loading ? (
          <p style={dim}>Loading…</p>
        ) : classes.length === 0 ? (
          <p style={dim}>You have no assigned classes yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {classes.map((c) => (
              <li key={c.classId}>
                <Link href={`/dashboard/classroom/${c.classId}`} style={{ color: "#7fb0ff" }}>
                  {c.subject}
                </Link>{" "}
                <span style={{ opacity: 0.6 }}>
                  ({c.term} · {c.credits} cr · {c.role})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Gradebook">
        {loading ? (
          <p style={dim}>Loading…</p>
        ) : (
          <Gradebook enrollments={enrollments} onDone={onGraded} />
        )}
      </Section>
    </RoleGuard>
  );
}

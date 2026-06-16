"use client";

/**
 * Student "Join Class" widget — shows the student's upcoming sessions for their
 * enrolled classes and surfaces a time-gated Join link that becomes active only
 * while a session is live (now ∈ [start, end]). Reads GET /api/me/sessions
 * (self-service); a ticking clock re-evaluates the live window each minute.
 */
import { useCallback, useEffect, useState } from "react";
import { Section, dim } from "./ui";

interface StudentSession {
  id: string;
  classId: string;
  subject: string;
  title: string;
  startsAt: string; // ISO
  durationMinutes: number;
}

const ACCENT = "#5570ff";

export function StudentSessionsWidget() {
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const r = await fetch("/api/me/sessions");
    const d = await r.json().catch(() => ({}));
    setSessions(r.ok && Array.isArray(d.sessions) ? d.sessions : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-evaluate the live window every 30s so "Join" appears/disappears on time.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  function openBoard(classId: string) {
    window.open(
      `/board/${classId}`,
      `sengine-board-${classId}`,
      "popup,noopener,width=1280,height=800",
    );
  }

  return (
    <Section title="My upcoming classes">
      {loading ? (
        <p style={dim}>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={dim}>No upcoming sessions scheduled for your classes.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {sessions.map((s) => {
            const start = new Date(s.startsAt).getTime();
            const end = start + s.durationMinutes * 60_000;
            const live = now >= start && now <= end;
            const soon = !live && start - now > 0 && start - now < 15 * 60_000;
            return (
              <li
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${live ? ACCENT : "rgba(255,255,255,0.08)"}`,
                  background: live ? "rgba(85,112,255,0.14)" : "#0f1424",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {s.title}
                    {live && <span style={{ marginLeft: 8, fontSize: 11, color: "#9be8b4" }}>● Live now</span>}
                    {soon && <span style={{ marginLeft: 8, fontSize: 11, color: "#ffcf8f" }}>Starting soon</span>}
                  </div>
                  <div style={{ ...dim, opacity: 0.7 }}>
                    {s.subject} ·{" "}
                    {new Date(s.startsAt).toLocaleString(undefined, {
                      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}{" "}
                    · {s.durationMinutes} min
                  </div>
                </div>
                {live ? (
                  <button
                    type="button"
                    onClick={() => openBoard(s.classId)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: ACCENT,
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Join Class ↗
                  </button>
                ) : (
                  <span
                    style={{ ...dim, fontSize: 12, whiteSpace: "nowrap" }}
                    title="The Join link activates when the session starts"
                  >
                    {start > now ? "Not started" : "Ended"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

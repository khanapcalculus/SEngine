"use client";

/**
 * Classroom — the per-class LMS view (assignments + discussions). Reached from
 * a teacher's My Classes or a student's My Transcript. Any class member may open
 * it; the APIs enforce membership, so non-members see a friendly notice.
 *
 * Teachers/managers also get an inline quick-scheduler here so they can plan the
 * next session for THIS class without leaving the classroom (it posts to the
 * same /api/schedule the Schedule page uses); the full calendar lives at
 * /dashboard/schedule.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDashboard } from "../../DashboardProvider";
import { RoleGuard } from "../../_components/RoleGuard";
import { AssignmentsPanel, DiscussionsPanel } from "../../_components/lms";
import { isManager, dim, labelStyle, inp, successStyle, errStyle, miniBtn } from "../../_components/ui";
import { Icon } from "../../../board/[classId]/icons";
import type { Role } from "../../../../lib/rbac";

const MEMBERS: Role[] = ["super_admin", "branch_manager", "teacher", "student"];
const ACCENT = "#5570ff";

/** Default the quick-scheduler to the next round hour, today. */
function defaultDateTime(): { date: string; time: string } {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

export default function ClassroomPage() {
  const params = useParams();
  const classId =
    typeof params.classId === "string"
      ? params.classId
      : Array.isArray(params.classId)
        ? params.classId[0]
        : "";
  const { me } = useDashboard();
  const canManage = isManager(me.role) || me.role === "teacher";
  const isStudent = me.role === "student";

  // Launch the live whiteboard in its own pop-out window (chromeless /board
  // route). A named window means re-clicking focuses the existing board for
  // this class instead of spawning duplicates.
  function openWhiteboard() {
    if (!classId) return;
    window.open(
      `/board/${classId}`,
      `sengine-board-${classId}`,
      "popup,noopener,width=1280,height=800",
    );
  }

  return (
    <RoleGuard allow={MEMBERS}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Classroom</h1>
      <p style={dim}>Class {classId.slice(0, 8)}…</p>
      {classId ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "8px 0 16px" }}>
            <button type="button" onClick={openWhiteboard} style={primaryBtn}>
              <Icon name="board" size={17} />
              Open Live Whiteboard
              <span style={{ opacity: 0.7, fontSize: 12 }}>↗</span>
            </button>
            {canManage && <QuickSchedule classId={classId} />}
          </div>
          <AssignmentsPanel
            classId={classId}
            canManage={canManage}
            isStudent={isStudent}
          />
          <SnapshotsPanel classId={classId} />
          <DiscussionsPanel classId={classId} />
        </>
      ) : (
        <p style={dim}>No class selected.</p>
      )}
    </RoleGuard>
  );
}

/**
 * Saved whiteboard snapshots for this class (captured by the board's "End
 * Session"). Any class member may review them. Read-only thumbnails linking to
 * the full-size image in Blob.
 */
interface Snapshot {
  id: string;
  sessionId: string;
  url: string;
  sessionTitle: string | null;
  startsAt: string | null;
  createdAt: string;
}

function SnapshotsPanel({ classId }: { classId: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch(`/api/me/classroom/${classId}/snapshots`);
    const d = await r.json().catch(() => ({}));
    setSnapshots(r.ok && Array.isArray(d.snapshots) ? d.snapshots : []);
    setLoading(false);
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return null;
  if (snapshots.length === 0) return null; // hide the section until there's something to show

  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, opacity: 0.85, marginBottom: 10 }}>Session snapshots</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {snapshots.map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "none", color: "inherit", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, overflow: "hidden", background: "#0f1424" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.url} alt={s.sessionTitle ?? "Session snapshot"} style={{ width: "100%", height: 120, objectFit: "cover", display: "block", background: "#0b0f1c" }} />
            <div style={{ padding: "8px 10px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.sessionTitle ?? "Session"}
              </div>
              <div style={{ ...dim, fontSize: 12 }}>
                {new Date(s.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

/**
 * Inline quick-scheduler for the current class. Toggles a compact form that
 * posts to /api/schedule; the server resolves the branch from the class and
 * enforces membership, so this carries no branch/identity from the client.
 */
function QuickSchedule({ classId }: { classId: string }) {
  const [open, setOpen] = useState(false);
  const init = defaultDateTime();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [duration, setDuration] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setMsg(null);
    if (title.trim().length === 0) {
      setErr("Give the session a title.");
      return;
    }
    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) {
      setErr("Pick a valid date and time.");
      return;
    }
    setSubmitting(true);
    const r = await fetch("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        classId,
        title: title.trim(),
        startsAt: startsAt.toISOString(),
        durationMinutes: duration,
      }),
    });
    setSubmitting(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(d.error ?? "Could not schedule the session.");
      return;
    }
    setMsg(`Scheduled for ${startsAt.toLocaleString()}.`);
    setTitle("");
  };

  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={ghostBtn} aria-expanded={open}>
        <Icon name="calendar" size={16} />
        Schedule a session
      </button>

      {open && (
        <div style={popover}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <strong style={{ fontSize: 14 }}>Schedule this class</strong>
            <Link href="/dashboard/schedule" style={{ fontSize: 12, color: "#7fb0ff", textDecoration: "none" }}>
              Full calendar →
            </Link>
          </div>

          {msg && <p style={{ ...successStyle, margin: 0 }}>{msg}</p>}
          {err && <p style={{ ...errStyle, margin: 0 }}>{err}</p>}

          <label style={labelStyle}>
            Title
            <input style={inp} value={title} placeholder="e.g. Review session" maxLength={255} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={labelStyle}>
              Date
              <input type="date" style={inp} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label style={labelStyle}>
              Time
              <input type="time" style={inp} value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <label style={labelStyle}>
            Duration
            <select style={inp} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[30, 45, 60, 90, 120, 180].map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
            <button type="button" style={miniBtn} onClick={() => setOpen(false)}>Close</button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              style={{ ...miniBtn, background: ACCENT, borderColor: ACCENT, color: "#fff", opacity: submitting ? 0.6 : 1 }}
            >
              {submitting ? "Scheduling…" : "Schedule"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 16px",
  fontSize: 14,
  fontWeight: 600,
  color: "#fff",
  background: ACCENT,
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 14px",
  fontSize: 14,
  fontWeight: 600,
  color: "#c7cde0",
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 8,
  cursor: "pointer",
};

const popover: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  left: 0,
  zIndex: 20,
  width: 300,
  display: "grid",
  gap: 10,
  padding: 14,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0f1424",
  boxShadow: "0 12px 34px rgba(0,0,0,0.5)",
};

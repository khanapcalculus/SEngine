"use client";

/**
 * Schedule — a month calendar + clock for planning class sessions.
 *
 * Teachers and managers pick a day on the calendar and a time on the analog
 * clock to schedule a session for one of their classes; sessions are stored
 * server-side (class_sessions) so they're shared across users and devices.
 * Upcoming sessions are highlighted and link straight to the class's live
 * whiteboard. Display + highlight only — no reminders/background jobs.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDashboard } from "../DashboardProvider";
import { RoleGuard } from "../_components/RoleGuard";
import {
  Section,
  dim,
  labelStyle,
  inp,
  errStyle,
  successStyle,
  miniBtn,
  type ClassRow,
} from "../_components/ui";

const ALLOWED = ["super_admin", "branch_manager", "teacher"] as const;

interface ClassSession {
  id: string;
  classId: string;
  branchId: string;
  subject: string;
  title: string;
  startsAt: string; // ISO
  durationMinutes: number;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const ACCENT = "#5570ff";

/** Local YYYY-MM-DD key (calendar bucketing must be in the viewer's timezone). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export default function SchedulePage() {
  return (
    <RoleGuard allow={[...ALLOWED]}>
      <ScheduleInner />
    </RoleGuard>
  );
}

function ScheduleInner() {
  const { scope, classes } = useDashboard();
  const branchId = scope.branchId;

  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => new Date());

  const load = useCallback(async () => {
    if (!branchId) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const r = await fetch(`/api/schedule/branch/${branchId}`);
    const d = await r.json().catch(() => ({}));
    setSessions(r.ok && Array.isArray(d.sessions) ? d.sessions : []);
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Group sessions by local day for calendar dots.
  const byDay = useMemo(() => {
    const map = new Map<string, ClassSession[]>();
    for (const s of sessions) {
      const k = dayKey(new Date(s.startsAt));
      (map.get(k) ?? map.set(k, []).get(k)!).push(s);
    }
    return map;
  }, [sessions]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return sessions
      .filter((s) => new Date(s.startsAt).getTime() + s.durationMinutes * 60000 >= now)
      .slice(0, 12);
  }, [sessions]);

  const onCreated = (s: ClassSession) => {
    setNotice(`Scheduled "${s.title}" for ${new Date(s.startsAt).toLocaleString()}.`);
    setError(null);
    void load();
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("Remove this scheduled session?")) return;
    const r = await fetch(`/api/schedule/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "Could not remove session.");
      return;
    }
    setNotice("Removed scheduled session.");
    void load();
  };

  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Schedule</h1>
      <p style={dim}>Plan class sessions on the calendar and clock. Upcoming sessions link to the live whiteboard.</p>

      {notice && <p style={{ ...successStyle, marginTop: 12 }}>{notice}</p>}
      {error && <p style={{ ...errStyle, marginTop: 12 }}>{error}</p>}

      {!branchId ? (
        <p style={{ ...dim, marginTop: 20 }}>Select a branch to view its schedule.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 24, marginTop: 16, alignItems: "start" }}>
          <div>
            <MonthCalendar
              viewMonth={viewMonth}
              selected={selected}
              byDay={byDay}
              onPrev={() => setViewMonth((m) => addMonths(m, -1))}
              onNext={() => setViewMonth((m) => addMonths(m, 1))}
              onToday={() => {
                const t = new Date();
                setViewMonth(startOfMonth(t));
                setSelected(t);
              }}
              onPick={(d) => setSelected(d)}
            />
          </div>

          <ScheduleForm
            classes={classes}
            selectedDay={selected}
            onCreated={onCreated}
            onError={setError}
          />
        </div>
      )}

      <Section title="Upcoming sessions">
        {loading ? (
          <p style={dim}>Loading…</p>
        ) : upcoming.length === 0 ? (
          <p style={dim}>No upcoming sessions scheduled.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {upcoming.map((s) => (
              <SessionItem key={s.id} session={s} onDelete={() => onDelete(s.id)} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/* ── calendar ──────────────────────────────────────────────────────── */
function MonthCalendar({
  viewMonth,
  selected,
  byDay,
  onPrev,
  onNext,
  onToday,
  onPick,
}: {
  viewMonth: Date;
  selected: Date;
  byDay: Map<string, ClassSession[]>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPick: (d: Date) => void;
}) {
  const today = new Date();
  const first = startOfMonth(viewMonth);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();

  // 6 rows × 7 cols, leading days from the prior month shown dimmed.
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i - startWeekday + 1));
  }

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 14, background: "#0f1424" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <strong style={{ fontSize: 16 }}>
          {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
        </strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" style={miniBtn} onClick={onPrev} aria-label="Previous month">‹</button>
          <button type="button" style={miniBtn} onClick={onToday}>Today</button>
          <button type="button" style={miniBtn} onClick={onNext} aria-label="Next month">›</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {DOW.map((d) => (
          <div key={d} style={{ textAlign: "center", fontSize: 11, opacity: 0.5, padding: "2px 0" }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === viewMonth.getMonth();
          const isToday = sameDay(d, today);
          const isSel = sameDay(d, selected);
          const items = byDay.get(dayKey(d)) ?? [];
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(d)}
              title={items.length ? `${items.length} session${items.length > 1 ? "s" : ""}` : undefined}
              style={{
                minHeight: 58,
                borderRadius: 8,
                border: isSel ? `1.5px solid ${ACCENT}` : "1px solid rgba(255,255,255,0.07)",
                background: isSel ? "rgba(85,112,255,0.16)" : isToday ? "rgba(255,255,255,0.05)" : "transparent",
                color: inMonth ? "#e6e9f2" : "rgba(230,233,242,0.32)",
                cursor: "pointer",
                padding: 5,
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: 3,
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? ACCENT : undefined }}>
                {d.getDate()}
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                {items.slice(0, 3).map((s) => (
                  <span key={s.id} style={{ width: 6, height: 6, borderRadius: "50%", background: ACCENT, opacity: 0.85 }} />
                ))}
                {items.length > 3 && <span style={{ fontSize: 9, opacity: 0.6 }}>+{items.length - 3}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── create form (with analog clock) ───────────────────────────────── */
function ScheduleForm({
  classes,
  selectedDay,
  onCreated,
  onError,
}: {
  classes: ClassRow[];
  selectedDay: Date;
  onCreated: (s: ClassSession) => void;
  onError: (m: string | null) => void;
}) {
  const [classId, setClassId] = useState("");
  const [title, setTitle] = useState("");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [duration, setDuration] = useState(60);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!classId && classes.length > 0) setClassId(classes[0].id);
  }, [classes, classId]);

  const submit = async () => {
    onError(null);
    if (!classId) {
      onError("Pick a class to schedule.");
      return;
    }
    if (title.trim().length === 0) {
      onError("Give the session a title.");
      return;
    }
    const startsAt = new Date(
      selectedDay.getFullYear(),
      selectedDay.getMonth(),
      selectedDay.getDate(),
      hour,
      minute,
      0,
      0,
    );
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
      onError(d.error ?? "Could not schedule the session.");
      return;
    }
    setTitle("");
    onCreated(d as ClassSession);
  };

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 16, background: "#0f1424", display: "grid", gap: 12 }}>
      <strong style={{ fontSize: 15 }}>Schedule a class</strong>
      <p style={{ ...dim, margin: 0 }}>
        {selectedDay.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </p>

      <ClockPicker hour={hour} minute={minute} setHour={setHour} setMinute={setMinute} />

      <label style={labelStyle}>
        Class
        {classes.length === 0 ? (
          <span style={dim}>No classes in this branch yet.</span>
        ) : (
          <select style={inp} value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.subject} · {c.term}</option>
            ))}
          </select>
        )}
      </label>

      <label style={labelStyle}>
        Title
        <input style={inp} value={title} placeholder="e.g. Vectors — review session" onChange={(e) => setTitle(e.target.value)} maxLength={255} />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={labelStyle}>
          Time
          <input
            type="time"
            style={inp}
            value={`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (!Number.isNaN(h)) setHour(h);
              if (!Number.isNaN(m)) setMinute(m);
            }}
          />
        </label>
        <label style={labelStyle}>
          Duration
          <select style={inp} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[30, 45, 60, 90, 120, 180].map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitting || classes.length === 0}
        style={{
          marginTop: 4,
          padding: "10px 14px",
          borderRadius: 8,
          border: "none",
          background: submitting || classes.length === 0 ? "rgba(85,112,255,0.4)" : ACCENT,
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: submitting || classes.length === 0 ? "default" : "pointer",
        }}
      >
        {submitting ? "Scheduling…" : "Schedule session"}
      </button>
    </div>
  );
}

/**
 * Analog clock time picker: drag-free, click-to-set hands. Clicking the clock
 * face sets the minute (outer ring) or hour by proximity; the +/- steppers give
 * precise control. The native <time> input above remains the keyboard path.
 */
function ClockPicker({
  hour,
  minute,
  setHour,
  setMinute,
}: {
  hour: number;
  minute: number;
  setHour: (h: number) => void;
  setMinute: (m: number) => void;
}) {
  const R = 70;
  const cx = R + 8;
  const cy = R + 8;
  // 12-hour display angle; minute hand at minute*6°. 0° = 12 o'clock, clockwise.
  const hourAngle = ((hour % 12) + minute / 60) * 30 - 90;
  const minAngle = minute * 6 - 90;
  const hx = cx + Math.cos((hourAngle * Math.PI) / 180) * (R * 0.5);
  const hy = cy + Math.sin((hourAngle * Math.PI) / 180) * (R * 0.5);
  const mx = cx + Math.cos((minAngle * Math.PI) / 180) * (R * 0.78);
  const my = cy + Math.sin((minAngle * Math.PI) / 180) * (R * 0.78);
  const isPm = hour >= 12;

  const label = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
      <svg width={(R + 8) * 2} height={(R + 8) * 2} style={{ flexShrink: 0 }} aria-hidden>
        <circle cx={cx} cy={cy} r={R} fill="#11162a" stroke="rgba(255,255,255,0.14)" strokeWidth={1.5} />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * 30 - 90) * (Math.PI / 180);
          const x1 = cx + Math.cos(a) * (R - 6);
          const y1 = cy + Math.sin(a) * (R - 6);
          const x2 = cx + Math.cos(a) * (R - 1);
          const y2 = cy + Math.sin(a) * (R - 1);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />;
        })}
        {/* minute hand */}
        <line x1={cx} y1={cy} x2={mx} y2={my} stroke="#9fb0ff" strokeWidth={2} strokeLinecap="round" />
        {/* hour hand */}
        <line x1={cx} y1={cy} x2={hx} y2={hy} stroke={ACCENT} strokeWidth={3.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3.5} fill={ACCENT} />
      </svg>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {label} <span style={{ fontSize: 12, opacity: 0.6 }}>{isPm ? "PM" : "AM"}</span>
        </div>
        <Stepper label="Hour" value={hour} onDec={() => setHour((hour + 23) % 24)} onInc={() => setHour((hour + 1) % 24)} />
        <Stepper label="Min" value={minute} onDec={() => setMinute((minute + 55) % 60)} onInc={() => setMinute((minute + 5) % 60)} />
      </div>
    </div>
  );
}

function Stepper({ label, value, onDec, onInc }: { label: string; value: number; onDec: () => void; onInc: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{ width: 30, opacity: 0.6 }}>{label}</span>
      <button type="button" style={miniBtn} onClick={onDec} aria-label={`Decrease ${label}`}>−</button>
      <span style={{ width: 24, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{String(value).padStart(2, "0")}</span>
      <button type="button" style={miniBtn} onClick={onInc} aria-label={`Increase ${label}`}>+</button>
    </div>
  );
}

/* ── upcoming list item ────────────────────────────────────────────── */
function SessionItem({ session, onDelete }: { session: ClassSession; onDelete: () => void }) {
  const start = new Date(session.startsAt);
  const now = Date.now();
  const end = start.getTime() + session.durationMinutes * 60000;
  const live = now >= start.getTime() && now <= end;
  const soon = !live && start.getTime() - now < 60 * 60000; // within the hour

  return (
    <li
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
          {session.title}
          {live && <span style={{ marginLeft: 8, fontSize: 11, color: "#9be8b4" }}>● Live now</span>}
          {soon && <span style={{ marginLeft: 8, fontSize: 11, color: "#ffcf8f" }}>Starting soon</span>}
        </div>
        <div style={{ ...dim, opacity: 0.7 }}>
          {session.subject} · {start.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {session.durationMinutes} min
        </div>
      </div>
      <Link
        href={`/dashboard/classroom/${session.classId}`}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          color: "#fff",
          background: ACCENT,
          whiteSpace: "nowrap",
        }}
      >
        Open class
      </Link>
      <button type="button" onClick={onDelete} style={{ ...miniBtn, color: "#ff8080" }} aria-label="Remove session">✕</button>
    </li>
  );
}

"use client";

/**
 * Whiteboard — retired in-dashboard surface.
 *
 * The live collaborative canvas now lives in a dedicated, chromeless pop-out
 * window at /board/[classId] (full-viewport drawing engine + toolbar). This page
 * is just a launcher: pick a class and open its board in its own window — the
 * same window.open() pop-out used from the Classroom view, so there is a single
 * source of truth for the drawing UI.
 */
import { useEffect, useState } from "react";
import { RoleGuard } from "../_components/RoleGuard";
import { useDashboard } from "../DashboardProvider";
import { Section, dim, inp, btn, labelStyle } from "../_components/ui";

interface ClassOption {
  id: string;
  label: string;
}

export default function WhiteboardPage() {
  const { me } = useDashboard();
  const [options, setOptions] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [loadingClasses, setLoadingClasses] = useState(true);

  // Load the caller's own classes (teacher) or enrolled classes (student).
  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingClasses(true);
      const url =
        me.role === "student" ? "/api/me/enrollments" : "/api/me/classes";
      try {
        const res = await fetch(url);
        const d = await res.json().catch(() => ({}));
        if (!active) return;
        const opts: ClassOption[] =
          me.role === "student"
            ? (Array.isArray(d.enrollments) ? d.enrollments : []).map(
                (e: { classId: string; classSubject?: string; term?: string }) => ({
                  id: e.classId,
                  label: `${e.classSubject ?? "Class"}${e.term ? ` (${e.term})` : ""}`,
                }),
              )
            : (Array.isArray(d.classes) ? d.classes : []).map(
                (c: { classId: string; subject?: string; term?: string }) => ({
                  id: c.classId,
                  label: `${c.subject ?? "Class"}${c.term ? ` (${c.term})` : ""}`,
                }),
              );
        // De-dupe (a student may have multiple enrollments per class over terms).
        const seen = new Set<string>();
        setOptions(opts.filter((o) => !seen.has(o.id) && seen.add(o.id)));
      } catch {
        if (active) setOptions([]);
      } finally {
        if (active) setLoadingClasses(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [me.role]);

  // Same named-window pop-out used from the Classroom view.
  function openWhiteboard() {
    if (!classId) return;
    window.open(
      `/board/${classId}`,
      `sengine-board-${classId}`,
      "popup,noopener,width=1280,height=800",
    );
  }

  return (
    <RoleGuard allow={["teacher", "student"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Whiteboard</h1>
      <p style={dim}>
        The whiteboard has been moved to a dedicated interactive window.
      </p>

      <Section title="Open a board">
        <p style={{ ...dim, marginTop: 0 }}>
          Pick a class and the live collaborative canvas opens in its own
          full-screen window.
        </p>

        {loadingClasses ? (
          <p style={dim}>Loading your classes…</p>
        ) : options.length === 0 ? (
          <p style={dim}>You have no classes to open a whiteboard for yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
            <label style={labelStyle}>
              Class
              <select
                style={inp}
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
                <option value="">Select a class…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={openWhiteboard}
              disabled={!classId}
              style={btn(!classId)}
            >
              🎨 Open Live Whiteboard ↗
            </button>
          </div>
        )}
      </Section>
    </RoleGuard>
  );
}

"use client";

/**
 * Whiteboard — live collaborative canvas (teacher + student).
 *
 * Thin presentational shell over useWhiteboardSocket: pick a class, then a
 * minimal SVG surface demonstrates the round-trip — click to draw a point
 * (a "stroke" op), move the pointer to broadcast cursor presence. Persistent
 * ops + peers' cursors render live. The drawing model is intentionally simple
 * (per the architecture's "no complex UI unless instructed"); the hook is the
 * real deliverable and is canvas-agnostic.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RoleGuard } from "../_components/RoleGuard";
import { useDashboard } from "../DashboardProvider";
import {
  Section,
  StatusBadge,
  dim,
  inp,
  btn,
  miniBtn,
  labelStyle,
  errStyle,
  formGrid,
  fmtErr,
} from "../_components/ui";
import { useWhiteboardSocket } from "./useWhiteboardSocket";
import type { ConnectionStatus, WhiteboardOp } from "./connection";

interface ClassOption {
  id: string;
  label: string;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
  error: "Connection error",
};
const STATUS_COLOR: Record<ConnectionStatus, string> = {
  idle: "#c7cde0",
  connecting: "#ffcf8f",
  open: "#9be8b4",
  reconnecting: "#ffcf8f",
  closed: "#c7cde0",
  error: "#ff8080",
};

const CURSOR_THROTTLE_MS = 60;

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
                (c: { id: string; subject?: string; term?: string }) => ({
                  id: c.id,
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

  return (
    <RoleGuard allow={["teacher", "student"]}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Whiteboard</h1>
      <p style={dim}>Live collaborative canvas for a class session.</p>

      <Section title="Session">
        {loadingClasses ? (
          <p style={dim}>Loading your classes…</p>
        ) : options.length === 0 ? (
          <p style={dim}>
            You have no classes to open a whiteboard for yet.
          </p>
        ) : (
          <label style={{ ...labelStyle, maxWidth: 360 }}>
            Class
            <select
              style={inp}
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">Select a class to join…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </Section>

      {classId && <Board key={classId} classId={classId} />}
    </RoleGuard>
  );
}

function Board({ classId }: { classId: string }) {
  const { status, canDraw, role, error, ops, cursors, sendOp, reconnect } =
    useWhiteboardSocket(classId);
  const surfaceRef = useRef<SVGSVGElement | null>(null);
  const lastCursorSent = useRef(0);

  // Cursor ops carry normalized {x,y} payloads from peers.
  const cursorMarks = useMemo(
    () =>
      Object.entries(cursors)
        .map(([id, op]) => {
          const p = op.payload as { x?: number; y?: number } | undefined;
          return p && typeof p.x === "number" && typeof p.y === "number"
            ? { id, x: p.x, y: p.y }
            : null;
        })
        .filter((c): c is { id: string; x: number; y: number } => c !== null),
    [cursors],
  );

  function toNorm(e: { clientX: number; clientY: number }) {
    const el = surfaceRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!canDraw) return;
    const p = toNorm(e);
    if (p) sendOp({ type: "stroke", payload: p });
  }

  function onPointerMove(e: ReactPointerEvent) {
    const now = Date.now();
    if (now - lastCursorSent.current < CURSOR_THROTTLE_MS) return;
    lastCursorSent.current = now;
    const p = toNorm(e);
    if (p) sendOp({ type: "cursor", payload: p });
  }

  const W = 720;
  const H = 380;

  // AI derivation is educator-only (mirrors the route's RBAC). On the
  // whiteboard that means a teacher; students connect view/collaborate only.
  const canUseAi = role !== null && role !== "student" && role !== "parent";

  return (
    <>
      <Section title="Canvas">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: STATUS_COLOR[status], fontWeight: 600, fontSize: 13 }}>
          ● {STATUS_LABEL[status]}
        </span>
        {role && <StatusBadge status={role} />}
        <span style={dim}>{canDraw ? "Can draw" : "View only"}</span>
        <span style={dim}>{ops.length} ops</span>
        {(status === "error" || status === "closed") && (
          <button type="button" style={miniBtn} onClick={reconnect}>
            Reconnect
          </button>
        )}
        {canDraw && (
          <button
            type="button"
            style={miniBtn}
            onClick={() => sendOp({ type: "clear" })}
          >
            Clear board
          </button>
        )}
      </div>

      {error && status !== "open" && (
        <p style={{ color: "#ff8080", fontSize: 13 }} role="alert">
          {error}
        </p>
      )}

      <svg
        ref={surfaceRef}
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        style={{
          width: "100%",
          maxWidth: W,
          height: "auto",
          aspectRatio: `${W} / ${H}`,
          background: "#0f1424",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10,
          touchAction: "none",
          cursor: canDraw ? "crosshair" : "default",
        }}
      >
        {ops.map((op, i) => {
          const p = op.payload as { x?: number; y?: number } | undefined;
          if (!p || typeof p.x !== "number" || typeof p.y !== "number")
            return null;
          return (
            <circle
              key={i}
              cx={p.x * W}
              cy={p.y * H}
              r={4}
              fill="#7fd1ff"
            />
          );
        })}
        {cursorMarks.map((c) => (
          <g key={c.id} transform={`translate(${c.x * W}, ${c.y * H})`}>
            <circle r={6} fill="none" stroke="#ffcf8f" strokeWidth={1.5} />
            <circle r={1.5} fill="#ffcf8f" />
          </g>
        ))}
      </svg>
      <p style={{ ...dim, marginTop: 8 }}>
        {canDraw
          ? "Click to place a point; move your pointer to share your cursor."
          : "You are connected in view-only mode."}
      </p>
      </Section>

      {canUseAi && <DerivationPanel classId={classId} ops={ops} />}
    </>
  );
}

/**
 * Educator-only AI derivation: summarise the live board, let the educator
 * transcribe the math shown, and POST it to /api/me/ai/derivation. The board
 * summary travels as part of the context so the model knows what's on the
 * canvas; the transcription carries the actual math (no OCR yet).
 */
function DerivationPanel({
  classId,
  ops,
}: {
  classId: string;
  ops: WhiteboardOp[];
}) {
  const [context, setContext] = useState("");
  const [focus, setFocus] = useState("");
  const [result, setResult] = useState<{
    derivation: string;
    model: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const boardSummary = useMemo(() => {
    const count = (t: string) => ops.filter((o) => o.type === t).length;
    const strokes = count("stroke");
    const shapes = count("shape");
    const equations = count("equation");
    const bits = [`${strokes} stroke${strokes === 1 ? "" : "s"}`];
    if (shapes) bits.push(`${shapes} shape${shapes === 1 ? "" : "s"}`);
    if (equations) bits.push(`${equations} equation${equations === 1 ? "" : "s"}`);
    return `Board snapshot: ${bits.join(", ")}.`;
  }, [ops]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!context.trim()) {
      setErr("Transcribe the problem on the board first.");
      return;
    }
    setErr(null);
    setBusy(true);
    setResult(null);
    try {
      const whiteboardContext = `${boardSummary}\n\nProblem on the board (transcribed by the educator):\n${context.trim()}`;
      const res = await fetch("/api/me/ai/derivation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classId,
          whiteboardContext,
          prompt: focus.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(fmtErr(d) + " (is GEMMA_API_KEY configured?)");
      setResult({ derivation: d.derivation, model: d.model });
    } catch {
      setErr("An unexpected error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="AI derivation (Gemma)">
      <p style={{ ...dim, marginTop: 0 }}>
        {boardSummary} Transcribe the math shown and Gemma will derive it
        step by step.
      </p>
      <form onSubmit={submit} style={{ ...formGrid, maxWidth: 560 }}>
        <textarea
          style={{ ...inp, minHeight: 72, fontFamily: "inherit" }}
          placeholder="Problem on the board, e.g. Find the determinant of [[2,1],[1,3]]"
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
        <input
          style={inp}
          placeholder="Optional focus (e.g. just the cofactor expansion)"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
        />
        {err && (
          <p role="alert" style={errStyle}>
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !context.trim()}
          style={btn(busy || !context.trim())}
        >
          {busy ? "Asking Gemma…" : "Ask for derivation"}
        </button>
        {result && (
          <div>
            <p style={{ ...dim, margin: "4px 0" }}>Model: {result.model}</p>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#11162a",
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {result.derivation}
            </pre>
          </div>
        )}
      </form>
    </Section>
  );
}

"use client";

/**
 * Pop-out Whiteboard — a chromeless, full-viewport collaborative canvas.
 *
 * Opened in its own browser window from the Classroom view (window.open), this
 * route lives OUTSIDE /dashboard so it carries no sidebar/header — just the
 * board. It reuses the existing, already-deployed RTC stack end to end:
 *   • useWhiteboardSocket → token mint → Cloudflare Worker → Durable Object
 *   • the connection core treats a `stroke` op's payload as OPAQUE, so we pack
 *     a whole continuous path + its color + width into one stroke op. The
 *     Worker/DO never parse it, so NOTHING on the backend has to change.
 *
 * Drawing engine: pointer down → move → up builds one path; the in-progress
 * "draft" renders locally for instant feedback, and the finished path is sent
 * as a single stroke op (sendOp also echoes it into `ops` locally, since the DO
 * broadcasts only to OTHER peers). Coordinates are normalized 0..1 so peers on
 * different window sizes stay in agreement.
 *
 * Capabilities mirror the server: only `canDraw` peers (educators + tutoring
 * students, decided in /api/me/classroom/token) get the tools; everyone else
 * connects view-only.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useParams } from "next/navigation";
import { useWhiteboardSocket } from "../../dashboard/whiteboard/useWhiteboardSocket";
import type { ConnectionStatus } from "../../dashboard/whiteboard/connection";
import {
  asStroke,
  isFarEnough,
  packStrokePayload,
  BG,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  MIN_POINT_DELTA,
  MAX_POINTS,
  type Pt,
} from "./strokes";

/* ── tool constants (page-local) ────────────────────────────────── */
const PALETTE = ["#7fd1ff", "#ff8fab", "#9be8b4", "#ffd479", "#c8a6ff", "#ffffff"];
const MIN_WIDTH = 1;
const MAX_WIDTH = 28;
const CURSOR_THROTTLE_MS = 60;

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  open: "Live",
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

export default function BoardPage() {
  const params = useParams();
  const classId =
    typeof params.classId === "string"
      ? params.classId
      : Array.isArray(params.classId)
        ? params.classId[0]
        : "";

  const { status, canDraw, role, error, ops, cursors, sendOp, reconnect } =
    useWhiteboardSocket(classId || null);

  /* ── tools ─────────────────────────────────────────────────────── */
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [erasing, setErasing] = useState(false);
  const effectiveColor = erasing ? BG : color;

  /* ── viewport mapping (normalized 0..1 ↔ pixels) ───────────────── */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toNorm = useCallback((e: { clientX: number; clientY: number }): Pt | null => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }, []);

  /* ── drawing engine ────────────────────────────────────────────── */
  const drawing = useRef(false);
  const draftRef = useRef<Pt[]>([]);
  const [draft, setDraft] = useState<Pt[]>([]);
  const lastCursorSent = useRef(0);

  function onPointerDown(e: ReactPointerEvent) {
    if (!canDraw || status !== "open") return;
    const p = toNorm(e);
    if (!p) return;
    drawing.current = true;
    draftRef.current = [p];
    setDraft([p]);
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    // Cursor presence is always shared when connected, drawing or not.
    const now = Date.now();
    if (now - lastCursorSent.current >= CURSOR_THROTTLE_MS) {
      lastCursorSent.current = now;
      const c = toNorm(e);
      if (c) sendOp({ type: "cursor", payload: c });
    }

    if (!drawing.current) return;
    const p = toNorm(e);
    if (!p) return;
    const pts = draftRef.current;
    if (pts.length >= MAX_POINTS) return;
    // Distance-thinning: drop points that barely moved (keeps the path lean).
    if (!isFarEnough(pts[pts.length - 1], p, MIN_POINT_DELTA)) return;
    pts.push(p);
    setDraft([...pts]);
  }

  const finishStroke = useCallback(
    (e: ReactPointerEvent) => {
      if (!drawing.current) return;
      drawing.current = false;
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* noop */
      }
      const points = draftRef.current;
      draftRef.current = [];
      setDraft([]);
      if (points.length === 0) return;
      // Pack the whole path into the opaque stroke payload — backend unchanged.
      sendOp({
        type: "stroke",
        payload: packStrokePayload(points, effectiveColor, width),
      });
    },
    [effectiveColor, width, sendOp],
  );

  const clearBoard = useCallback(() => {
    draftRef.current = [];
    setDraft([]);
    sendOp({ type: "clear" }); // local wipe + broadcast (handled in the core)
  }, [sendOp]);

  /* ── render data ───────────────────────────────────────────────── */
  const cursorMarks = useMemo(
    () =>
      Object.entries(cursors)
        .map(([id, op]) => {
          const p = op.payload as Pt | undefined;
          return p && typeof p.x === "number" && typeof p.y === "number"
            ? { id, x: p.x, y: p.y }
            : null;
        })
        .filter((c): c is { id: string; x: number; y: number } => c !== null),
    [cursors],
  );

  const toPolyline = useCallback(
    (points: Pt[]) =>
      points.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" "),
    [size.w, size.h],
  );

  if (!classId) {
    return (
      <Centered>
        <p>No class specified. Open the board from a classroom.</p>
      </Centered>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: BG,
        overflow: "hidden",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerLeave={finishStroke}
        onPointerCancel={finishStroke}
        style={{
          display: "block",
          width: "100vw",
          height: "100vh",
          cursor: canDraw ? (erasing ? "cell" : "crosshair") : "default",
        }}
      >
        {/* committed + replayed strokes */}
        {ops.map((op, i) => {
          if (op.type !== "stroke") return null;
          const s = asStroke(op.payload);
          if (!s) return null;
          return s.points.length === 1 ? (
            <circle
              key={i}
              cx={s.points[0].x * size.w}
              cy={s.points[0].y * size.h}
              r={s.width / 2}
              fill={s.color}
            />
          ) : (
            <polyline
              key={i}
              points={toPolyline(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* in-progress local draft (instant feedback before it commits) */}
        {draft.length > 0 && (
          <polyline
            points={toPolyline(draft)}
            fill="none"
            stroke={effectiveColor}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* peer cursors */}
        {cursorMarks.map((c) => (
          <g key={c.id} transform={`translate(${c.x * size.w}, ${c.y * size.h})`}>
            <circle r={7} fill="none" stroke="#ffcf8f" strokeWidth={1.5} />
            <circle r={2} fill="#ffcf8f" />
          </g>
        ))}
      </svg>

      <Toolbar
        classId={classId}
        status={status}
        role={role}
        canDraw={canDraw}
        error={error}
        color={color}
        setColor={(c) => {
          setColor(c);
          setErasing(false);
        }}
        width={width}
        setWidth={setWidth}
        erasing={erasing}
        setErasing={setErasing}
        onClear={clearBoard}
        onReconnect={reconnect}
      />
    </div>
  );
}

/* ── floating toolbar ─────────────────────────────────────────────── */
function Toolbar({
  classId,
  status,
  role,
  canDraw,
  error,
  color,
  setColor,
  width,
  setWidth,
  erasing,
  setErasing,
  onClear,
  onReconnect,
}: {
  classId: string;
  status: ConnectionStatus;
  role: string | null;
  canDraw: boolean;
  error: string | null;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  erasing: boolean;
  setErasing: (e: boolean) => void;
  onClear: () => void;
  onReconnect: () => void;
}) {
  const disconnected = status === "error" || status === "closed";

  return (
    <div
      style={{
        position: "fixed",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px",
        background: "rgba(17,22,42,0.92)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        boxShadow: "0 6px 22px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        fontSize: 13,
        flexWrap: "wrap",
        maxWidth: "calc(100vw - 28px)",
      }}
    >
      {/* status */}
      <span
        style={{ color: STATUS_COLOR[status], fontWeight: 700, whiteSpace: "nowrap" }}
        title={`Class ${classId.slice(0, 8)}…`}
      >
        ● {STATUS_LABEL[status]}
      </span>
      {role && (
        <span style={{ opacity: 0.7, textTransform: "capitalize" }}>{role}</span>
      )}

      {canDraw ? (
        <>
          <Divider />
          {/* palette */}
          <div style={{ display: "flex", gap: 5 }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setColor(c)}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: c,
                  cursor: "pointer",
                  border:
                    !erasing && color === c
                      ? "2px solid #fff"
                      : "2px solid rgba(255,255,255,0.25)",
                }}
              />
            ))}
            {/* custom color */}
            <input
              type="color"
              aria-label="Custom color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{
                width: 24,
                height: 24,
                padding: 0,
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 6,
                background: "transparent",
                cursor: "pointer",
              }}
            />
          </div>

          <Divider />
          {/* width */}
          <label
            style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
          >
            <span style={{ opacity: 0.7 }}>Size</span>
            <input
              type="range"
              min={MIN_WIDTH}
              max={MAX_WIDTH}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={{ width: 90 }}
            />
            <span
              style={{
                display: "inline-block",
                width: 22,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {width}
            </span>
          </label>

          <Divider />
          {/* eraser */}
          <button
            type="button"
            onClick={() => setErasing(!erasing)}
            style={{
              ...toolBtn,
              background: erasing ? "#5570ff" : "transparent",
              color: erasing ? "#fff" : "#c7cde0",
              borderColor: erasing ? "#5570ff" : "rgba(255,255,255,0.2)",
            }}
          >
            Eraser
          </button>
          {/* clear */}
          <button type="button" onClick={onClear} style={toolBtn}>
            Clear
          </button>
        </>
      ) : (
        <>
          <Divider />
          <span style={{ opacity: 0.7 }}>View only</span>
        </>
      )}

      {disconnected && (
        <>
          <Divider />
          <button
            type="button"
            onClick={onReconnect}
            style={{ ...toolBtn, borderColor: "#ffcf8f", color: "#ffcf8f" }}
          >
            Reconnect
          </button>
        </>
      )}

      {error && status !== "open" && (
        <span style={{ color: "#ff8080", maxWidth: 220 }} role="alert">
          {error}
        </span>
      )}

      <Divider />
      <button
        type="button"
        onClick={() => window.close()}
        title="Close board window"
        style={{ ...toolBtn, borderColor: "rgba(255,255,255,0.2)" }}
      >
        Close
      </button>
    </div>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      style={{ width: 1, height: 22, background: "rgba(255,255,255,0.14)" }}
    />
  );
}

const toolBtn: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "transparent",
  color: "#c7cde0",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: BG,
        color: "#c7cde0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

"use client";

/**
 * Pop-out Whiteboard — a chromeless, full-viewport collaborative canvas.
 *
 * Opened in its own browser window from the Classroom view (window.open), this
 * route lives OUTSIDE /dashboard so it carries no sidebar/header — just the
 * board. It reuses the already-deployed RTC stack end to end (useWhiteboardSocket
 * → token mint → Cloudflare Worker → Durable Object). Op payloads are OPAQUE to
 * the backend, so the whole tool set rides on the existing `stroke`/`shape`/
 * `equation` op types; only the client connection core gained an `erase` op for
 * the object eraser.
 *
 * Tools: smooth pen, geometry (line/rect/ellipse/arrow), plain text + LaTeX math
 * (KaTeX), image + PDF insert (rasterized client-side), and an object eraser.
 * Every created object carries a stable id so the eraser can target it for all
 * peers. Capabilities mirror the server: only `canDraw` peers get the tools.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useParams } from "next/navigation";
import { useWhiteboardSocket } from "../../dashboard/whiteboard/useWhiteboardSocket";
import type { ConnectionStatus } from "../../dashboard/whiteboard/connection";
import {
  isFarEnough,
  packStrokePayload,
  BG,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  MIN_POINT_DELTA,
  MAX_POINTS,
  type Pt,
} from "./strokes";
import {
  idOf,
  topmostHit,
  DEFAULT_FONT_SIZE,
  type Tool,
  type Size,
} from "./tools";
import { uploadBoardImage, imageNaturalSize, fitNormalized } from "./upload";
import { renderOp, katexHtml } from "./render";

/* ── tool constants (page-local) ────────────────────────────────── */
const PALETTE = ["#7fd1ff", "#ff8fab", "#9be8b4", "#ffd479", "#c8a6ff", "#ffffff"];
const MIN_WIDTH = 1;
const MAX_WIDTH = 28;
const CURSOR_THROTTLE_MS = 60;
const GEO_TOOLS = new Set<Tool>(["line", "rect", "ellipse", "arrow"]);

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

const newId = () => crypto.randomUUID();

/** Best-effort human message from an upload failure (Blob client throws Error). */
function uploadErr(err: unknown): string {
  // The route already returns clear, specific messages (missing/malformed token,
  // unsupported type, the real Blob put() error, …). Pass them straight through
  // rather than rewriting — earlier masking here hid the true cause.
  const msg = err instanceof Error ? err.message : String(err);
  return msg || "unknown error";
}

interface ShapeDraft {
  kind: "line" | "rect" | "ellipse" | "arrow";
  start: Pt;
  end: Pt;
}
interface Editing {
  kind: "text" | "math";
  x: number;
  y: number;
  value: string;
}

export default function BoardPage() {
  const params = useParams();
  const classId =
    typeof params.classId === "string"
      ? params.classId
      : Array.isArray(params.classId)
        ? params.classId[0]
        : "";

  const { status, canDraw, role, error, ops, cursors, erased, sendOp, reconnect } =
    useWhiteboardSocket(classId || null);

  /* ── tool state ────────────────────────────────────────────────── */
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [fill, setFill] = useState(false);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  /* ── viewport mapping (normalized 0..1 ↔ pixels) ───────────────── */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
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
  const shapeStart = useRef<Pt | null>(null);
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const lastCursorSent = useRef(0);

  const ready = canDraw && status === "open";

  function capture(e: ReactPointerEvent) {
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* best-effort */
    }
  }
  function release(e: ReactPointerEvent) {
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!ready) return;
    const p = toNorm(e);
    if (!p) return;

    if (tool === "pen") {
      drawing.current = true;
      draftRef.current = [p];
      setDraft([p]);
      capture(e);
      return;
    }
    if (GEO_TOOLS.has(tool)) {
      shapeStart.current = p;
      setShapeDraft({ kind: tool as ShapeDraft["kind"], start: p, end: p });
      capture(e);
      return;
    }
    if (tool === "text" || tool === "math") {
      setEditing({ kind: tool, x: p.x, y: p.y, value: "" });
      return;
    }
    if (tool === "erase") {
      const id = topmostHit(ops, erased, p, size);
      if (id) sendOp({ type: "erase", payload: { targetId: id } });
      return;
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    // Cursor presence is shared whenever connected (drawing or not).
    if (status === "open") {
      const now = Date.now();
      if (now - lastCursorSent.current >= CURSOR_THROTTLE_MS) {
        lastCursorSent.current = now;
        const c = toNorm(e);
        if (c) sendOp({ type: "cursor", payload: c });
      }
    }

    if (tool === "pen" && drawing.current) {
      const p = toNorm(e);
      if (!p) return;
      const pts = draftRef.current;
      if (pts.length >= MAX_POINTS) return;
      if (!isFarEnough(pts[pts.length - 1], p, MIN_POINT_DELTA)) return;
      pts.push(p);
      setDraft([...pts]);
    } else if (GEO_TOOLS.has(tool) && shapeStart.current) {
      const p = toNorm(e);
      if (p) setShapeDraft((d) => (d ? { ...d, end: p } : d));
    }
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (tool === "pen") {
      if (!drawing.current) return;
      drawing.current = false;
      release(e);
      const points = draftRef.current;
      draftRef.current = [];
      setDraft([]);
      if (points.length === 0) return;
      sendOp({
        type: "stroke",
        payload: packStrokePayload(points, color, width, newId()),
      });
      return;
    }
    if (GEO_TOOLS.has(tool) && shapeStart.current) {
      const start = shapeStart.current;
      const d = shapeDraft;
      shapeStart.current = null;
      setShapeDraft(null);
      release(e);
      if (!d) return;
      // Ignore a stray click that didn't drag into a real shape.
      if (Math.abs(d.end.x - start.x) < 0.002 && Math.abs(d.end.y - start.y) < 0.002) {
        return;
      }
      const id = newId();
      const payload =
        tool === "line" || tool === "arrow"
          ? { id, kind: tool, start, end: d.end, color, width }
          : { id, kind: tool, start, end: d.end, color, width, fill };
      sendOp({ type: "shape", payload });
    }
  }

  function commitEditing() {
    if (!editing) return;
    const v = editing.value.trim();
    const { kind, x, y } = editing;
    setEditing(null);
    if (!v) return;
    const id = newId();
    if (kind === "text") {
      sendOp({ type: "shape", payload: { id, kind: "text", x, y, text: v, fontSize, color } });
    } else {
      sendOp({ type: "equation", payload: { id, x, y, latex: v, fontSize, color } });
    }
  }

  const clearBoard = useCallback(() => {
    draftRef.current = [];
    setDraft([]);
    sendOp({ type: "clear" });
  }, [sendOp]);

  /* ── image / pdf insert ────────────────────────────────────────── */
  async function onImageFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setNotice(null);
    setBusy("Uploading image…");
    try {
      const dims = await imageNaturalSize(file);
      const url = await uploadBoardImage(classId, file, file.name);
      const box = fitNormalized(dims.width, dims.height, size);
      const x = Math.max(0, 0.5 - box.w / 2);
      const y = Math.max(0, 0.5 - box.h / 2);
      sendOp({ type: "shape", payload: { id: newId(), kind: "image", url, x, y, w: box.w, h: box.h } });
    } catch (err) {
      setNotice(`Image upload failed: ${uploadErr(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function onPdfFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setNotice(null);

    // Phase 1: render the PDF to page images (pure client, no network).
    setBusy("Rendering PDF…");
    let pages;
    try {
      // Dynamic import keeps the ~1MB pdf.js bundle out of first paint.
      const { rasterizePdf } = await import("./pdf");
      pages = await rasterizePdf(file);
    } catch {
      setBusy(null);
      setNotice("Could not read that PDF (is it a valid, unencrypted file?).");
      return;
    }
    if (pages.length === 0) {
      setBusy(null);
      setNotice("That PDF has no pages to import.");
      return;
    }

    // Phase 2: upload each page image. A failure here is an UPLOAD problem, not
    // a PDF problem — report it as such.
    try {
      for (let i = 0; i < pages.length; i++) {
        setBusy(`Uploading page ${i + 1}/${pages.length}…`);
        const pg = pages[i];
        const url = await uploadBoardImage(classId, pg.blob, `${file.name}-p${i + 1}.png`);
        const box = fitNormalized(pg.width, pg.height, size);
        // Stagger pages so a multi-page doc doesn't stack into one spot.
        const off = i * 0.04;
        const x = Math.max(0, Math.min(0.95 - box.w, 0.06 + off));
        const y = Math.max(0, Math.min(0.95 - box.h, 0.06 + off));
        sendOp({ type: "shape", payload: { id: newId(), kind: "image", url, x, y, w: box.w, h: box.h } });
      }
    } catch (err) {
      setNotice(`PDF page upload failed: ${uploadErr(err)}`);
    } finally {
      setBusy(null);
    }
  }

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

  const cursorStyle =
    !canDraw
      ? "default"
      : tool === "erase"
        ? "cell"
        : tool === "text" || tool === "math"
          ? "text"
          : "crosshair";

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
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ display: "block", width: "100vw", height: "100vh", cursor: cursorStyle }}
      >
        {/* committed + replayed ops (skip erased) */}
        {ops.map((op, i) => {
          const id = idOf(op);
          if (id && erased.has(id)) return null;
          return <Fragment key={id ?? i}>{renderOp(op, size)}</Fragment>;
        })}

        {/* live drafts */}
        {draft.length > 0 &&
          renderOp({ type: "stroke", payload: { points: draft, color, width } }, size)}
        {shapeDraft &&
          renderOp(
            { type: "shape", payload: { ...shapeDraft, color, width, fill } },
            size,
          )}

        {/* peer cursors */}
        {cursorMarks.map((c) => (
          <g key={c.id} transform={`translate(${c.x * size.w}, ${c.y * size.h})`}>
            <circle r={7} fill="none" stroke="#ffcf8f" strokeWidth={1.5} />
            <circle r={2} fill="#ffcf8f" />
          </g>
        ))}
      </svg>

      {/* text / math inline editor */}
      {editing && (
        <Editor
          editing={editing}
          size={size}
          color={color}
          fontSize={fontSize}
          onChange={(value) => setEditing((s) => (s ? { ...s, value } : s))}
          onCommit={commitEditing}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* hidden file inputs for image / pdf */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={onImageFile}
        style={{ display: "none" }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        onChange={onPdfFile}
        style={{ display: "none" }}
      />

      <Toolbar
        classId={classId}
        status={status}
        role={role}
        canDraw={canDraw}
        error={error}
        notice={notice}
        busy={busy}
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        width={width}
        setWidth={setWidth}
        fill={fill}
        setFill={setFill}
        fontSize={fontSize}
        setFontSize={setFontSize}
        onPickImage={() => imageInputRef.current?.click()}
        onPickPdf={() => pdfInputRef.current?.click()}
        onClear={clearBoard}
        onReconnect={reconnect}
      />
    </div>
  );
}

/* ── inline text / math editor (HTML overlay positioned on the canvas) ── */
function Editor({
  editing,
  size,
  color,
  fontSize,
  onChange,
  onCommit,
  onCancel,
}: {
  editing: Editing;
  size: Size;
  color: string;
  fontSize: number;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const left = editing.x * size.w;
  const top = editing.y * size.h;
  const isMath = editing.kind === "math";

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "rgba(17,22,42,0.96)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 8,
        padding: 8,
        boxShadow: "0 6px 22px rgba(0,0,0,0.5)",
        zIndex: 20,
      }}
    >
      {isMath ? (
        <textarea
          autoFocus
          value={editing.value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onCommit();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="LaTeX, e.g. \frac{a}{b}"
          style={{
            minWidth: 220,
            minHeight: 48,
            fontFamily: "monospace",
            fontSize: 13,
            color: "#e6e9f2",
            background: "#0f1424",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 6,
            padding: 6,
          }}
        />
      ) : (
        <input
          autoFocus
          value={editing.value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Type a label…"
          style={{
            minWidth: 200,
            fontSize,
            color,
            background: "#0f1424",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 6,
            padding: "6px 8px",
          }}
        />
      )}

      {isMath && editing.value.trim() && (
        <div
          style={{ color, fontSize, background: "#11162a", padding: "4px 6px", borderRadius: 6 }}
          dangerouslySetInnerHTML={{ __html: katexHtml(editing.value) }}
        />
      )}

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={miniBtn}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onCommit}
          style={{ ...miniBtn, background: "#5570ff", color: "#fff", borderColor: "#5570ff" }}
        >
          {isMath ? "Add (⌘↵)" : "Add (↵)"}
        </button>
      </div>
    </div>
  );
}

/* ── floating toolbar ─────────────────────────────────────────────── */
const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: "pen", label: "✏️", title: "Pen" },
  { id: "line", label: "╱", title: "Line" },
  { id: "arrow", label: "↗", title: "Arrow" },
  { id: "rect", label: "▭", title: "Rectangle" },
  { id: "ellipse", label: "◯", title: "Ellipse" },
  { id: "text", label: "T", title: "Text" },
  { id: "math", label: "∑", title: "Math (LaTeX)" },
  { id: "erase", label: "⌫", title: "Object eraser" },
];

function Toolbar({
  classId,
  status,
  role,
  canDraw,
  error,
  notice,
  busy,
  tool,
  setTool,
  color,
  setColor,
  width,
  setWidth,
  fill,
  setFill,
  fontSize,
  setFontSize,
  onPickImage,
  onPickPdf,
  onClear,
  onReconnect,
}: {
  classId: string;
  status: ConnectionStatus;
  role: string | null;
  canDraw: boolean;
  error: string | null;
  notice: string | null;
  busy: string | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  fill: boolean;
  setFill: (f: boolean) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  onPickImage: () => void;
  onPickPdf: () => void;
  onClear: () => void;
  onReconnect: () => void;
}) {
  const disconnected = status === "error" || status === "closed";
  const showFill = tool === "rect" || tool === "ellipse";
  const showFont = tool === "text" || tool === "math";

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "rgba(17,22,42,0.92)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        boxShadow: "0 6px 22px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        fontSize: 13,
        flexWrap: "wrap",
        maxWidth: "calc(100vw - 24px)",
        zIndex: 30,
      }}
    >
      <span
        style={{ color: STATUS_COLOR[status], fontWeight: 700, whiteSpace: "nowrap" }}
        title={`Class ${classId.slice(0, 8)}…`}
      >
        ● {STATUS_LABEL[status]}
      </span>
      {role && <span style={{ opacity: 0.7, textTransform: "capitalize" }}>{role}</span>}

      {canDraw ? (
        <>
          <Divider />
          {/* tools */}
          <div style={{ display: "flex", gap: 4 }}>
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.title}
                aria-pressed={tool === t.id}
                onClick={() => setTool(t.id)}
                style={{
                  ...toolBtn,
                  minWidth: 30,
                  textAlign: "center",
                  background: tool === t.id ? "#5570ff" : "transparent",
                  color: tool === t.id ? "#fff" : "#c7cde0",
                  borderColor: tool === t.id ? "#5570ff" : "rgba(255,255,255,0.2)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <Divider />
          {/* insert image / pdf */}
          <button type="button" style={toolBtn} onClick={onPickImage} title="Insert image">
            🖼 Image
          </button>
          <button type="button" style={toolBtn} onClick={onPickPdf} title="Insert PDF">
            📄 PDF
          </button>

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
                  border: color === c ? "2px solid #fff" : "2px solid rgba(255,255,255,0.25)",
                }}
              />
            ))}
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

          {showFont ? (
            <>
              <Divider />
              <label style={ctrlLabel}>
                <span style={{ opacity: 0.7 }}>Font</span>
                <input
                  type="range"
                  min={10}
                  max={64}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  style={{ width: 80 }}
                />
                <span style={num}>{fontSize}</span>
              </label>
            </>
          ) : (
            <>
              <Divider />
              <label style={ctrlLabel}>
                <span style={{ opacity: 0.7 }}>Size</span>
                <input
                  type="range"
                  min={MIN_WIDTH}
                  max={MAX_WIDTH}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  style={{ width: 80 }}
                />
                <span style={num}>{width}</span>
              </label>
            </>
          )}

          {showFill && (
            <label style={{ ...ctrlLabel, cursor: "pointer" }}>
              <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
              <span style={{ opacity: 0.8 }}>Fill</span>
            </label>
          )}

          <Divider />
          <button type="button" onClick={onClear} style={toolBtn} title="Clear the whole board">
            Clear
          </button>
        </>
      ) : (
        <>
          <Divider />
          <span style={{ opacity: 0.7 }}>View only</span>
        </>
      )}

      {busy && (
        <>
          <Divider />
          <span style={{ color: "#ffcf8f", whiteSpace: "nowrap" }}>{busy}</span>
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

      {(notice || (error && status !== "open")) && (
        <span style={{ color: "#ff8080", maxWidth: 240 }} role="alert">
          {notice ?? error}
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
    <span aria-hidden style={{ width: 1, height: 22, background: "rgba(255,255,255,0.14)" }} />
  );
}

const toolBtn: React.CSSProperties = {
  padding: "5px 9px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "transparent",
  color: "#c7cde0",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const miniBtn: React.CSSProperties = {
  ...toolBtn,
  padding: "4px 8px",
  fontSize: 12,
};

const ctrlLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
};

const num: React.CSSProperties = {
  display: "inline-block",
  width: 22,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
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

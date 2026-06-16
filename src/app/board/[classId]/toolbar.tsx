"use client";

/**
 * Whiteboard chrome — a COMPACT left tool rail, a compact right
 * properties/actions rail, and a slim top status pill. Heavy controls (colour,
 * fill, stroke size) live in POPOVERS that expand on click and auto-collapse on
 * any outside click, so the rails stay narrow and the canvas keeps the maximum
 * work area. All state is owned by page.tsx; everything here is controlled.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ConnectionStatus } from "../../dashboard/whiteboard/connection";
import type { Tool } from "./tools";
import { COLOR_SWATCHES, STROKE_SIZES, type Theme } from "./theme";
import { Icon, type IconName } from "./icons";

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

/**
 * Popover plumbing for the right rail. The rail scrolls (`overflow-y:auto`,
 * which forces overflow-x:auto) AND has a `transform`/`backdrop-filter`, so an
 * in-rail child panel would be clipped behind the rail edge — even with
 * `position:fixed` (those properties make the rail the fixed containing block).
 * So we PORTAL the panel to <body> and position it just LEFT of its trigger
 * (toward the canvas) from the trigger's live screen rect — it always opens over
 * the board, never hidden behind the sidebar. Auto-collapses on outside click.
 */
function useFixedPopover(open: boolean, onClose: () => void, theme: Theme) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const r = triggerRef.current.getBoundingClientRect();
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 260));
    const right = Math.max(8, window.innerWidth - r.left + 8);
    setPos({ top, right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    // capture so we see the click before the canvas swallows it.
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, onClose]);

  const portal = (children: ReactNode): ReactNode => {
    if (!open || !pos || typeof document === "undefined") return null;
    const panelStyle: CSSProperties = {
      position: "fixed",
      top: pos.top,
      right: pos.right,
      borderRadius: 14,
      padding: 12,
      zIndex: 90,
      ...glassSurface(theme),
    };
    return createPortal(
      <div ref={panelRef} style={panelStyle}>
        {children}
      </div>,
      document.body,
    );
  };

  return { triggerRef, portal };
}

/* ── tool groups (left rail) ──────────────────────────────────────── */
interface ToolDef {
  id: Tool;
  icon: IconName;
  title: string;
}
const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: "select", icon: "select", title: "Select / move (V)" },
    { id: "pan", icon: "pan", title: "Pan / hand (H) — or hold Space" },
    { id: "pen", icon: "pen", title: "Pen (P)" },
    { id: "erase", icon: "erase", title: "Eraser (E)" },
  ],
  [
    { id: "line", icon: "line", title: "Line (L)" },
    { id: "arrow", icon: "arrow", title: "Arrow (A)" },
    { id: "rect", icon: "rect", title: "Rectangle (R) — Shift = square" },
    { id: "ellipse", icon: "ellipse", title: "Ellipse / circle (O) — Shift = circle" },
    { id: "arc", icon: "arc", title: "Arc (C) — prompts radius & angle" },
    { id: "polygon", icon: "polygon", title: "Polygon / star (G)" },
    { id: "frame", icon: "frame", title: "Frame (F) — export region" },
  ],
  [
    { id: "text", icon: "text", title: "Text (X)" },
    { id: "math", icon: "math", title: "Math / LaTeX (M)" },
  ],
];

export function LeftRail({
  tool,
  setTool,
  onPickImage,
  onPickPdf,
  theme,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  onPickImage: () => void;
  onPickPdf: () => void;
  theme: Theme;
}) {
  return (
    <div className="wb-rail" style={railStyle("left", theme)}>
      <GlassHoverStyle />
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} style={groupStyle}>
          {group.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.title}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
              style={railBtn(tool === t.id, theme)}
            >
              <Icon name={t.icon} />
            </button>
          ))}
        </div>
      ))}
      <div style={groupStyle}>
        <button type="button" title="Insert image" style={railBtn(false, theme)} onClick={onPickImage}>
          <Icon name="image" />
        </button>
        <button type="button" title="Insert PDF" style={railBtn(false, theme)} onClick={onPickPdf}>
          <Icon name="pdf" />
        </button>
      </div>
    </div>
  );
}

/* ── colour popover ───────────────────────────────────────────────── */
function ColorPopover({
  label,
  value,
  onChange,
  allowNone,
  theme,
}: {
  label: string;
  value: string | null;
  onChange: (c: string | null) => void;
  allowNone?: boolean;
  theme: Theme;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, portal } = useFixedPopover(open, () => setOpen(false), theme);
  const swatch = value ?? "transparent";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <button
        ref={triggerRef}
        type="button"
        title={label}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 30,
          height: 24,
          borderRadius: 7,
          border: `1px solid ${theme.panelBorder}`,
          background: value === null ? "repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 50%/8px 8px" : swatch,
          cursor: "pointer",
        }}
      />
      <span style={{ fontSize: 9, opacity: 0.7, color: theme.textDim }}>{label}</span>
      {portal(
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 20px)", gap: 6 }}>
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                title={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: c,
                  cursor: "pointer",
                  border: value?.toLowerCase() === c.toLowerCase() ? `2px solid ${theme.accent}` : "1px solid rgba(128,128,128,0.45)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
            <input
              type="color"
              aria-label={`Custom ${label}`}
              value={value ?? "#000000"}
              onChange={(e) => onChange(e.target.value)}
              style={{ width: 30, height: 26, padding: 0, border: `1px solid ${theme.panelBorder}`, borderRadius: 6, background: "transparent", cursor: "pointer" }}
            />
            <span style={{ fontSize: 11, color: theme.textDim }}>Custom</span>
            {allowNone && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                style={{ ...miniGhost(theme), fontSize: 11, marginLeft: "auto" }}
              >
                No fill
              </button>
            )}
          </div>
        </>,
      )}
    </div>
  );
}

/* ── stroke-size popover ──────────────────────────────────────────── */
function StrokePopover({ value, onChange, theme }: { value: number; onChange: (n: number) => void; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const { triggerRef, portal } = useFixedPopover(open, () => setOpen(false), theme);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <button ref={triggerRef} type="button" title="Stroke size" onClick={() => setOpen((o) => !o)} style={railBtn(false, theme)}>
        <span style={{ display: "inline-block", width: Math.min(20, value + 4), height: Math.min(20, value + 2), borderRadius: "50%", background: theme.text }} />
      </button>
      <span style={{ fontSize: 9, opacity: 0.7, color: theme.textDim }}>{value}px</span>
      {portal(
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 34px)", gap: 4 }}>
          {STROKE_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onChange(n);
                setOpen(false);
              }}
              style={{
                height: 30,
                borderRadius: 7,
                border: `1px solid ${value === n ? theme.accent : theme.panelBorder}`,
                background: value === n ? theme.accent : "transparent",
                color: value === n ? "#fff" : theme.text,
                cursor: "pointer",
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <span style={{ display: "inline-block", width: Math.min(16, n + 2), height: Math.min(16, n + 2), borderRadius: "50%", background: value === n ? "#fff" : theme.text }} />
              {n}
            </button>
          ))}
        </div>,
      )}
    </div>
  );
}

/* ── properties + actions (right rail) ────────────────────────────── */
export function RightRail({
  tool,
  hasSelection,
  theme,
  toggleTheme,
  color,
  setColor,
  fillColor,
  setFillColor,
  width,
  setWidth,
  fontSize,
  setFontSize,
  sides,
  setSides,
  star,
  setStar,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDuplicate,
  onDelete,
  onFront,
  onBack,
  snap,
  setSnap,
  grid,
  setGrid,
  zoomPct,
  onZoomIn,
  onZoomOut,
  onResetView,
  onClear,
  onExport,
  onEndSession,
  onHelp,
}: {
  tool: Tool;
  hasSelection: boolean;
  theme: Theme;
  toggleTheme: () => void;
  color: string;
  setColor: (c: string) => void;
  fillColor: string | null;
  setFillColor: (c: string | null) => void;
  width: number;
  setWidth: (n: number) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  sides: number;
  setSides: (n: number) => void;
  star: boolean;
  setStar: (b: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFront: () => void;
  onBack: () => void;
  snap: boolean;
  setSnap: (b: boolean) => void;
  grid: boolean;
  setGrid: (b: boolean) => void;
  zoomPct: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onClear: () => void;
  onExport: () => void;
  onEndSession: () => void;
  onHelp: () => void;
}) {
  const showFont = tool === "text" || tool === "math";
  const showFill = tool === "rect" || tool === "ellipse" || tool === "polygon";
  const showPoly = tool === "polygon";

  return (
    <div className="wb-rail" style={railStyle("right", theme)}>
      <ColorPopover label="Stroke" value={color} onChange={(c) => c && setColor(c)} theme={theme} />
      {showFill && <ColorPopover label="Fill" value={fillColor} onChange={setFillColor} allowNone theme={theme} />}

      {showFont ? (
        <FontPopover value={fontSize} onChange={setFontSize} theme={theme} />
      ) : (
        <StrokePopover value={width} onChange={setWidth} theme={theme} />
      )}

      {showPoly && <PolyPopover sides={sides} setSides={setSides} star={star} setStar={setStar} theme={theme} />}

      <Sep theme={theme} />

      <button type="button" title="Undo (Ctrl+Z)" disabled={!canUndo} style={railBtn(false, theme, !canUndo)} onClick={onUndo}><Icon name="undo" /></button>
      <button type="button" title="Redo (Ctrl+Y)" disabled={!canRedo} style={railBtn(false, theme, !canRedo)} onClick={onRedo}><Icon name="redo" /></button>

      {hasSelection && (
        <>
          <button type="button" title="Duplicate (Ctrl+D)" style={railBtn(false, theme)} onClick={onDuplicate}><Icon name="duplicate" /></button>
          <button type="button" title="Delete (Del)" style={railBtn(false, theme)} onClick={onDelete}><Icon name="trash" /></button>
          <button type="button" title="Bring to front (])" style={railBtn(false, theme)} onClick={onFront}><Icon name="front" /></button>
          <button type="button" title="Send to back ([)" style={railBtn(false, theme)} onClick={onBack}><Icon name="back" /></button>
        </>
      )}

      <Sep theme={theme} />

      <button type="button" title="Zoom in (wheel up)" style={railBtn(false, theme)} onClick={onZoomIn}><Icon name="plus" /></button>
      <button type="button" title="Reset view (100%)" style={railBtn(false, theme)} onClick={onResetView}>
        <span style={{ fontSize: 9, fontWeight: 700 }}>{zoomPct}%</span>
      </button>
      <button type="button" title="Zoom out (wheel down)" style={railBtn(false, theme)} onClick={onZoomOut}><Icon name="minus" /></button>

      <Sep theme={theme} />

      <button type="button" title="Snap to grid" aria-pressed={snap} style={railBtn(snap, theme)} onClick={() => setSnap(!snap)}><Icon name="snap" /></button>
      <button type="button" title="Toggle grid" aria-pressed={grid} style={railBtn(grid, theme)} onClick={() => setGrid(!grid)}><Icon name="grid" /></button>
      <button type="button" title={`Switch to ${theme.name === "dark" ? "light" : "dark"} theme`} style={railBtn(false, theme)} onClick={toggleTheme}>
        <Icon name={theme.name === "dark" ? "sun" : "moon"} />
      </button>

      <Sep theme={theme} />

      <button type="button" title="Export frames to PDF" style={railBtn(false, theme, false, theme.accent)} onClick={onExport}><Icon name="download" /></button>
      <button type="button" title="End session — save snapshot, log attendance, post payroll" style={railBtn(false, theme, false, "#9be8b4")} onClick={onEndSession}><Icon name="endsession" /></button>
      <button type="button" title="Clear the whole board" style={railBtn(false, theme, false, "#ff6b6b")} onClick={onClear}><Icon name="clear" /></button>
      <button type="button" title="Keyboard shortcuts (?)" style={railBtn(false, theme)} onClick={onHelp}><Icon name="help" /></button>
    </div>
  );
}

function FontPopover({ value, onChange, theme }: { value: number; onChange: (n: number) => void; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const { triggerRef, portal } = useFixedPopover(open, () => setOpen(false), theme);
  const sizes = [10, 12, 14, 16, 18, 22, 28, 36, 48, 64];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <button ref={triggerRef} type="button" title="Font size" onClick={() => setOpen((o) => !o)} style={railBtn(false, theme)}>
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>A</span>
      </button>
      <span style={{ fontSize: 9, opacity: 0.7, color: theme.textDim }}>{value}</span>
      {portal(
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 30px)", gap: 4 }}>
          {sizes.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onChange(n);
                setOpen(false);
              }}
              style={{ height: 28, borderRadius: 6, border: `1px solid ${value === n ? theme.accent : theme.panelBorder}`, background: value === n ? theme.accent : "transparent", color: value === n ? "#fff" : theme.text, cursor: "pointer", fontSize: 11 }}
            >
              {n}
            </button>
          ))}
        </div>,
      )}
    </div>
  );
}

function PolyPopover({ sides, setSides, star, setStar, theme }: { sides: number; setSides: (n: number) => void; star: boolean; setStar: (b: boolean) => void; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const { triggerRef, portal } = useFixedPopover(open, () => setOpen(false), theme);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <button ref={triggerRef} type="button" title="Polygon options" onClick={() => setOpen((o) => !o)} style={railBtn(false, theme)}><Icon name="polygon" /></button>
      <span style={{ fontSize: 9, opacity: 0.7, color: theme.textDim }}>{sides}{star ? "★" : ""}</span>
      {portal(
        <div style={{ minWidth: 150 }}>
          <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 4 }}>Sides: {sides}</div>
          <input type="range" min={3} max={12} value={sides} onChange={(e) => setSides(Number(e.target.value))} style={{ width: 140 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: theme.text, cursor: "pointer" }}>
            <input type="checkbox" checked={star} onChange={(e) => setStar(e.target.checked)} /> Star
          </label>
        </div>,
      )}
    </div>
  );
}

export function TopStatus({
  status,
  role,
  classId,
  busy,
  notice,
  error,
  theme,
  onReconnect,
  onClose,
}: {
  status: ConnectionStatus;
  role: string | null;
  classId: string;
  busy: string | null;
  notice: string | null;
  error: string | null;
  theme: Theme;
  onReconnect: () => void;
  onClose: () => void;
}) {
  const disconnected = status === "error" || status === "closed";
  return (
    <div style={topPill(theme)}>
      <span style={{ color: STATUS_COLOR[status], fontWeight: 700, whiteSpace: "nowrap" }} title={`Class ${classId.slice(0, 8)}…`}>
        ● {STATUS_LABEL[status]}
      </span>
      {role && <span style={{ opacity: 0.7, textTransform: "capitalize", color: theme.textDim }}>{role}</span>}
      {busy && <span style={{ color: "#e0921f", whiteSpace: "nowrap" }}>{busy}</span>}
      {(notice || (error && status !== "open")) && (
        <span style={{ color: "#e0533f", maxWidth: 280 }} role="alert">
          {notice ?? error}
        </span>
      )}
      {disconnected && (
        <button type="button" onClick={onReconnect} style={{ ...miniGhost(theme), borderColor: "#e0921f", color: "#e0921f" }}>
          Reconnect
        </button>
      )}
      <button type="button" onClick={onClose} title="Close board window" style={miniGhost(theme)}>
        Close
      </button>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────── */
/** Shared glassmorphism surface: translucent fill, saturated blur, inset sheen. */
const GLASS_BLUR = "blur(16px) saturate(160%)";
function glassSurface(theme: Theme): CSSProperties {
  return {
    background: theme.panel,
    border: `1px solid ${theme.panelBorder}`,
    backdropFilter: GLASS_BLUR,
    WebkitBackdropFilter: GLASS_BLUR,
    boxShadow:
      "0 10px 32px rgba(0,0,0,0.40), 0 1px 0 rgba(255,255,255,0.10) inset, 0 0 0 0.5px rgba(255,255,255,0.04)",
  };
}

function railStyle(side: "left" | "right", theme: Theme): CSSProperties {
  return {
    position: "fixed",
    top: "50%",
    [side]: 10,
    transform: "translateY(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    padding: "8px 6px",
    maxHeight: "94vh",
    overflowY: "auto",
    borderRadius: 16,
    zIndex: 30,
    ...glassSurface(theme),
  };
}

const groupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

function topPill(theme: Theme): CSSProperties {
  return {
    position: "fixed",
    top: 10,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 14px",
    borderRadius: 12,
    fontSize: 12.5,
    zIndex: 30,
    ...glassSurface(theme),
  };
}

function railBtn(active: boolean, theme: Theme, disabled = false, tint?: string): CSSProperties {
  const border = tint ?? (active ? theme.accent : "transparent");
  return {
    width: 34,
    height: 30,
    fontSize: 15,
    lineHeight: 1,
    borderRadius: 9,
    border: `1px solid ${border}`,
    background: active
      ? `linear-gradient(180deg, ${theme.accent}, ${theme.accent}cc)`
      : "transparent",
    color: disabled ? "rgba(140,144,163,0.45)" : active ? "#fff" : tint ?? theme.textDim,
    cursor: disabled ? "default" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease",
    boxShadow: active ? `0 0 0 3px ${theme.accentGlow}` : "none",
  };
}

function miniGhost(theme: Theme): CSSProperties {
  return {
    padding: "4px 8px",
    fontSize: 12,
    borderRadius: 7,
    border: `1px solid ${theme.panelBorder}`,
    background: "transparent",
    color: theme.textDim,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function Sep({ theme }: { theme: Theme }): ReactNode {
  return <span aria-hidden style={{ width: 22, height: 1, background: theme.panelBorder, opacity: 0.7 }} />;
}

/**
 * Hover/active affordances the inline-style buttons can't express on their own
 * (`:hover`, slim scrollbars). Rendered once inside each rail; the selectors are
 * scoped to `.wb-rail` so they never leak to the rest of the app.
 */
function GlassHoverStyle(): ReactNode {
  return (
    <style>{`
      .wb-rail button:not(:disabled):not([aria-pressed="true"]):hover {
        background: rgba(255,255,255,0.10) !important;
        color: #fff !important;
      }
      .wb-rail button:active:not(:disabled) { transform: translateY(0.5px); }
      .wb-rail::-webkit-scrollbar { width: 6px; }
      .wb-rail::-webkit-scrollbar-thumb { background: rgba(140,150,190,0.35); border-radius: 6px; }
      .wb-rail::-webkit-scrollbar-track { background: transparent; }
    `}</style>
  );
}

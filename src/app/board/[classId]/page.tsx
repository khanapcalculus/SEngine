"use client";

/**
 * Pop-out Whiteboard — a chromeless, full-viewport collaborative canvas.
 *
 * Opened in its own browser window from the Classroom view (window.open), this
 * route lives OUTSIDE /dashboard so it carries no sidebar/header — just the
 * board. It reuses the already-deployed RTC stack end to end (useWhiteboardSocket
 * → token mint → Cloudflare Worker → Durable Object). Op payloads are OPAQUE to
 * the backend, so the whole tool set rides on the existing `stroke`/`shape`/
 * `equation` op types plus the client-only `erase`/`modify` ops.
 *
 * Tools: select (click + marquee, move/resize/rotate), smooth pen, geometry
 * (line/rect/ellipse/arrow/arc/polygon), frames, text + LaTeX math (KaTeX),
 * image + PDF insert, and an object eraser. Edits are collaborative `modify` ops
 * (a normalized affine transform + style + delete), undo/redo is a local stack
 * of inverse ops, and framed regions export to PDF. Every created object carries
 * a stable id. Capabilities mirror the server: only `canDraw` peers get tools.
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
import type { WhiteboardOpType } from "../../dashboard/whiteboard/connection";
import {
  isFarEnough,
  packStrokePayload,
  smoothStroke,
  BG,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  MIN_POINT_DELTA,
  MAX_POINTS,
  type Pt,
} from "./strokes";
import {
  idOf,
  hitTest,
  DEFAULT_FONT_SIZE,
  type Tool,
  type Size,
  type ShapePayload,
} from "./tools";
import {
  IDENTITY,
  asMat,
  isIdentity,
  apply,
  invert,
  multiply,
  translation,
  resizeMatrix,
  rotateMatrix,
  angleAbout,
  opBBox,
  transformedAABB,
  type Mat,
  type HandleKey,
} from "./transform";
import {
  SelectionOverlay,
  Marquee,
  singleHandles,
  rotateKnob,
} from "./selection";
import { LeftRail, RightRail, TopStatus } from "./toolbar";
import { THEMES, loadTheme, saveTheme, type ThemeName } from "./theme";
import { uploadBoardImage, uploadBoardImageDetailed, imageNaturalSize, fitNormalized } from "./upload";
import { renderOp, katexHtml } from "./render";
import { exportBoardPdf, captureBoardPng, type ExportRegion } from "./export-pdf";

/* ── constants ──────────────────────────────────────────────────── */
const CURSOR_THROTTLE_MS = 60;
/** Tools created by a drag from start→end. */
const DRAG_SHAPE: ReadonlySet<Tool> = new Set<Tool>(["line", "arrow", "rect", "ellipse", "polygon", "frame"]);
const HANDLE_GRAB_PX = 9;
const GRID_PX = 24;
const ID = [1, 0, 0, 1, 0, 0] as Mat;

const newId = () => crypto.randomUUID();

/** A whiteboard op as sent on the wire / stored on the undo stack. */
type Op = { type: WhiteboardOpType; payload?: unknown };

/** A reversible action: ops to replay for undo and for redo. */
interface UndoEntry {
  undo: Op[];
  redo: Op[];
}

type Drag =
  | { kind: "pen" }
  | { kind: "shape"; tool: Tool; start: Pt; shift: boolean }
  | { kind: "move"; start: Pt; ids: string[]; m0: Record<string, Mat> }
  | { kind: "resize"; id: string; handle: HandleKey; bbox: ReturnType<typeof opBBox>; m0: Mat }
  | { kind: "rotate"; id: string; center: Pt; startAngle: number; m0: Mat }
  | { kind: "marquee"; origin: Pt }
  | { kind: "pan"; sx: number; sy: number; tx0: number; ty0: number };

/** View camera (jengine-style): content is translated by (tx,ty) then scaled by
 *  `zoom`, in screen pixels. Board coords stay normalized; the camera only
 *  changes what part of the board is on screen, so it's a purely local view. */
interface View {
  tx: number;
  ty: number;
  zoom: number;
}
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;

interface Editing {
  kind: "text" | "math";
  x: number;
  y: number;
  value: string;
}

/** Best-effort human message from an upload failure. */
function uploadErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg || "unknown error";
}

export default function BoardPage() {
  const params = useParams();
  const classId =
    typeof params.classId === "string"
      ? params.classId
      : Array.isArray(params.classId)
        ? params.classId[0]
        : "";

  const { status, canDraw, role, error, ops, cursors, erased, mutations, sendOp, reconnect } =
    useWhiteboardSocket(classId || null);

  /* ── tool + style state ────────────────────────────────────────── */
  const [tool, setToolRaw] = useState<Tool>("pen");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [fillColor, setFillColor] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [sides, setSides] = useState(5);
  const [star, setStar] = useState(false);
  const [snap, setSnap] = useState(false);
  const [grid, setGrid] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  /* ── theme (persisted) ─────────────────────────────────────────── */
  const [themeName, setThemeName] = useState<ThemeName>("dark");
  useEffect(() => {
    setThemeName(loadTheme());
  }, []);
  const theme = THEMES[themeName];
  const toggleTheme = useCallback(() => {
    setThemeName((t) => {
      const next: ThemeName = t === "dark" ? "light" : "dark";
      saveTheme(next);
      return next;
    });
  }, []);
  /** Derived boolean: shapes are filled when a fill colour is chosen. */
  const fill = fillColor !== null;

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  /* ── viewport mapping + camera ─────────────────────────────────── */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ tx: 0, ty: 0, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
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

  /** Pointer → board-normalized coords, un-projecting the camera. Not clamped to
   *  [0,1] so the user can draw/pan into the space around the home region. */
  const toNorm = useCallback((e: { clientX: number; clientY: number }): Pt | null => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const v = viewRef.current;
    const cx = (e.clientX - r.left - v.tx) / v.zoom; // content px (pre-camera)
    const cy = (e.clientY - r.top - v.ty) / v.zoom;
    return { x: cx / r.width, y: cy / r.height };
  }, []);

  /** Zoom by `factor` about a screen point, keeping that point fixed (jengine). */
  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    setView((v) => {
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * factor));
      if (zoom === v.zoom) return v;
      return {
        zoom,
        tx: sx - (zoom / v.zoom) * (sx - v.tx),
        ty: sy - (zoom / v.zoom) * (sy - v.ty),
      };
    });
  }, []);

  const resetView = useCallback(() => setView({ tx: 0, ty: 0, zoom: 1 }), []);

  // Space-to-pan (hold space, drag) — tracked globally, ignored while typing.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Wheel = zoom at cursor (non-passive so we can prevent page scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /* ── selection + transform state ───────────────────────────────── */
  const [selection, setSelection] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, Mat>>({});
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);

  /* ── undo / redo ───────────────────────────────────────────────── */
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const pushUndo = useCallback((entry: UndoEntry) => {
    setUndoStack((s) => [...s, entry].slice(-100));
    setRedoStack([]);
  }, []);
  const doUndo = useCallback(() => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const entry = s[s.length - 1];
      entry.undo.forEach((op) => sendOp(op));
      setRedoStack((r) => [...r, entry]);
      return s.slice(0, -1);
    });
  }, [sendOp]);
  const doRedo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const entry = r[r.length - 1];
      entry.redo.forEach((op) => sendOp(op));
      setUndoStack((s) => [...s, entry]);
      return r.slice(0, -1);
    });
  }, [sendOp]);

  /* ── op emitters ───────────────────────────────────────────────── */
  /** Send a create op and record its create/delete inverse for undo. */
  const emitCreate = useCallback(
    (op: Op) => {
      const id = idOf({ payload: op.payload });
      sendOp(op);
      if (id) {
        pushUndo({
          undo: [{ type: "modify", payload: { targetId: id, deleted: true } }],
          redo: [{ type: "modify", payload: { targetId: id, deleted: false } }],
        });
      }
    },
    [sendOp, pushUndo],
  );

  const ready = canDraw && status === "open";

  /* ── live object model (id → base bbox + effective matrix), z-ordered ── */
  const objects = useMemo(() => {
    const list = ops
      .map((op, index) => {
        const id = idOf(op);
        if (!id || erased.has(id)) return null;
        const bbox = opBBox(op, size);
        if (!bbox) return null;
        const mut = mutations.get(id);
        const m = preview[id] ?? (mut?.m ? asMat(mut.m) : ID);
        return { id, op, index, bbox, m, z: mut?.z ?? 0 };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null);
    return list;
  }, [ops, erased, mutations, size, preview]);

  /** Ops in paint order (z, then creation order) for rendering + hit-testing. */
  const ordered = useMemo(() => {
    return ops
      .map((op, index) => ({ op, index, z: (idOf(op) && mutations.get(idOf(op)!)?.z) || 0 }))
      .sort((a, b) => a.z - b.z || a.index - b.index);
  }, [ops, mutations]);
  const byId = useCallback((id: string) => objects.find((o) => o.id === id) ?? null, [objects]);

  /**
   * Topmost object under board-point `p`, honouring each object's transform.
   * hitTest works on an object's BASE geometry, so we map the point into the
   * object's local frame with `inverse(m)` first — otherwise a moved/rotated/
   * resized object can't be re-clicked (its visible position ≠ its base geometry).
   * Iterates in reverse paint order so the front-most object wins.
   */
  const pickTopmost = useCallback(
    (p: Pt): string | null => {
      const sorted = [...objects].sort((a, b) => a.z - b.z || a.index - b.index);
      for (let i = sorted.length - 1; i >= 0; i--) {
        const o = sorted[i];
        const local = isIdentity(o.m) ? p : apply(invert(o.m), p);
        if (hitTest(o.op, local, size)) return o.id;
      }
      return null;
    },
    [objects, size],
  );

  const switchTool = useCallback((t: Tool) => {
    setToolRaw(t);
    if (t !== "select") setSelection([]);
  }, []);

  /* ── drawing engine (pen + drag shapes) ────────────────────────── */
  const draftRef = useRef<Pt[]>([]);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [shapeDraft, setShapeDraft] = useState<ShapePayload | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [arcCenter, setArcCenter] = useState<Pt | null>(null);
  const lastCursorSent = useRef(0);
  const spaceRef = useRef(false); // space held → temporary pan

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

  /** Build the live shape payload for a drag-created tool. */
  const buildDragShape = useCallback(
    (t: Tool, start: Pt, end: Pt, shift: boolean): ShapePayload | null => {
      if (t === "line" || t === "arrow") {
        return { kind: t, start, end, color, width };
      }
      if (t === "rect" || t === "ellipse") {
        let e = end;
        if (shift) {
          const ext = Math.max(Math.abs(end.x - start.x) * size.w, Math.abs(end.y - start.y) * size.h);
          e = {
            x: start.x + Math.sign(end.x - start.x || 1) * (ext / size.w),
            y: start.y + Math.sign(end.y - start.y || 1) * (ext / size.h),
          };
        }
        return { kind: t, start, end: e, color, width, fill, ...(fillColor ? { fillColor } : {}) };
      }
      if (t === "frame") {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        const n = ops.filter((o) => (o.payload as { kind?: string })?.kind === "frame").length + 1;
        return { kind: "frame", x, y, w, h, label: `Frame ${n}`, color };
      }
      if (t === "polygon") {
        // Radius from the drag distance in PIXELS, normalized to the smaller
        // axis so the polygon stays regular (isotropic) on any viewport.
        const ref = Math.min(size.w, size.h) || 1;
        const r = Math.hypot((end.x - start.x) * size.w, (end.y - start.y) * size.h) / ref;
        const rot = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI + 90;
        return { kind: "polygon", cx: start.x, cy: start.y, r, sides, rot, star, color, width, fill, ...(fillColor ? { fillColor } : {}) };
      }
      return null;
    },
    [color, width, fill, fillColor, sides, star, size, ops],
  );

  const snapNorm = useCallback(
    (p: Pt): Pt => {
      if (!snap) return p;
      const sx = (GRID_PX / size.w) || 0;
      const sy = (GRID_PX / size.h) || 0;
      return { x: sx ? Math.round(p.x / sx) * sx : p.x, y: sy ? Math.round(p.y / sy) * sy : p.y };
    },
    [snap, size],
  );

  /* ── pointer down ──────────────────────────────────────────────── */
  function onPointerDown(e: ReactPointerEvent) {
    // Pan is available to everyone (even view-only): hand tool, space-drag, or
    // middle mouse button. Handled before the draw-gate below.
    if (tool === "pan" || spaceRef.current || e.button === 1) {
      dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, tx0: view.tx, ty0: view.ty };
      capture(e);
      return;
    }
    if (!ready) return;
    const p = toNorm(e);
    if (!p) return;
    const pPx = { x: p.x * size.w, y: p.y * size.h };

    if (tool === "pen") {
      dragRef.current = { kind: "pen" };
      draftRef.current = [p];
      setDraft([p]);
      capture(e);
      return;
    }
    if (DRAG_SHAPE.has(tool)) {
      dragRef.current = { kind: "shape", tool, start: p, shift: e.shiftKey };
      setShapeDraft(buildDragShape(tool, p, p, e.shiftKey));
      capture(e);
      return;
    }
    if (tool === "arc") {
      setArcCenter(p);
      return;
    }
    if (tool === "text" || tool === "math") {
      setEditing({ kind: tool, x: p.x, y: p.y, value: "" });
      return;
    }
    if (tool === "erase") {
      const id = pickTopmost(p);
      if (id) {
        sendOp({ type: "modify", payload: { targetId: id, deleted: true } });
        pushUndo({
          undo: [{ type: "modify", payload: { targetId: id, deleted: false } }],
          redo: [{ type: "modify", payload: { targetId: id, deleted: true } }],
        });
      }
      return;
    }

    // ── select tool ──
    if (tool === "select") {
      // Handles / rotate knob take priority for a single selection.
      if (selection.length === 1) {
        const obj = byId(selection[0]);
        if (obj) {
          const knob = rotateKnob(obj.bbox, obj.m, size);
          if (knob && Math.hypot(pPx.x - knob.x, pPx.y - knob.y) <= HANDLE_GRAB_PX + 2) {
            const center = applyCenter(obj.bbox, obj.m);
            dragRef.current = { kind: "rotate", id: obj.id, center, startAngle: angleAbout(center, p, size), m0: obj.m };
            capture(e);
            return;
          }
          const handle = singleHandles(obj.bbox, obj.m, size).find(
            (h) => Math.hypot(pPx.x - h.x, pPx.y - h.y) <= HANDLE_GRAB_PX,
          );
          if (handle) {
            dragRef.current = { kind: "resize", id: obj.id, handle: handle.key, bbox: obj.bbox, m0: obj.m };
            capture(e);
            return;
          }
        }
      }

      const hit = pickTopmost(p);
      if (hit) {
        const ids = e.shiftKey ? Array.from(new Set([...selection, hit])) : selection.includes(hit) ? selection : [hit];
        setSelection(ids);
        const m0: Record<string, Mat> = {};
        ids.forEach((id) => {
          const o = byId(id);
          m0[id] = o ? o.m : ID;
        });
        dragRef.current = { kind: "move", start: p, ids, m0 };
        capture(e);
      } else {
        if (!e.shiftKey) setSelection([]);
        dragRef.current = { kind: "marquee", origin: p };
        setMarquee({ x: pPx.x, y: pPx.y, w: 0, h: 0 });
        capture(e);
      }
    }
  }

  /* ── pointer move ──────────────────────────────────────────────── */
  function onPointerMove(e: ReactPointerEvent) {
    if (status === "open") {
      const now = Date.now();
      if (now - lastCursorSent.current >= CURSOR_THROTTLE_MS) {
        lastCursorSent.current = now;
        const c = toNorm(e);
        if (c) sendOp({ type: "cursor", payload: c });
      }
    }

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === "pan") {
      setView((v) => ({ ...v, tx: drag.tx0 + (e.clientX - drag.sx), ty: drag.ty0 + (e.clientY - drag.sy) }));
      return;
    }

    const p = toNorm(e);
    if (!p) return;

    if (drag.kind === "pen") {
      const pts = draftRef.current;
      if (pts.length >= MAX_POINTS) return;
      if (!isFarEnough(pts[pts.length - 1], p, MIN_POINT_DELTA)) return;
      pts.push(p);
      setDraft([...pts]);
      return;
    }
    if (drag.kind === "shape") {
      setShapeDraft(buildDragShape(drag.tool, drag.start, p, e.shiftKey || drag.shift));
      return;
    }
    if (drag.kind === "move") {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const d = snapNorm({ x: dx, y: dy });
      const next: Record<string, Mat> = {};
      drag.ids.forEach((id) => {
        next[id] = multiply(translation(d.x, d.y), drag.m0[id] ?? ID);
      });
      setPreview(next);
      return;
    }
    if (drag.kind === "resize" && drag.bbox) {
      setPreview({ [drag.id]: resizeMatrix(drag.bbox, drag.m0, drag.handle, p, e.shiftKey) });
      return;
    }
    if (drag.kind === "rotate") {
      let dTheta = angleAbout(drag.center, p, size) - drag.startAngle;
      if (e.shiftKey) dTheta = Math.round(dTheta / (Math.PI / 12)) * (Math.PI / 12);
      setPreview({ [drag.id]: rotateMatrix(drag.m0, drag.center, dTheta, size) });
      return;
    }
    if (drag.kind === "marquee") {
      const ox = drag.origin.x * size.w;
      const oy = drag.origin.y * size.h;
      const cx = p.x * size.w;
      const cy = p.y * size.h;
      setMarquee({ x: Math.min(ox, cx), y: Math.min(oy, cy), w: Math.abs(cx - ox), h: Math.abs(cy - oy) });
    }
  }

  /* ── pointer up ────────────────────────────────────────────────── */
  function onPointerUp(e: ReactPointerEvent) {
    const drag = dragRef.current;
    dragRef.current = null;
    release(e);
    if (!drag) return;

    if (drag.kind === "pen") {
      const points = draftRef.current;
      draftRef.current = [];
      setDraft([]);
      if (points.length === 0) return;
      emitCreate({ type: "stroke", payload: packStrokePayload(smoothStroke(points), color, width, newId()) });
      return;
    }
    if (drag.kind === "shape") {
      const payload = shapeDraft;
      setShapeDraft(null);
      const p = toNorm(e) ?? drag.start;
      const moved = Math.abs(p.x - drag.start.x) > 0.004 || Math.abs(p.y - drag.start.y) > 0.004;
      if (!payload || !moved) return;
      emitCreate({ type: "shape", payload: { ...payload, id: newId() } });
      return;
    }
    if (drag.kind === "move" || drag.kind === "resize" || drag.kind === "rotate") {
      commitTransform(drag);
      return;
    }
    if (drag.kind === "marquee") {
      const m = marquee;
      setMarquee(null);
      if (!m || (m.w < 3 && m.h < 3)) return;
      const rect = { x: m.x / size.w, y: m.y / size.h, w: m.w / size.w, h: m.h / size.h };
      const hits = objects
        .filter((o) => {
          const b = transformedAABB(o.bbox, o.m);
          return b.x < rect.x + rect.w && b.x + b.w > rect.x && b.y < rect.y + rect.h && b.y + b.h > rect.y;
        })
        .map((o) => o.id);
      setSelection((sel) => (e.shiftKey ? Array.from(new Set([...sel, ...hits])) : hits));
    }
  }

  /** Commit a move/resize/rotate preview as collaborative `modify` ops + undo. */
  const commitTransform = useCallback(
    (drag: Extract<Drag, { kind: "move" | "resize" | "rotate" }>) => {
      const ids = drag.kind === "move" ? drag.ids : [drag.id];
      const undo: Op[] = [];
      const redo: Op[] = [];
      let changed = false;
      ids.forEach((id) => {
        const after = preview[id];
        if (!after) return;
        const before = drag.kind === "move" ? drag.m0[id] ?? ID : drag.m0;
        // Skip a no-op (a click that didn't move).
        if (after.every((v, i) => Math.abs(v - before[i]) < 1e-6)) return;
        changed = true;
        sendOp({ type: "modify", payload: { targetId: id, m: after } });
        undo.push({ type: "modify", payload: { targetId: id, m: before } });
        redo.push({ type: "modify", payload: { targetId: id, m: after } });
      });
      setPreview({});
      if (changed) pushUndo({ undo, redo });
    },
    [preview, sendOp, pushUndo],
  );

  /* ── restyle the current selection (color / width / fill / font) ── */
  type StylePatch = { color?: string; width?: number; fill?: boolean; fillColor?: string; fontSize?: number };
  const baseStyleOf = useCallback(
    (id: string): StylePatch => {
      const op = ops.find((o) => idOf(o) === id);
      const pl = (op?.payload ?? {}) as Record<string, unknown>;
      const prev = mutations.get(id)?.style ?? {};
      return {
        color: prev.color ?? (typeof pl.color === "string" ? pl.color : undefined),
        width: prev.width ?? (typeof pl.width === "number" ? pl.width : undefined),
        fill: prev.fill ?? (typeof pl.fill === "boolean" ? pl.fill : undefined),
        fillColor: prev.fillColor ?? (typeof pl.fillColor === "string" ? pl.fillColor : undefined),
        fontSize: prev.fontSize ?? (typeof pl.fontSize === "number" ? pl.fontSize : undefined),
      };
    },
    [ops, mutations],
  );

  const restyleSelection = useCallback(
    (patch: StylePatch) => {
      if (tool !== "select" || selection.length === 0) return;
      const undo: Op[] = [];
      const redo: Op[] = [];
      selection.forEach((id) => {
        const before = baseStyleOf(id);
        sendOp({ type: "modify", payload: { targetId: id, style: patch } });
        undo.push({ type: "modify", payload: { targetId: id, style: before } });
        redo.push({ type: "modify", payload: { targetId: id, style: patch } });
      });
      pushUndo({ undo, redo });
    },
    [tool, selection, baseStyleOf, sendOp, pushUndo],
  );

  // Style setters that also restyle a live selection.
  const onColor = (c: string) => {
    setColor(c);
    restyleSelection({ color: c });
  };
  const onWidth = (w: number) => {
    setWidth(w);
    restyleSelection({ width: w });
  };
  const onFillColor = (c: string | null) => {
    setFillColor(c);
    restyleSelection(c === null ? { fill: false } : { fill: true, fillColor: c });
  };
  const onFont = (n: number) => {
    setFontSize(n);
    restyleSelection({ fontSize: n });
  };

  /* ── selection actions ─────────────────────────────────────────── */
  const deleteSelection = useCallback(() => {
    if (selection.length === 0) return;
    const undo: Op[] = [];
    const redo: Op[] = [];
    selection.forEach((id) => {
      sendOp({ type: "modify", payload: { targetId: id, deleted: true } });
      undo.push({ type: "modify", payload: { targetId: id, deleted: false } });
      redo.push({ type: "modify", payload: { targetId: id, deleted: true } });
    });
    pushUndo({ undo, redo });
    setSelection([]);
  }, [selection, sendOp, pushUndo]);

  const duplicateSelection = useCallback(() => {
    if (selection.length === 0) return;
    const undo: Op[] = [];
    const redo: Op[] = [];
    const newIds: string[] = [];
    selection.forEach((id) => {
      const op = ops.find((o) => idOf(o) === id);
      if (!op) return;
      const nid = newId();
      const payload = { ...(op.payload as object), id: nid };
      const off = multiply(translation(0.02, 0.02), byId(id)?.m ?? ID);
      const createOp: Op = { type: op.type as WhiteboardOpType, payload };
      const modOp: Op = { type: "modify", payload: { targetId: nid, m: off } };
      sendOp(createOp);
      sendOp(modOp);
      redo.push(createOp, modOp);
      undo.push({ type: "modify", payload: { targetId: nid, deleted: true } });
      newIds.push(nid);
    });
    pushUndo({ undo, redo });
    setSelection(newIds);
  }, [selection, ops, byId, sendOp, pushUndo]);

  const restack = useCallback(
    (toFront: boolean) => {
      if (selection.length === 0) return;
      const zs = ordered.map((o) => o.z);
      const target = toFront ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
      const undo: Op[] = [];
      const redo: Op[] = [];
      selection.forEach((id) => {
        const before = mutations.get(id)?.z ?? 0;
        sendOp({ type: "modify", payload: { targetId: id, z: target } });
        undo.push({ type: "modify", payload: { targetId: id, z: before } });
        redo.push({ type: "modify", payload: { targetId: id, z: target } });
      });
      pushUndo({ undo, redo });
    },
    [selection, ordered, mutations, sendOp, pushUndo],
  );

  const nudge = useCallback(
    (dxPx: number, dyPx: number) => {
      if (selection.length === 0) return;
      const dx = dxPx / size.w;
      const dy = dyPx / size.h;
      const undo: Op[] = [];
      const redo: Op[] = [];
      selection.forEach((id) => {
        const before = byId(id)?.m ?? ID;
        const after = multiply(translation(dx, dy), before);
        sendOp({ type: "modify", payload: { targetId: id, m: after } });
        undo.push({ type: "modify", payload: { targetId: id, m: before } });
        redo.push({ type: "modify", payload: { targetId: id, m: after } });
      });
      pushUndo({ undo, redo });
    },
    [selection, size, byId, sendOp, pushUndo],
  );

  /* ── text / math commit ────────────────────────────────────────── */
  function commitEditing() {
    if (!editing) return;
    const v = editing.value.trim();
    const { kind, x, y } = editing;
    setEditing(null);
    if (!v) return;
    const id = newId();
    if (kind === "text") {
      emitCreate({ type: "shape", payload: { id, kind: "text", x, y, text: v, fontSize, color } });
    } else {
      emitCreate({ type: "equation", payload: { id, x, y, latex: v, fontSize, color } });
    }
  }

  /* ── arc commit ────────────────────────────────────────────────── */
  function commitArc(radiusPct: number, a0: number, a1: number) {
    const c = arcCenter;
    setArcCenter(null);
    if (!c) return;
    emitCreate({
      type: "shape",
      payload: { id: newId(), kind: "arc", cx: c.x, cy: c.y, r: Math.max(0.01, radiusPct / 100), a0, a1, color, width },
    });
  }

  const clearBoard = useCallback(() => {
    if (!window.confirm("Clear the whole board for everyone? This can't be undone.")) return;
    draftRef.current = [];
    setDraft([]);
    setSelection([]);
    setUndoStack([]);
    setRedoStack([]);
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
      emitCreate({ type: "shape", payload: { id: newId(), kind: "image", url, x, y, w: box.w, h: box.h } });
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
    setBusy("Rendering PDF…");
    let pages;
    try {
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
    try {
      for (let i = 0; i < pages.length; i++) {
        setBusy(`Uploading page ${i + 1}/${pages.length}…`);
        const pg = pages[i];
        const url = await uploadBoardImage(classId, pg.blob, `${file.name}-p${i + 1}.png`);
        const box = fitNormalized(pg.width, pg.height, size);
        const offv = i * 0.04;
        const x = Math.max(0, Math.min(0.95 - box.w, 0.06 + offv));
        const y = Math.max(0, Math.min(0.95 - box.h, 0.06 + offv));
        emitCreate({ type: "shape", payload: { id: newId(), kind: "image", url, x, y, w: box.w, h: box.h } });
      }
    } catch (err) {
      setNotice(`PDF page upload failed: ${uploadErr(err)}`);
    } finally {
      setBusy(null);
    }
  }

  /* ── export to PDF ─────────────────────────────────────────────── */
  const onExport = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const regions: ExportRegion[] = ops
      .map((op) => {
        const id = idOf(op);
        if (!id || erased.has(id)) return null;
        const pl = op.payload as { kind?: string; label?: string };
        if (pl?.kind !== "frame") return null;
        const b = opBBox(op, size);
        if (!b) return null;
        const m = mutations.get(id)?.m ? asMat(mutations.get(id)!.m!) : ID;
        const t = transformedAABB(b, m);
        return { x: t.x, y: t.y, w: t.w, h: t.h, label: pl.label ?? "Frame" };
      })
      .filter((r): r is ExportRegion => r !== null);

    setBusy("Building PDF…");
    try {
      await exportBoardPdf(svg, regions, size, `whiteboard-${classId.slice(0, 8)}.pdf`, theme.bg);
    } catch (err) {
      setNotice(`PDF export failed: ${uploadErr(err)}`);
    } finally {
      setBusy(null);
    }
  }, [ops, erased, mutations, size, classId, theme.bg]);

  /* ── end session (snapshot → attendance → payroll, atomic) ──────── */
  const onEndSession = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const payRaw = window.prompt(
      "End this session?\n\nThis saves a whiteboard snapshot, logs your attendance, and posts a payroll entry — all together (or not at all).\n\nSession pay amount for the ledger:",
      "0",
    );
    if (payRaw === null) return; // cancelled
    const payAmount = Number(payRaw);
    if (!Number.isFinite(payAmount) || payAmount < 0) {
      setNotice("End session: enter a valid non-negative pay amount.");
      return;
    }
    setNotice(null);
    setBusy("Capturing snapshot…");
    try {
      const png = await captureBoardPng(svg, size, theme.bg);
      setBusy("Uploading snapshot…");
      const { url, storageKey } = await uploadBoardImageDetailed(
        classId,
        png,
        `session-${classId.slice(0, 8)}-${Date.now()}.png`,
      );
      setBusy("Closing session…");
      const res = await fetch(`/api/me/classroom/${classId}/end-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshotUrl: url, snapshotKey: storageKey, payAmount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.fields ? Object.values(data.fields).join("; ") : data.error;
        throw new Error(msg ?? `Failed (HTTP ${res.status})`);
      }
      setNotice("Session ended: snapshot saved, attendance logged, payroll posted.");
    } catch (err) {
      setNotice(`End session failed: ${uploadErr(err)}`);
    } finally {
      setBusy(null);
    }
  }, [classId, size, theme.bg]);

  /* ── keyboard shortcuts ────────────────────────────────────────── */
  useEffect(() => {
    if (!ready) return;
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = ev.ctrlKey || ev.metaKey;

      if (mod && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        ev.shiftKey ? doRedo() : doUndo();
        return;
      }
      if (mod && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        doRedo();
        return;
      }
      if (mod && ev.key.toLowerCase() === "d") {
        ev.preventDefault();
        duplicateSelection();
        return;
      }
      if (ev.key === "Delete" || ev.key === "Backspace") {
        if (selection.length) {
          ev.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (ev.key === "Escape") {
        setSelection([]);
        setEditing(null);
        setArcCenter(null);
        setShowHelp(false);
        return;
      }
      if (ev.key === "ArrowUp") return void (selection.length && (ev.preventDefault(), nudge(0, ev.shiftKey ? -10 : -1)));
      if (ev.key === "ArrowDown") return void (selection.length && (ev.preventDefault(), nudge(0, ev.shiftKey ? 10 : 1)));
      if (ev.key === "ArrowLeft") return void (selection.length && (ev.preventDefault(), nudge(ev.shiftKey ? -10 : -1, 0)));
      if (ev.key === "ArrowRight") return void (selection.length && (ev.preventDefault(), nudge(ev.shiftKey ? 10 : 1, 0)));
      if (ev.key === "]") return restack(true);
      if (ev.key === "[") return restack(false);
      if (ev.key === "?") return setShowHelp((s) => !s);
      if (mod) return;

      if (ev.key === "0") return resetView();
      if (ev.key === "+" || ev.key === "=") return zoomAt(size.w / 2, size.h / 2, 1.2);
      if (ev.key === "-" || ev.key === "_") return zoomAt(size.w / 2, size.h / 2, 1 / 1.2);

      const map: Record<string, Tool> = {
        v: "select", h: "pan", p: "pen", e: "erase", l: "line", a: "arrow",
        r: "rect", o: "ellipse", c: "arc", g: "polygon", f: "frame", x: "text", m: "math",
      };
      const next = map[ev.key.toLowerCase()];
      if (next) switchTool(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, selection, doUndo, doRedo, duplicateSelection, deleteSelection, nudge, restack, switchTool, zoomAt, resetView, size.w, size.h]);

  /* ── render data ───────────────────────────────────────────────── */
  const cursorMarks = useMemo(
    () =>
      Object.entries(cursors)
        .map(([id, op]) => {
          const p = op.payload as Pt | undefined;
          return p && typeof p.x === "number" && typeof p.y === "number" ? { id, x: p.x, y: p.y } : null;
        })
        .filter((c): c is { id: string; x: number; y: number } => c !== null),
    [cursors],
  );

  const selBoxes = useMemo(() => {
    const sel = selection.map((id) => byId(id)).filter((o): o is NonNullable<typeof o> => !!o);
    if (sel.length === 1) {
      return { single: { bbox: sel[0].bbox, m: sel[0].m }, multiRect: null as null | { x: number; y: number; w: number; h: number } };
    }
    if (sel.length > 1) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      sel.forEach((o) => {
        const b = transformedAABB(o.bbox, o.m);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      });
      return { single: null, multiRect: { x: minX * size.w, y: minY * size.h, w: (maxX - minX) * size.w, h: (maxY - minY) * size.h } };
    }
    return { single: null, multiRect: null };
  }, [selection, byId, size]);

  const cursorStyle =
    tool === "pan"
      ? "grab"
      : !canDraw
        ? "default"
        : tool === "erase"
          ? "cell"
          : tool === "select"
            ? "default"
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
    <div style={{ position: "fixed", inset: 0, background: theme.bg, overflow: "hidden", userSelect: "none", touchAction: "none" }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ display: "block", width: "100vw", height: "100vh", cursor: cursorStyle, background: theme.bg }}
      >
        {/* camera: pan (tx,ty) + zoom; everything board-space lives inside */}
        <g data-camera transform={`translate(${view.tx} ${view.ty}) scale(${view.zoom})`}>
          {grid && (
            <g data-export-skip>
              <defs>
                {/* Minor cells tile the major block; the major pattern draws the
                    bold every-5th lines on top — an engineering/graph-paper grid. */}
                <pattern id="grid-minor" width={GRID_PX} height={GRID_PX} patternUnits="userSpaceOnUse">
                  <path d={`M ${GRID_PX} 0 L 0 0 0 ${GRID_PX}`} fill="none" stroke={theme.gridMinor} strokeWidth={1} />
                </pattern>
                <pattern id="grid-major" width={GRID_PX * 5} height={GRID_PX * 5} patternUnits="userSpaceOnUse">
                  <rect width={GRID_PX * 5} height={GRID_PX * 5} fill="url(#grid-minor)" />
                  <path d={`M ${GRID_PX * 5} 0 L 0 0 0 ${GRID_PX * 5}`} fill="none" stroke={theme.gridMajor} strokeWidth={1.4} />
                </pattern>
              </defs>
              <rect x={-100000} y={-100000} width={200000} height={200000} fill="url(#grid-major)" />
            </g>
          )}

          {/* committed ops (z-ordered, skip erased), with live mutation + preview */}
          {ordered.map(({ op, index }) => {
            const id = idOf(op);
            if (id && erased.has(id)) return null;
            const mut = id ? mutations.get(id) : undefined;
            const m = id && preview[id] ? preview[id] : mut?.m ? asMat(mut.m) : undefined;
            const effMut = id ? { ...mut, m: m && !isIdentity(m) ? Array.from(m) : undefined } : undefined;
            return <Fragment key={id ?? index}>{renderOp(op, size, effMut)}</Fragment>;
          })}

          {/* live drafts */}
          {draft.length > 0 && renderOp({ type: "stroke", payload: { points: draft, color, width } }, size)}
          {shapeDraft && renderOp({ type: "shape", payload: shapeDraft }, size)}
          {arcCenter && (
            <circle data-export-skip cx={arcCenter.x * size.w} cy={arcCenter.y * size.h} r={4} fill="#5570ff" />
          )}

          {/* selection overlay */}
          {tool === "select" && (
            <SelectionOverlay single={selBoxes.single} multiRect={selBoxes.multiRect} bbox={null} m={null} size={size} />
          )}
          {marquee && <Marquee rect={marquee} />}

          {/* peer cursors */}
          {cursorMarks.map((c) => (
            <g key={c.id} data-export-skip transform={`translate(${c.x * size.w}, ${c.y * size.h})`}>
              <circle r={7} fill="none" stroke="#ffcf8f" strokeWidth={1.5} />
              <circle r={2} fill="#ffcf8f" />
            </g>
          ))}
        </g>
      </svg>

      {/* text / math inline editor */}
      {editing && (
        <Editor
          editing={editing}
          size={size}
          view={view}
          color={color}
          fontSize={fontSize}
          onChange={(value) => setEditing((s) => (s ? { ...s, value } : s))}
          onCommit={commitEditing}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* arc parameter dialog */}
      {arcCenter && <ArcDialog size={size} view={view} center={arcCenter} onCommit={commitArc} onCancel={() => setArcCenter(null)} />}

      {/* hidden file inputs */}
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" onChange={onImageFile} style={{ display: "none" }} />
      <input ref={pdfInputRef} type="file" accept="application/pdf" onChange={onPdfFile} style={{ display: "none" }} />

      <TopStatus
        status={status}
        role={role}
        classId={classId}
        busy={busy}
        notice={notice}
        error={error}
        theme={theme}
        onReconnect={reconnect}
        onClose={() => window.close()}
      />

      {canDraw ? (
        <>
          <LeftRail tool={tool} setTool={switchTool} theme={theme} onPickImage={() => imageInputRef.current?.click()} onPickPdf={() => pdfInputRef.current?.click()} />
          <RightRail
            tool={tool}
            hasSelection={selection.length > 0 && tool === "select"}
            theme={theme}
            toggleTheme={toggleTheme}
            color={color}
            setColor={onColor}
            fillColor={fillColor}
            setFillColor={onFillColor}
            width={width}
            setWidth={onWidth}
            fontSize={fontSize}
            setFontSize={onFont}
            sides={sides}
            setSides={setSides}
            star={star}
            setStar={setStar}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={doUndo}
            onRedo={doRedo}
            onDuplicate={duplicateSelection}
            onDelete={deleteSelection}
            onFront={() => restack(true)}
            onBack={() => restack(false)}
            snap={snap}
            setSnap={setSnap}
            grid={grid}
            setGrid={setGrid}
            zoomPct={Math.round(view.zoom * 100)}
            onZoomIn={() => zoomAt(size.w / 2, size.h / 2, 1.2)}
            onZoomOut={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.2)}
            onResetView={resetView}
            onClear={clearBoard}
            onExport={onExport}
            onEndSession={onEndSession}
            onHelp={() => setShowHelp((s) => !s)}
          />
        </>
      ) : (
        <div style={{ position: "fixed", bottom: 14, left: "50%", transform: "translateX(-50%)", color: theme.textDim, opacity: 0.7, fontSize: 13, zIndex: 30 }}>
          View only
        </div>
      )}

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

/** World-space center of an object (normalized) given its bbox + transform. */
function applyCenter(bbox: NonNullable<ReturnType<typeof opBBox>>, m: Mat): Pt {
  const c = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
  return { x: m[0] * c.x + m[2] * c.y + m[4], y: m[1] * c.x + m[3] * c.y + m[5] };
}

/* ── inline text / math editor ─────────────────────────────────────── */
function Editor({
  editing,
  size,
  view,
  color,
  fontSize,
  onChange,
  onCommit,
  onCancel,
}: {
  editing: Editing;
  size: Size;
  view: View;
  color: string;
  fontSize: number;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const left = view.tx + view.zoom * (editing.x * size.w);
  const top = view.ty + view.zoom * (editing.y * size.h);
  const isMath = editing.kind === "math";

  return (
    <div style={{ position: "absolute", left, top, display: "flex", flexDirection: "column", gap: 6, background: "rgba(17,22,42,0.96)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, padding: 8, boxShadow: "0 6px 22px rgba(0,0,0,0.5)", zIndex: 40 }}>
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
          style={{ minWidth: 220, minHeight: 48, fontFamily: "monospace", fontSize: 13, color: "#e6e9f2", background: "#0f1424", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: 6 }}
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
          style={{ minWidth: 200, fontSize, color, background: "#0f1424", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px" }}
        />
      )}
      {isMath && editing.value.trim() && (
        <div style={{ color, fontSize, background: "#11162a", padding: "4px 6px", borderRadius: 6 }} dangerouslySetInnerHTML={{ __html: katexHtml(editing.value) }} />
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={miniBtn}>Cancel</button>
        <button type="button" onClick={onCommit} style={{ ...miniBtn, background: "#5570ff", color: "#fff", borderColor: "#5570ff" }}>
          {isMath ? "Add (⌘↵)" : "Add (↵)"}
        </button>
      </div>
    </div>
  );
}

/* ── arc parameter dialog ──────────────────────────────────────────── */
function ArcDialog({
  size,
  view,
  center,
  onCommit,
  onCancel,
}: {
  size: Size;
  view: View;
  center: Pt;
  onCommit: (radiusPct: number, a0: number, a1: number) => void;
  onCancel: () => void;
}) {
  const [radius, setRadius] = useState(15);
  const [a0, setA0] = useState(0);
  const [a1, setA1] = useState(180);
  const left = Math.min(view.tx + view.zoom * (center.x * size.w), size.w - 220);
  const top = Math.min(view.ty + view.zoom * (center.y * size.h), size.h - 180);

  return (
    <div style={{ position: "absolute", left, top, display: "flex", flexDirection: "column", gap: 8, background: "rgba(17,22,42,0.97)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 10, padding: 12, boxShadow: "0 6px 22px rgba(0,0,0,0.5)", zIndex: 40, width: 200, color: "#c7cde0", fontSize: 13 }}>
      <strong style={{ fontSize: 13 }}>Arc</strong>
      <Field label={`Radius ${radius}%`}>
        <input type="range" min={2} max={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{ width: "100%" }} />
      </Field>
      <Field label={`Start ${a0}°`}>
        <input type="range" min={0} max={360} value={a0} onChange={(e) => setA0(Number(e.target.value))} style={{ width: "100%" }} />
      </Field>
      <Field label={`End ${a1}°`}>
        <input type="range" min={0} max={360} value={a1} onChange={(e) => setA1(Number(e.target.value))} style={{ width: "100%" }} />
      </Field>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={miniBtn}>Cancel</button>
        <button type="button" onClick={() => onCommit(radius, a0, a1)} style={{ ...miniBtn, background: "#5570ff", color: "#fff", borderColor: "#5570ff" }}>Add arc</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ opacity: 0.8 }}>{label}</span>
      {children}
    </label>
  );
}

/* ── help overlay ──────────────────────────────────────────────────── */
const SHORTCUTS: [string, string][] = [
  ["V", "Select / move"],
  ["P", "Pen"],
  ["E", "Eraser"],
  ["L / A", "Line / Arrow"],
  ["R / O", "Rect / Ellipse (Shift = square/circle)"],
  ["C / G / F", "Arc / Polygon / Frame"],
  ["X / M", "Text / Math"],
  ["Ctrl+Z / Y", "Undo / Redo"],
  ["Ctrl+D", "Duplicate"],
  ["Del", "Delete selection"],
  ["Arrows", "Nudge (Shift = ×10)"],
  ["[ / ]", "Send back / bring front"],
  ["Shift+drag handle", "Resize from corner (uniform)"],
];

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(7,10,22,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(17,22,42,0.98)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 14, padding: 22, minWidth: 340, color: "#e6e9f2", boxShadow: "0 10px 40px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <strong style={{ fontSize: 15 }}>Keyboard shortcuts</strong>
          <button type="button" onClick={onClose} style={miniBtn}>Close</button>
        </div>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={k}>
                <td style={{ padding: "3px 14px 3px 0", color: "#9fb0ff", fontFamily: "monospace", whiteSpace: "nowrap" }}>{k}</td>
                <td style={{ padding: "3px 0", opacity: 0.85 }}>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "transparent",
  color: "#c7cde0",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: BG, color: "#c7cde0", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      {children}
    </div>
  );
}

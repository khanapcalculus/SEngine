"use client";

/**
 * Selection overlay for the whiteboard — the rotated bounding box, the eight
 * resize handles, and the rotate knob drawn over a selected object, plus the
 * marquee rectangle for rubber-band selection.
 *
 * Geometry is exposed as pure helpers (singleHandles / rotateKnob) so page.tsx
 * can hit-test a pointer against the same pixel positions it renders — no
 * per-handle DOM event wiring, which keeps pointer-capture behaviour simple.
 *
 * Everything here is tagged `data-export-skip` so the PDF exporter strips it.
 */
import type { ReactNode } from "react";
import { apply, handlePoint, type Mat, type HandleKey } from "./transform";
import { HANDLE_KEYS } from "./transform";
import type { BBox, Size } from "./tools";

export interface HandlePx {
  key: HandleKey;
  x: number;
  y: number;
}

const px = (p: { x: number; y: number }, s: Size) => ({ x: p.x * s.w, y: p.y * s.h });

/** Pixel positions of the eight resize handles for a single selection. */
export function singleHandles(bbox: BBox, m: Mat, size: Size): HandlePx[] {
  return HANDLE_KEYS.map((key) => {
    const w = px(apply(m, handlePoint(bbox, key)), size);
    return { key, x: w.x, y: w.y };
  });
}

/** Pixel position of the rotate knob (above the top edge), or null if degenerate. */
export function rotateKnob(bbox: BBox, m: Mat, size: Size): { x: number; y: number } | null {
  const n = px(apply(m, handlePoint(bbox, "n")), size);
  const c = px(apply(m, { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }), size);
  const dx = n.x - c.x;
  const dy = n.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: n.x + (dx / len) * 26, y: n.y + (dy / len) * 26 };
}

/** The four transformed corners as an SVG polygon `points` string. */
export function selectionQuad(bbox: BBox, m: Mat, size: Size): string {
  const corners: { x: number; y: number }[] = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.w, y: bbox.y },
    { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
    { x: bbox.x, y: bbox.y + bbox.h },
  ];
  return corners.map((p) => px(apply(m, p), size)).map((p) => `${p.x},${p.y}`).join(" ");
}

const RESIZE_CURSOR: Record<HandleKey, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

const ACCENT = "#5570ff";

export function SelectionOverlay({
  single,
  multiRect,
  bbox,
  m,
  size,
}: {
  /** Single-object selection (rotated quad + handles); null for multi/none. */
  single: { bbox: BBox; m: Mat } | null;
  /** Axis-aligned union box for a multi-selection (px), or null. */
  multiRect: { x: number; y: number; w: number; h: number } | null;
  bbox: BBox | null;
  m: Mat | null;
  size: Size;
}): ReactNode {
  return (
    <g data-export-skip>
      {single && (
        <>
          <polygon
            points={selectionQuad(single.bbox, single.m, size)}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          {(() => {
            const knob = rotateKnob(single.bbox, single.m, size);
            const n = singleHandles(single.bbox, single.m, size).find((h) => h.key === "n");
            if (!knob || !n) return null;
            return (
              <>
                <line x1={n.x} y1={n.y} x2={knob.x} y2={knob.y} stroke={ACCENT} strokeWidth={1.5} />
                <circle data-handle="rotate" cx={knob.x} cy={knob.y} r={6} fill="#fff" stroke={ACCENT} strokeWidth={2} style={{ cursor: "grab" }} />
              </>
            );
          })()}
          {singleHandles(single.bbox, single.m, size).map((h) => (
            <rect
              key={h.key}
              data-handle={h.key}
              x={h.x - 5}
              y={h.y - 5}
              width={10}
              height={10}
              rx={2}
              fill="#fff"
              stroke={ACCENT}
              strokeWidth={2}
              style={{ cursor: RESIZE_CURSOR[h.key] }}
            />
          ))}
        </>
      )}

      {multiRect && (
        <rect
          x={multiRect.x}
          y={multiRect.y}
          width={multiRect.w}
          height={multiRect.h}
          fill="rgba(85,112,255,0.06)"
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}
    </g>
  );
}

/** The live rubber-band marquee rectangle (px). */
export function Marquee({ rect }: { rect: { x: number; y: number; w: number; h: number } }): ReactNode {
  return (
    <rect
      data-export-skip
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      fill="rgba(85,112,255,0.10)"
      stroke="#5570ff"
      strokeWidth={1}
      strokeDasharray="3 3"
    />
  );
}

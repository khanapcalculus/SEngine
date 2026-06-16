"use client";

/**
 * SVG rendering for whiteboard ops — one place that turns an opaque op into the
 * right vector element. Pulled out of page.tsx so the page stays focused on the
 * tool state machine and pointer handling. Also used to render the live drafts
 * (in-progress pen path / geometry shape) by passing a synthetic op.
 *
 * Each committed op may carry a `mutation` (the live transform + style + delete
 * layered on top of its immutable create, reduced from `modify` ops). We apply
 * the style override per-kind and wrap the node in the object's pixel-space
 * transform — so move / resize / rotate need no rewrite of the create payload.
 */
import type { ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { asStroke, buildSmoothPath, type Pt } from "./strokes";
import {
  asShape,
  asEquation,
  arcPoints,
  polygonPoints,
  FRAME_LABEL_PX,
} from "./tools";
import { asMat, isIdentity, toPixelMatrix, matrixToSvg } from "./transform";
import type { ObjMutation, ObjStyle } from "../../dashboard/whiteboard/connection";

interface Size {
  w: number;
  h: number;
}

/** Render LaTeX to an HTML string (KaTeX), tolerant of malformed input. */
export function katexHtml(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      strict: "ignore",
      displayMode: false,
    });
  } catch {
    return latex;
  }
}

const px = (p: Pt, s: Size) => ({ x: p.x * s.w, y: p.y * s.h });
const ptsToPx = (pts: Pt[], s: Size) => pts.map((p) => `${p.x * s.w},${p.y * s.h}`).join(" ");

/** Arrowhead polygon points (a small triangle at `end`, pointing along start→end). */
function arrowHead(start: Pt, end: Pt, size: Size, width: number): string {
  const a = px(start, size);
  const b = px(end, size);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.max(10, width * 3); // length of the head along the shaft
  const wing = head * 0.6; // half-width across
  const bx = b.x - ux * head;
  const by = b.y - uy * head;
  const p1 = `${bx - uy * wing},${by + ux * wing}`;
  const p2 = `${bx + uy * wing},${by - ux * wing}`;
  return `${b.x},${b.y} ${p1} ${p2}`;
}

/**
 * Render one op (or a synthetic draft op) to an SVG node. Returns null for ops
 * that can't be narrowed. `mutation` (optional) layers transform + style over a
 * committed object. The caller supplies the React `key`.
 */
export function renderOp(
  op: { type: string; payload?: unknown },
  size: Size,
  mutation?: ObjMutation,
): ReactNode {
  const node = renderNode(op, size, mutation?.style);
  if (node === null) return null;

  const m = mutation?.m ? asMat(mutation.m) : undefined;
  if (m && !isIdentity(m)) {
    return <g transform={matrixToSvg(toPixelMatrix(m, size.w, size.h))}>{node}</g>;
  }
  return node;
}

/** The un-transformed vector node, with any style override applied. */
function renderNode(
  op: { type: string; payload?: unknown },
  size: Size,
  style?: ObjStyle,
): ReactNode {
  if (op.type === "stroke") {
    const s = asStroke(op.payload);
    if (!s) return null;
    const color = style?.color ?? s.color;
    const width = style?.width ?? s.width;
    if (s.points.length === 1) {
      const a = px(s.points[0], size);
      return <circle cx={a.x} cy={a.y} r={width / 2} fill={color} />;
    }
    return (
      <path
        d={buildSmoothPath(s.points, size.w, size.h)}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  if (op.type === "shape") {
    const sh = asShape(op.payload);
    if (!sh) return null;
    const color = style?.color ?? ("color" in sh ? sh.color : "#fff");
    const width = style?.width ?? ("width" in sh ? sh.width : 2);
    const fill = style?.fill ?? ("fill" in sh ? sh.fill : false);
    // Explicit fill colour wins; else fall back to the stroke colour when filled.
    const fillPaint =
      (style?.fillColor ?? ("fillColor" in sh ? sh.fillColor : undefined)) ??
      (fill ? color : "none");

    switch (sh.kind) {
      case "line": {
        const a = px(sh.start, size);
        const b = px(sh.end, size);
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeLinecap="round" />;
      }
      case "arrow": {
        const a = px(sh.start, size);
        const b = px(sh.end, size);
        return (
          <g>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeLinecap="round" />
            <polygon points={arrowHead(sh.start, sh.end, size, width)} fill={color} />
          </g>
        );
      }
      case "rect": {
        const a = px(sh.start, size);
        const b = px(sh.end, size);
        return (
          <rect
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
            width={Math.abs(b.x - a.x)}
            height={Math.abs(b.y - a.y)}
            stroke={color}
            strokeWidth={width}
            fill={fillPaint}
          />
        );
      }
      case "ellipse": {
        const a = px(sh.start, size);
        const b = px(sh.end, size);
        return (
          <ellipse
            cx={(a.x + b.x) / 2}
            cy={(a.y + b.y) / 2}
            rx={Math.abs(b.x - a.x) / 2}
            ry={Math.abs(b.y - a.y) / 2}
            stroke={color}
            strokeWidth={width}
            fill={fillPaint}
          />
        );
      }
      case "arc":
        return (
          <polyline
            points={ptsToPx(arcPoints(sh, size), size)}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case "polygon":
        return (
          <polygon
            points={ptsToPx(polygonPoints(sh, size), size)}
            fill={fillPaint}
            stroke={color}
            strokeWidth={width}
            strokeLinejoin="round"
          />
        );
      case "frame": {
        const x = sh.x * size.w;
        const y = sh.y * size.h;
        const w = sh.w * size.w;
        const h = sh.h * size.h;
        const label = style?.color ?? sh.color;
        return (
          <g>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="rgba(255,255,255,0.015)"
              stroke={label}
              strokeWidth={1.5}
              strokeDasharray="6 5"
              rx={4}
            />
            <rect x={x} y={y - FRAME_LABEL_PX} width={Math.min(w, Math.max(60, sh.label.length * 8 + 16))} height={FRAME_LABEL_PX} fill={label} rx={4} />
            <text x={x + 8} y={y - FRAME_LABEL_PX / 2} fill="#0f1424" fontSize={12} fontWeight={700} dominantBaseline="central" style={{ userSelect: "none" }}>
              {sh.label}
            </text>
          </g>
        );
      }
      case "text":
        return (
          <text
            x={sh.x * size.w}
            y={sh.y * size.h}
            fill={style?.color ?? sh.color}
            fontSize={style?.fontSize ?? sh.fontSize}
            dominantBaseline="hanging"
            style={{ userSelect: "none" }}
          >
            {sh.text}
          </text>
        );
      case "image":
        return (
          <image
            href={sh.url}
            x={sh.x * size.w}
            y={sh.y * size.h}
            width={sh.w * size.w}
            height={sh.h * size.h}
            preserveAspectRatio="xMidYMid meet"
          />
        );
    }
  }

  if (op.type === "equation") {
    const e = asEquation(op.payload);
    if (!e) return null;
    const x = e.x * size.w;
    const y = e.y * size.h;
    const color = style?.color ?? e.color;
    const fontSize = style?.fontSize ?? e.fontSize;
    return (
      <foreignObject
        x={x}
        y={y}
        width={Math.max(60, (1 - e.x) * size.w)}
        height={Math.max(40, fontSize * 4)}
        style={{ overflow: "visible" }}
      >
        <div
          style={{ color, fontSize, width: "max-content", lineHeight: 1.2 }}
          dangerouslySetInnerHTML={{ __html: katexHtml(e.latex) }}
        />
      </foreignObject>
    );
  }

  return null;
}

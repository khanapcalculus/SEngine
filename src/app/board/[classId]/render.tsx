"use client";

/**
 * SVG rendering for whiteboard ops — one place that turns an opaque op into the
 * right vector element. Pulled out of page.tsx so the page stays focused on the
 * tool state machine and pointer handling. Also used to render the live drafts
 * (in-progress pen path / geometry shape) by passing a synthetic op.
 */
import type { ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { asStroke, buildSmoothPath, type Pt } from "./strokes";
import { asShape, asEquation } from "./tools";

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
  // Base point of the head, and two wing points perpendicular to the shaft.
  const bx = b.x - ux * head;
  const by = b.y - uy * head;
  const p1 = `${bx - uy * wing},${by + ux * wing}`;
  const p2 = `${bx + uy * wing},${by - ux * wing}`;
  return `${b.x},${b.y} ${p1} ${p2}`;
}

/**
 * Render one op (or a synthetic draft op) to an SVG node. Returns null for ops
 * that can't be narrowed. The caller supplies the React `key`.
 */
export function renderOp(
  op: { type: string; payload?: unknown },
  size: Size,
): ReactNode {
  if (op.type === "stroke") {
    const s = asStroke(op.payload);
    if (!s) return null;
    if (s.points.length === 1) {
      const a = px(s.points[0], size);
      return <circle cx={a.x} cy={a.y} r={s.width / 2} fill={s.color} />;
    }
    return (
      <path
        d={buildSmoothPath(s.points, size.w, size.h)}
        fill="none"
        stroke={s.color}
        strokeWidth={s.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  if (op.type === "shape") {
    const sh = asShape(op.payload);
    if (!sh) return null;
    switch (sh.kind) {
      case "line": {
        const a = px(sh.start, size);
        const b = px(sh.end, size);
        return (
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={sh.color}
            strokeWidth={sh.width}
            strokeLinecap="round"
          />
        );
      }
      case "arrow": {
        const a = px(sh.start, size);
        const b = px(sh.end, size);
        return (
          <g>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={sh.color}
              strokeWidth={sh.width}
              strokeLinecap="round"
            />
            <polygon points={arrowHead(sh.start, sh.end, size, sh.width)} fill={sh.color} />
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
            stroke={sh.color}
            strokeWidth={sh.width}
            fill={sh.fill ? sh.color : "none"}
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
            stroke={sh.color}
            strokeWidth={sh.width}
            fill={sh.fill ? sh.color : "none"}
          />
        );
      }
      case "text":
        return (
          <text
            x={sh.x * size.w}
            y={sh.y * size.h}
            fill={sh.color}
            fontSize={sh.fontSize}
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
    return (
      <foreignObject
        x={x}
        y={y}
        width={Math.max(60, (1 - e.x) * size.w)}
        height={Math.max(40, e.fontSize * 4)}
        style={{ overflow: "visible" }}
      >
        <div
          style={{
            color: e.color,
            fontSize: e.fontSize,
            width: "max-content",
            lineHeight: 1.2,
          }}
          dangerouslySetInnerHTML={{ __html: katexHtml(e.latex) }}
        />
      </foreignObject>
    );
  }

  return null;
}

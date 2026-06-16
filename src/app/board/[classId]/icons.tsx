"use client";

/**
 * Whiteboard icon set — crisp, hand-tuned 24×24 stroke icons.
 *
 * Replaces the emoji/unicode glyphs the rails used to render (which were
 * inconsistent across platforms and looked low-quality). These are inline SVGs
 * so there's no dependency to install, they inherit `currentColor` from the
 * button (so they theme + dim for free), and they stay pixel-crisp at any zoom.
 *
 * All icons share one geometry contract: a 24×24 viewBox, 1.8px round-joined
 * strokes, no fills (unless semantically required), so the whole set reads as a
 * single coherent family.
 */
import type { CSSProperties } from "react";

export type IconName =
  // tools
  | "select"
  | "pan"
  | "pen"
  | "erase"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "arc"
  | "polygon"
  | "frame"
  | "text"
  | "math"
  | "image"
  | "pdf"
  // actions
  | "undo"
  | "redo"
  | "duplicate"
  | "trash"
  | "front"
  | "back"
  | "plus"
  | "minus"
  | "snap"
  | "grid"
  | "sun"
  | "moon"
  | "download"
  | "clear"
  | "help"
  | "close"
  | "reconnect"
  | "calendar"
  | "board"
  | "endsession";

/** SVG inner geometry for each icon (drawn with currentColor strokes). */
const PATHS: Record<IconName, React.ReactNode> = {
  select: <path d="M5 3l6 16 2.2-6.4L19.6 11 5 3z" />,
  pan: (
    <path d="M9 11V5.5a1.5 1.5 0 013 0V10m0 0V4.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V15c0 3-2 5.5-5.5 5.5h-1C11 20.5 9 19 8 16.5L6.2 12a1.4 1.4 0 012.5-1.2L9 11z" />
  ),
  pen: (
    <>
      <path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  erase: (
    <>
      <path d="M4 16.5l6.5 6.5h5l5.5-5.5-9-9L4 12.5a2 2 0 000 4z" />
      <path d="M9 21l-4-4" />
    </>
  ),
  line: <path d="M5 19L19 5" />,
  arrow: (
    <>
      <path d="M5 19L19 5" />
      <path d="M11 5h8v8" />
    </>
  ),
  rect: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  arc: <path d="M4 18A12 12 0 0120 18" />,
  polygon: <path d="M12 3l8.5 6.2-3.2 10H6.7l-3.2-10L12 3z" />,
  frame: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="1" />
      <path d="M4.5 9h15M4.5 15h15M9 4.5v15M15 4.5v15" opacity="0.5" />
    </>
  ),
  text: <path d="M5 6h14M12 6v13M9 19h6" />,
  math: <path d="M6 5h11l-6.5 7L17 19H6l5-7-5-7z" />,
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="M4 17l4.5-4.5 3.5 3 3-3L20.5 16" />
    </>
  ),
  pdf: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 13h1.5a1.3 1.3 0 010 2.6H9V13zm0 4.5V13" opacity="0.9" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7L4 12l5 5" />
      <path d="M4 12h10a6 6 0 016 6v1" />
    </>
  ),
  redo: (
    <>
      <path d="M15 7l5 5-5 5" />
      <path d="M20 12H10a6 6 0 00-6 6v1" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M5.5 15.5H5a1.5 1.5 0 01-1.5-1.5V5A1.5 1.5 0 015 3.5h9A1.5 1.5 0 0115.5 5v.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" opacity="0.7" />
    </>
  ),
  front: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" opacity="0.9" />
      <path d="M12 2.5l5 3-5 3-5-3 5-3z" />
    </>
  ),
  back: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" opacity="0.5" />
      <path d="M12 21.5l5-3-5-3-5 3 5 3z" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  snap: (
    <>
      <path d="M4 9h16M4 15h16M9 4v16M15 4v16" opacity="0.45" />
      <path d="M9 9h6v6H9z" fill="currentColor" stroke="none" />
    </>
  ),
  grid: <path d="M4 9h16M4 15h16M9 4v16M15 4v16" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 119.5 4 6.5 6.5 0 0020 14.5z" />,
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  clear: <path d="M6 6l12 12M18 6L6 18" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2a2.8 2.8 0 015.5.8c0 1.9-2.7 2.3-2.7 4" />
      <circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  reconnect: (
    <>
      <path d="M20 11A8 8 0 006 6.2L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0014 4.8L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4M16 3v4" />
      <circle cx="8" cy="13.5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13.5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="16" cy="13.5" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="4" width="17" height="12" rx="1.5" />
      <path d="M7 9.5c2-2.5 4-2.5 5 0s3 2.5 5 0" />
      <path d="M12 16v3M9 21l3-2 3 2" />
    </>
  ),
  endsession: (
    <>
      <path d="M12 3v8" />
      <path d="M7.5 6.5a7 7 0 109 0" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Pixel box; defaults to 18 to sit comfortably in a 32×28 rail button. */
  size?: number;
  /** Stroke weight; defaults to 1.8 for the shared family look. */
  strokeWidth?: number;
  style?: CSSProperties;
}

/** Render a whiteboard icon. Strokes inherit the button's `color`. */
export function Icon({ name, size = 18, strokeWidth = 1.8, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      style={{ display: "block", ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}

"use client";

/**
 * Whiteboard theme — dark (default) and light palettes, plus the colour and
 * stroke-size choices the toolbar offers. Centralised here so the canvas
 * background, eraser/clear fill, rails, overlays, and default pen colour all
 * stay consistent and switch together.
 *
 * The chosen theme is persisted in localStorage so a teacher's preference sticks
 * across pop-out sessions. Pure data + a tiny load/save helper; no React.
 */

export type ThemeName = "dark" | "light";

export interface Theme {
  name: ThemeName;
  /** Canvas background; the eraser/clear paints with this. */
  bg: string;
  /** Default pen/stroke colour for a fresh board on this theme. */
  ink: string;
  /** Rail / panel surface. */
  panel: string;
  panelBorder: string;
  text: string;
  textDim: string;
  accent: string;
  /** A translucent tint of the accent, for the active-tool glow. */
  accentGlow: string;
  /** Legacy single grid colour (kept for back-compat / dot fallbacks). */
  grid: string;
  /** Fine grid lines (every cell). */
  gridMinor: string;
  /** Bold grid lines (every 5th cell). */
  gridMajor: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    name: "dark",
    bg: "#0f1424",
    ink: "#e6e9f2",
    // More translucent so the saturated backdrop-filter reads as real glass.
    panel: "rgba(20,26,48,0.62)",
    panelBorder: "rgba(255,255,255,0.16)",
    text: "#e6e9f2",
    textDim: "#c7cde0",
    accent: "#5570ff",
    accentGlow: "rgba(85,112,255,0.35)",
    grid: "rgba(255,255,255,0.08)",
    gridMinor: "rgba(255,255,255,0.05)",
    gridMajor: "rgba(255,255,255,0.11)",
  },
  light: {
    name: "light",
    bg: "#f7f8fc",
    ink: "#1d2333",
    panel: "rgba(255,255,255,0.62)",
    panelBorder: "rgba(20,28,60,0.16)",
    text: "#1d2333",
    textDim: "#4a5270",
    accent: "#3a55ff",
    accentGlow: "rgba(58,85,255,0.22)",
    grid: "rgba(20,28,60,0.10)",
    gridMinor: "rgba(20,28,60,0.06)",
    gridMajor: "rgba(20,28,60,0.13)",
  },
};

/**
 * Stroke / fill colour swatches — a curated 24-colour set (a tuned Tailwind-style
 * spectrum + a full grey ramp) that stays vivid and legible on both the dark and
 * light backgrounds. Laid out as 6 columns × 4 rows in the picker.
 */
export const COLOR_SWATCHES: string[] = [
  // warm → cool spectrum
  "#ef4444", "#f43f5e", "#ec4899", "#f97316", "#f59e0b", "#eab308",
  "#facc15", "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4",
  "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  // neutrals: brown + grey ramp to black/white
  "#92400e", "#000000", "#475569", "#94a3b8", "#cbd5e1", "#ffffff",
];

/** 12 stroke widths from 1..20, including 1,2,3,4,5. */
export const STROKE_SIZES: number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 17, 20];

const STORE_KEY = "sengine.board.theme";

export function loadTheme(): ThemeName {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(name: ThemeName): void {
  try {
    localStorage.setItem(STORE_KEY, name);
  } catch {
    /* private mode / blocked storage — non-fatal */
  }
}

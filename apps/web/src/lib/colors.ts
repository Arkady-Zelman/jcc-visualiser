/**
 * Stable per-grade color palette.
 *
 * Why explicit hex instead of CSS variables?
 *   - shadcn's --chart-1..--chart-5 is only 5 colors; we have ~11 majors + ~40
 *     unmapped buckets = 50 distinct slots.
 *   - We want family colors that make the chart readable at a glance (all Arab
 *     grades blue, all UAE grades orange, Russia red, US green, etc.).
 *
 * Anything not in EXPLICIT_GRADE_COLORS falls back to a deterministic palette
 * keyed by the slug — so `unmapped_ID` and `unmapped_AU` always render the
 * same color across page loads.
 */

import type { Region } from "./composition";

const EXPLICIT_GRADE_COLORS: Record<string, string> = {
  // UAE — orange family
  murban: "#f97316",
  das: "#fb923c",
  upper_zakum: "#fdba74",
  // Saudi Arabia — blue family
  arab_extra_light: "#60a5fa",
  arab_light: "#3b82f6",
  arab_medium: "#2563eb",
  arab_heavy: "#1d4ed8",
  // Oman / Dubai — teal
  oman: "#14b8a6",
  dubai: "#5eead4",
  // Russia — red
  espo: "#ef4444",
  // US — green
  wti: "#22c55e",
};

const FALLBACK_PALETTE = [
  "#94a3b8", // slate-400
  "#a78bfa", // violet
  "#ec4899", // pink
  "#f59e0b", // amber
  "#84cc16", // lime
  "#06b6d4", // cyan
  "#d946ef", // fuchsia
  "#fb7185", // rose
  "#6366f1", // indigo
  "#a3e635", // green-lime
  "#fbbf24", // amber-light
  "#0ea5e9", // sky
];

/**
 * Stable hash for a slug into a palette index. The same gradeId always yields
 * the same color across renders / page loads.
 */
function stableIndex(slug: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return h % modulo;
}

export function gradeColor(gradeId: string): string {
  return (
    EXPLICIT_GRADE_COLORS[gradeId] ??
    FALLBACK_PALETTE[stableIndex(gradeId, FALLBACK_PALETTE.length)]
  );
}

/**
 * Region-level palette for the "by region" view mode. Mirrors the grade-family
 * choices so the eye picks up continuity when toggling.
 */
export const REGION_COLORS: Record<Region | "other", string> = {
  middle_east: "#3b82f6", // blue (Saudi/UAE/Oman/Dubai average)
  russia: "#ef4444",
  americas: "#22c55e",
  africa: "#f59e0b",
  asia_pacific: "#a78bfa",
  europe: "#06b6d4",
  other: "#94a3b8",
};

/**
 * Origin-country palette — also deterministic, but every origin gets a slot
 * via stableIndex (no per-country explicit color in v1).
 */
export function originColor(countryCode: string): string {
  return FALLBACK_PALETTE[stableIndex(countryCode, FALLBACK_PALETTE.length)];
}

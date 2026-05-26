/**
 * Server-side helpers for the /composition view.
 *
 * Pivots `composition_monthly` rows from long format (one row per (month, grade))
 * to a wide format Recharts can consume natively (one row per month, one column
 * per series — grade / origin / region depending on view mode).
 *
 * Everything here is pure — no DB access, no React. Called from the
 * `apps/web/src/app/composition/page.tsx` Server Component to shape data once,
 * then passed to the Client Component chart wrapper.
 */

import type { Database } from "@/types/db";

export type CompositionRow = Database["public"]["Tables"]["composition_monthly"]["Row"];
export type GradeRow = Database["public"]["Tables"]["grades"]["Row"];
export type EventRow = Database["public"]["Tables"]["events"]["Row"];

export type Region =
  | "middle_east"
  | "russia"
  | "americas"
  | "africa"
  | "asia_pacific"
  | "europe"
  | "other";

export type ViewMode = "grade" | "origin" | "region";

export interface PivotedRow {
  /** ISO month, e.g. "2026-03-01". */
  month: string;
  /** Each column is one series in the chosen view mode. Values are share % (0–100). */
  [seriesKey: string]: number | string;
}

export interface PivotResult {
  rows: PivotedRow[];
  /** All series keys present in `rows`, sorted by total share desc (so the legend reads naturally). */
  seriesKeys: string[];
  /** Display name lookup for legends / tooltips. */
  displayNames: Record<string, string>;
}

/**
 * Best-effort map from ISO country code → region for the "by region" view.
 * Covers the major crude-origin countries; everything else falls into "other".
 */
const COUNTRY_REGION: Record<string, Region> = {
  // Middle East
  SA: "middle_east", AE: "middle_east", IQ: "middle_east", IR: "middle_east",
  KW: "middle_east", QA: "middle_east", OM: "middle_east", BH: "middle_east",
  YE: "middle_east", SY: "middle_east", JO: "middle_east", LB: "middle_east",
  IL: "middle_east", PS: "middle_east",
  // Russia / former Soviet
  RU: "russia", KZ: "russia", AZ: "russia", UZ: "russia", TM: "russia",
  // Americas
  US: "americas", CA: "americas", MX: "americas", BR: "americas", VE: "americas",
  CO: "americas", EC: "americas", AR: "americas", PE: "americas", CL: "americas",
  GY: "americas", SR: "americas",
  // Africa
  NG: "africa", AO: "africa", LY: "africa", DZ: "africa", EG: "africa",
  GA: "africa", CG: "africa", CD: "africa", GQ: "africa", SD: "africa",
  TD: "africa", CM: "africa", MR: "africa", TN: "africa", GH: "africa",
  CI: "africa", ZA: "africa",
  // Asia / Pacific
  CN: "asia_pacific", ID: "asia_pacific", MY: "asia_pacific", VN: "asia_pacific",
  TH: "asia_pacific", PH: "asia_pacific", BN: "asia_pacific", IN: "asia_pacific",
  PK: "asia_pacific", AU: "asia_pacific", NZ: "asia_pacific", PG: "asia_pacific",
  TL: "asia_pacific", MM: "asia_pacific",
  // Europe
  NO: "europe", GB: "europe", DK: "europe", NL: "europe", DE: "europe",
  IT: "europe", FR: "europe", ES: "europe", RO: "europe",
};

export function countryToRegion(countryCode: string | null | undefined): Region {
  if (!countryCode) return "other";
  return COUNTRY_REGION[countryCode] ?? "other";
}

/**
 * Pivot composition rows into wide-format chart data.
 *
 * Series-key conventions per view mode:
 *   - grade:  `<gradeId>`  (e.g. "murban", "unmapped_IR")
 *   - origin: `<countryCode>` (e.g. "SA", "AE", "RU")
 *   - region: one of REGION values (e.g. "middle_east")
 *
 * `share_pct` values are renormalised within each month after grouping so they
 * still sum to ~100 (avoids drift from the upstream % rounding).
 */
export function pivotToChart(
  composition: CompositionRow[],
  grades: GradeRow[],
  viewMode: ViewMode,
): PivotResult {
  const gradesById = new Map(grades.map((g) => [g.id, g] as const));

  const seriesKeyForRow = (row: CompositionRow): string => {
    if (viewMode === "grade") return row.grade_id;
    if (viewMode === "origin") {
      const grade = gradesById.get(row.grade_id);
      return grade?.origin_country ?? "unknown";
    }
    // viewMode === "region"
    const grade = gradesById.get(row.grade_id);
    if (!grade) return "other";
    // For real grades, use grades.region directly. For synthetic unmapped_<origin>
    // grades, region is 'other' in the DB — we recompute via country lookup so
    // unmapped_IR lands in middle_east, unmapped_AU in asia_pacific, etc.
    if (grade.id.startsWith("unmapped_")) {
      return countryToRegion(grade.origin_country);
    }
    return (grade.region as Region) ?? "other";
  };

  const displayNameForRow = (row: CompositionRow): string => {
    if (viewMode === "grade") {
      return gradesById.get(row.grade_id)?.display_name ?? row.grade_id;
    }
    if (viewMode === "origin") {
      return gradesById.get(row.grade_id)?.origin_country ?? "unknown";
    }
    return seriesKeyForRow(row);
  };

  // month -> seriesKey -> aggregated share
  const byMonth = new Map<string, Map<string, number>>();
  // Track display names (last write wins; same key always maps to same name).
  const displayNames: Record<string, string> = {};
  // Track total share per series so we can sort the legend.
  const seriesTotals = new Map<string, number>();

  for (const row of composition) {
    const key = seriesKeyForRow(row);
    displayNames[key] ??= displayNameForRow(row);
    seriesTotals.set(key, (seriesTotals.get(key) ?? 0) + Number(row.share_pct));
    let monthMap = byMonth.get(row.month);
    if (!monthMap) {
      monthMap = new Map();
      byMonth.set(row.month, monthMap);
    }
    monthMap.set(key, (monthMap.get(key) ?? 0) + Number(row.share_pct));
  }

  const months = Array.from(byMonth.keys()).sort();
  const seriesKeys = Array.from(seriesTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const rows: PivotedRow[] = months.map((month) => {
    const monthMap = byMonth.get(month)!;
    const monthTotal =
      Array.from(monthMap.values()).reduce((s, v) => s + v, 0) || 1;
    const out: PivotedRow = { month };
    for (const key of seriesKeys) {
      // Renormalise to 100 per month so the stack always sums to 100.
      out[key] = ((monthMap.get(key) ?? 0) / monthTotal) * 100;
    }
    return out;
  });

  return { rows, seriesKeys, displayNames };
}

/**
 * Treemap data for a single scrubbed month — flat list of `{ name, size, fill }`.
 * Drops zero-share entries to keep the treemap tidy.
 */
export interface TreemapDatum {
  name: string;
  displayName: string;
  size: number;
}

export function snapshotForMonth(
  pivoted: PivotResult,
  monthIndex: number,
): TreemapDatum[] {
  const row = pivoted.rows[monthIndex];
  if (!row) return [];
  return pivoted.seriesKeys
    .map((key) => ({
      name: key,
      displayName: pivoted.displayNames[key] ?? key,
      size: Number(row[key]) || 0,
    }))
    .filter((d) => d.size > 0.001)
    .sort((a, b) => b.size - a.size);
}

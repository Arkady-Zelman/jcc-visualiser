/**
 * Server-side helpers for the "Physical flows" section on /composition —
 * total import volume (Japan Customs) and oil stockpiles (PAJ 05E / METI).
 *
 * Pure functions, no DB access — mirrors the lib/composition.ts pattern.
 */

import type { Database } from "@/types/db";

export type StockpileRow = Database["public"]["Tables"]["oil_stockpile_monthly"]["Row"];

export interface ImportVolumeRow {
  /** ISO month, e.g. "2026-04-01". */
  month: string;
  /** Total crude volume clearing customs that month, kl. */
  volumeKl: number;
}

/** Sum per-origin customs rows into one total-volume row per month. */
export function totalImportsByMonth(
  rows: { month: string; volume_kl: number }[],
): ImportVolumeRow[] {
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + Number(r.volume_kl));
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, volumeKl]) => ({ month, volumeKl }));
}

export interface StockpileChartRow {
  /** ISO month. */
  month: string;
  /** Stock levels at month end, kl (crude only — product stocks excluded). */
  privateKl: number | null;
  governmentKl: number | null;
  /** Month-over-month change, kl. Negative = withdrawal. Null on the first month. */
  privateDeltaKl: number | null;
  governmentDeltaKl: number | null;
  /** Government days-of-supply as published (for tooltips). */
  governmentDays: number | null;
}

/** Shape stockpile rows for the chart: levels + month-over-month deltas. */
export function stockpileSeries(rows: StockpileRow[]): StockpileChartRow[] {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  return sorted.map((r, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const delta = (
      curr: number | null,
      prior: number | null | undefined,
    ): number | null =>
      curr != null && prior != null ? curr - prior : null;
    return {
      month: r.month,
      privateKl: r.private_crude_kl,
      governmentKl: r.government_crude_kl,
      privateDeltaKl: delta(r.private_crude_kl, prev?.private_crude_kl),
      governmentDeltaKl: delta(r.government_crude_kl, prev?.government_crude_kl),
      governmentDays: r.government_days,
    };
  });
}

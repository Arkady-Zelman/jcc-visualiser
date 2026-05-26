/**
 * Server-side helpers for the /curve view.
 *
 * Aligns daily benchmark series with the monthly JCC index so we can run an
 * OLS regression of `JCC_usd_bbl ~ a·Brent_monthly_avg + b·WTI_monthly_avg + c`.
 *
 * All functions are pure — no DB access. Called from the Server Component
 * `apps/web/src/app/curve/page.tsx`.
 */

import type { Database } from "@/types/db";

export type JccRow = Database["public"]["Tables"]["jcc_monthly"]["Row"];
export type BenchmarkPriceRow = Database["public"]["Tables"]["benchmark_prices_daily"]["Row"];

/**
 * Group daily prices by first-of-month, return the arithmetic mean per month.
 * Returns a map ISO date ("2026-03-01") -> average price.
 */
export function monthlyAverages(daily: BenchmarkPriceRow[]): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const row of daily) {
    // row.date is "YYYY-MM-DD" — slice to "YYYY-MM-01" to bucket by month.
    const monthKey = row.date.slice(0, 7) + "-01";
    const price = Number(row.price_usd_bbl);
    if (!Number.isFinite(price) || price <= 0) continue;
    const bucket = sums.get(monthKey);
    if (bucket) {
      bucket.sum += price;
      bucket.n += 1;
    } else {
      sums.set(monthKey, { sum: price, n: 1 });
    }
  }
  const out = new Map<string, number>();
  for (const [k, { sum, n }] of sums) out.set(k, sum / n);
  return out;
}

export interface AlignedRow {
  month: string;
  jccUsd: number;
  jccJpy: number;
  brent: number;
  wti: number;
}

/**
 * Default structural lag: JCC for month M reflects cargoes that loaded ~2 months earlier.
 * Confirmed empirically (2025-10 JCC=$74 ≈ Brent[2025-07]=$71; 2026-03 JCC=$68.73 ≈
 * Brent[2026-01]=$66.60, with current-month Brent spiking to $103 because of Hormuz).
 */
export const LAG_MONTHS = 2;

/**
 * Add `n` months (negative = subtract) to an ISO-date "YYYY-MM-01" string.
 */
export function addMonths(isoMonth: string, n: number): string {
  const [y, m] = isoMonth.split("-").map((s) => parseInt(s, 10));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny.toString().padStart(4, "0")}-${nm.toString().padStart(2, "0")}-01`;
}

/**
 * Join monthly JCC values at month M with monthly Brent + WTI averages at M-lagMonths.
 * Drops months missing any of the three series.
 */
export function alignSeries(
  jcc: JccRow[],
  brentMonthly: Map<string, number>,
  wtiMonthly: Map<string, number>,
  lagMonths: number = LAG_MONTHS,
): AlignedRow[] {
  const out: AlignedRow[] = [];
  for (const row of jcc) {
    if (row.jcc_value_usd_per_bbl == null) continue;
    const benchmarkMonth = addMonths(row.month, -lagMonths);
    const brent = brentMonthly.get(benchmarkMonth);
    const wti = wtiMonthly.get(benchmarkMonth);
    if (brent == null || wti == null) continue;
    out.push({
      month: row.month,
      jccUsd: Number(row.jcc_value_usd_per_bbl),
      jccJpy: Number(row.jcc_value_jpy_per_kl),
      brent,
      wti,
    });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Return the average of the last N daily entries (sorted ascending by date).
 * Used to compute a less-noisy "current" Brent/WTI for the implied forecast.
 */
export function lastNDayAverage(rows: BenchmarkPriceRow[], n: number): number | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const tail = sorted.slice(-n);
  const valid = tail
    .map((r) => Number(r.price_usd_bbl))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/**
 * Average daily values whose date falls inside one calendar month.
 * Returns null if the month has no observations.
 */
export function monthAverage(rows: BenchmarkPriceRow[], isoMonth: string): number | null {
  const prefix = isoMonth.slice(0, 7); // "YYYY-MM"
  const inMonth = rows.filter((r) => r.date.startsWith(prefix));
  if (inMonth.length === 0) return null;
  const valid = inMonth
    .map((r) => Number(r.price_usd_bbl))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

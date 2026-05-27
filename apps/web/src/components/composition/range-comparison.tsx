"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import type { CompositionDelta, PivotResult, ViewMode } from "@/lib/composition";
import { compositionDelta } from "@/lib/composition";
import type { AlignedRow } from "@/lib/curve";
import { gradeColor, originColor, REGION_COLORS } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface Props {
  pivoted: PivotResult;
  startIdx: number;
  endIdx: number;
  viewMode: ViewMode;
  aligned: AlignedRow[];
}

function colorFor(key: string, viewMode: ViewMode): string {
  if (viewMode === "grade") return gradeColor(key);
  if (viewMode === "origin") return originColor(key);
  return REGION_COLORS[key as keyof typeof REGION_COLORS] ?? REGION_COLORS.other;
}

function monthLabel(iso: string | undefined): string {
  return iso ? iso.slice(0, 7) : "—";
}

function pct(n: number, digits = 1): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

function deltaRowAccent(d: CompositionDelta): string {
  if (d.status === "new") return "border-l-emerald-500";
  if (d.status === "removed") return "border-l-rose-500";
  return d.deltaPp > 0 ? "border-l-emerald-400/60" : "border-l-rose-400/60";
}

export function RangeComparison({ pivoted, startIdx, endIdx, viewMode, aligned }: Props) {
  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);
  const startMonth = pivoted.rows[lo]?.month as string | undefined;
  const endMonth = pivoted.rows[hi]?.month as string | undefined;

  const deltas = useMemo(
    () => compositionDelta(pivoted, lo, hi),
    [pivoted, lo, hi],
  );

  // JCC price at start / end (matched by month in aligned rows).
  const startJcc = startMonth ? aligned.find((r) => r.month === startMonth) : undefined;
  const endJcc = endMonth ? aligned.find((r) => r.month === endMonth) : undefined;

  const jccUsdDelta =
    startJcc && endJcc ? endJcc.jccUsd - startJcc.jccUsd : null;
  const jccUsdPct =
    startJcc && endJcc && startJcc.jccUsd > 0
      ? ((endJcc.jccUsd - startJcc.jccUsd) / startJcc.jccUsd) * 100
      : null;
  const jccJpyDelta =
    startJcc && endJcc ? endJcc.jccJpy - startJcc.jccJpy : null;

  const newGrades = deltas.filter((d) => d.status === "new");
  const removedGrades = deltas.filter((d) => d.status === "removed");
  const changed = deltas.filter((d) => d.status === "changed").slice(0, 10);

  if (startIdx === endIdx || !startMonth || !endMonth) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Drag the brush below the basket chart to pick a date range.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Range header */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Comparing</span>{" "}
          <span className="font-mono text-zinc-950 dark:text-zinc-50">
            {monthLabel(startMonth)}
          </span>{" "}
          <span className="text-zinc-500 dark:text-zinc-400">to</span>{" "}
          <span className="font-mono text-zinc-950 dark:text-zinc-50">
            {monthLabel(endMonth)}
          </span>
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          {hi - lo} months
        </p>
      </div>

      {/* JCC price change */}
      {startJcc && endJcc && jccUsdPct != null && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            JCC price change
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {pct(jccUsdPct)}
            </p>
            <p className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
              ${startJcc.jccUsd.toFixed(2)} → ${endJcc.jccUsd.toFixed(2)} /bbl
            </p>
          </div>
          {jccJpyDelta != null && (
            <p className="mt-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              ¥{Math.round(startJcc.jccJpy).toLocaleString()} → ¥
              {Math.round(endJcc.jccJpy).toLocaleString()} /kl
              {" "}({jccJpyDelta >= 0 ? "+" : "−"}¥
              {Math.abs(Math.round(jccJpyDelta)).toLocaleString()})
            </p>
          )}
        </div>
      )}

      {/* New / removed grades */}
      {(newGrades.length > 0 || removedGrades.length > 0) && (
        <div className="space-y-2">
          {newGrades.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-500/90">
                Appeared in this period ({newGrades.length})
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {newGrades.map((d) => (
                  <li key={d.key}>
                    <Badge
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-300"
                    >
                      <span
                        aria-hidden
                        className="mr-1.5 inline-block size-1.5 rounded-full"
                        style={{ backgroundColor: colorFor(d.key, viewMode) }}
                      />
                      {d.displayName} · {d.endShare.toFixed(1)}%
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {removedGrades.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-rose-500/90">
                Dropped out of basket ({removedGrades.length})
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {removedGrades.map((d) => (
                  <li key={d.key}>
                    <Badge
                      variant="outline"
                      className="border-rose-500/30 bg-rose-500/5 text-xs text-rose-300"
                    >
                      <span
                        aria-hidden
                        className="mr-1.5 inline-block size-1.5 rounded-full"
                        style={{ backgroundColor: colorFor(d.key, viewMode) }}
                      />
                      {d.displayName} · was {d.startShare.toFixed(1)}%
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Composition changes — biggest movers */}
      {changed.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Biggest share movers
          </p>
          <ul className="mt-2 space-y-1.5">
            {changed.map((d) => (
              <li
                key={d.key}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border-l-2 bg-white/[0.02] px-3 py-1.5 text-sm",
                  deltaRowAccent(d),
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    aria-hidden
                    className="inline-block size-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: colorFor(d.key, viewMode) }}
                  />
                  <span className="truncate text-zinc-200">{d.displayName}</span>
                </div>
                <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <span className="text-xs text-zinc-500">
                    {d.startShare.toFixed(1)}% → {d.endShare.toFixed(1)}%
                  </span>
                  <span
                    className={cn(
                      "font-mono text-xs",
                      d.deltaPp >= 0 ? "text-emerald-400" : "text-rose-400",
                    )}
                  >
                    {d.deltaPp >= 0 ? "+" : "−"}
                    {Math.abs(d.deltaPp).toFixed(1)} pp
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        Per-grade price changes aren&apos;t shown in v1 — only WTI and Brent
        have daily series ingested. Dubai / Oman / Murban / Arab grades / ESPO
        require paid feeds. The JCC price change above is the aggregate the
        basket actually settled at.
      </p>
    </div>
  );
}

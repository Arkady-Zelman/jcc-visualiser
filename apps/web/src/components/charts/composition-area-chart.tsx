"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Label,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { gradeColor, originColor, REGION_COLORS } from "@/lib/colors";
import type { PivotedRow, ViewMode } from "@/lib/composition";

interface Props {
  data: PivotedRow[];
  seriesKeys: string[];
  displayNames: Record<string, string>;
  /** ISO date like "2018-05-01" — drawn as a vertical reference line if it matches a row. */
  referenceMonth?: string | null;
  /** Label rendered next to the reference line. */
  referenceLabel?: string | null;
  viewMode: ViewMode;
}

const TICK_STYLE = { fontSize: 11, fill: "currentColor" };

function colorFor(key: string, viewMode: ViewMode): string {
  if (viewMode === "grade") return gradeColor(key);
  if (viewMode === "origin") return originColor(key);
  return REGION_COLORS[key as keyof typeof REGION_COLORS] ?? REGION_COLORS.other;
}

export function CompositionAreaChart({
  data,
  seriesKeys,
  displayNames,
  referenceMonth,
  referenceLabel,
  viewMode,
}: Props) {
  // Tick formatter: show every Jan as a major tick.
  const monthTickFormatter = (m: string) => (m.endsWith("-01-01") ? m.slice(0, 4) : "");

  // Find the actual row whose month matches referenceMonth (Recharts ReferenceLine
  // needs the actual x-axis value to render — for category axes that means
  // string-identity).
  const referenceX = useMemo(() => {
    if (!referenceMonth) return undefined;
    return data.find((r) => r.month === referenceMonth || r.month.slice(0, 7) === referenceMonth.slice(0, 7))?.month;
  }, [data, referenceMonth]);

  return (
    <div className="text-zinc-700 dark:text-zinc-300">
      <ResponsiveContainer width="100%" height={420}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={monthTickFormatter}
            tick={TICK_STYLE}
            interval={0}
            minTickGap={20}
          />
          <YAxis
            tickFormatter={(v) => `${Math.round(v)}%`}
            domain={[0, 100]}
            tick={TICK_STYLE}
            tickCount={6}
            width={42}
          />
          <Tooltip content={<ChartTooltip displayNames={displayNames} />} />
          {seriesKeys.map((k) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              stackId="1"
              stroke={colorFor(k, viewMode)}
              fill={colorFor(k, viewMode)}
              fillOpacity={0.85}
              strokeWidth={0}
              isAnimationActive={false}
            />
          ))}
          {referenceX && (
            <ReferenceLine
              x={referenceX}
              stroke="#dc2626"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            >
              {referenceLabel ? (
                <Label
                  value={referenceLabel}
                  position="insideTopRight"
                  fill="#dc2626"
                  fontSize={11}
                  offset={8}
                />
              ) : null}
            </ReferenceLine>
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// 100%-stacked area means each `payload.value` is a raw share (0..100, since pivotToChart
// outputs %), but Recharts has converted them to stack offsets we don't have direct access
// to. We display the raw share for each series instead — what the user actually cares about.
function ChartTooltip({
  active,
  payload,
  label,
  displayNames,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
  displayNames: Record<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  // Sort by value desc and trim to top 8 so the tooltip stays readable.
  const top = [...payload].sort((a, b) => b.value - a.value).slice(0, 8);
  return (
    <div className="rounded-md border border-zinc-300 bg-white/95 px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-950/95">
      <div className="mb-1 font-medium">{label}</div>
      <ul className="space-y-0.5">
        {top.map((p) => (
          <li key={p.dataKey} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: p.color }}
              />
              {displayNames[p.dataKey] ?? p.dataKey}
            </span>
            <span className="tabular-nums">{p.value.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

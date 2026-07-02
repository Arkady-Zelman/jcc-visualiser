"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ImportVolumeRow } from "@/lib/flows";

interface Props {
  data: ImportVolumeRow[];
  /** Recharts syncId — same value as the composition charts for cross-hover. */
  syncId?: string;
}

const TICK_STYLE = { fontSize: 11, fill: "currentColor" };

export function ImportVolumeChart({ data, syncId }: Props) {
  const yearTickFormatter = (m: string) => (m.endsWith("-01-01") ? m.slice(0, 4) : "");

  return (
    <div className="text-zinc-700 dark:text-zinc-300">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          syncId={syncId}
          syncMethod="value"
          margin={{ top: 10, right: 12, left: 0, bottom: 8 }}
        >
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={yearTickFormatter}
            tick={TICK_STYLE}
            interval={0}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v: number) => `${Math.round(v / 1_000_000)}M`}
            domain={[0, "auto"]}
            tick={TICK_STYLE}
            width={44}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              border: "1px solid var(--border, #d4d4d8)",
              borderRadius: 6,
              padding: "6px 10px",
              backgroundColor: "var(--popover, #fff)",
            }}
            formatter={(v) => [`${(Number(v) / 1_000_000).toFixed(2)}M kl`, "Crude imports"]}
            labelFormatter={(l) => String(l).slice(0, 7)}
          />
          <Bar
            dataKey="volumeKl"
            fill="#71717a"
            fillOpacity={0.85}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

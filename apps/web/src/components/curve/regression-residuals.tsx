"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AlignedRow } from "@/lib/curve";

interface Props {
  aligned: AlignedRow[];
  predicted: number[];
}

const TICK_STYLE = { fontSize: 10, fill: "currentColor" };

export function RegressionResiduals({ aligned, predicted }: Props) {
  const data = aligned.map((r, i) => ({
    month: r.month.slice(0, 7),
    residual: r.jccUsd - predicted[i],
  }));

  return (
    <div className="h-32 text-zinc-700 dark:text-zinc-300">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
          <XAxis
            dataKey="month"
            tick={TICK_STYLE}
            interval="preserveStartEnd"
            minTickGap={48}
          />
          <YAxis
            tick={TICK_STYLE}
            tickFormatter={(v) => `${Number(v) > 0 ? "+" : ""}${Math.round(Number(v))}`}
            width={40}
            domain={["auto", "auto"]}
          />
          <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.35} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3", strokeOpacity: 0.3 }}
            contentStyle={{
              fontSize: 11,
              border: "1px solid var(--border, #d4d4d8)",
              borderRadius: 6,
              padding: "4px 8px",
              backgroundColor: "var(--popover, #fff)",
            }}
            formatter={(v) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}/bbl`}
          />
          <Line
            type="monotone"
            dataKey="residual"
            stroke="#ef4444"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

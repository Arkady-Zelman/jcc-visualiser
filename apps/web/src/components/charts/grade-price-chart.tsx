"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Props {
  data: { date: string; price_usd_bbl: number }[];
  benchmark: string;
}

const TICK_STYLE = { fontSize: 11, fill: "currentColor" };

export function GradePriceChart({ data, benchmark }: Props) {
  // Downsample to weekly for the line (daily over 16 years = ~4200 points is
  // fine for Recharts but visually messy). We pick the first row of each ISO week.
  const downsampled = useMemo(() => {
    const seenWeeks = new Set<string>();
    return data.filter((r) => {
      const d = new Date(r.date + "T00:00:00Z");
      // ISO year-week key — Sunday-of-week is good enough for downsampling.
      const ts = d.getTime();
      const week = Math.floor(ts / (7 * 86400_000));
      const key = String(week);
      if (seenWeeks.has(key)) return false;
      seenWeeks.add(key);
      return true;
    });
  }, [data]);

  const yearTickFormatter = (s: string) =>
    s.endsWith("-01-01") || s.endsWith("-01-02") || s.endsWith("-01-03") ? s.slice(0, 4) : "";

  return (
    <div className="text-zinc-700 dark:text-zinc-300">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={downsampled} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
          <XAxis dataKey="date" tickFormatter={yearTickFormatter} tick={TICK_STYLE} interval={0} minTickGap={30} />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(v) => `$${Math.round(v)}`}
            tick={TICK_STYLE}
            width={50}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              border: "1px solid var(--border, #d4d4d8)",
              borderRadius: 6,
              padding: "6px 10px",
              backgroundColor: "var(--popover, #fff)",
            }}
            formatter={(v) => [`$${Number(v).toFixed(2)}`, benchmark.toUpperCase()]}
            labelFormatter={(l) => String(l)}
          />
          <Line
            type="monotone"
            dataKey="price_usd_bbl"
            stroke="#22c55e"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

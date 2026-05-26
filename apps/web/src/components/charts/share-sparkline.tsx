"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Props {
  data: { month: string; share_pct: number }[];
}

export function ShareSparkline({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="grid h-32 place-items-center text-xs text-zinc-500 dark:text-zinc-400">
        No basket history.
      </div>
    );
  }
  // Coerce share_pct (string from PostgREST numeric → number).
  const series = data.map((d) => ({ month: d.month, share_pct: Number(d.share_pct) }));
  return (
    <div className="h-32 text-zinc-700 dark:text-zinc-300">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="month" hide />
          <YAxis hide domain={[0, "auto"]} />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              border: "1px solid var(--border, #d4d4d8)",
              borderRadius: 6,
              padding: "4px 8px",
              backgroundColor: "var(--popover, #fff)",
            }}
            formatter={(v) => [`${Number(v).toFixed(2)}%`, "share"]}
            labelFormatter={(l) => String(l).slice(0, 7)}
          />
          <Line
            type="monotone"
            dataKey="share_pct"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

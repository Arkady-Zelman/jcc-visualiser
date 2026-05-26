"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type { AlignedRow } from "@/lib/curve";

interface Props {
  aligned: AlignedRow[];
}

const TICK_STYLE = { fontSize: 11, fill: "currentColor" };

export function JccBrentScatter({ aligned }: Props) {
  const points = aligned.map((r) => ({
    brent: r.brent,
    jcc: r.jccUsd,
    month: r.month,
  }));
  return (
    <div className="h-56 text-zinc-700 dark:text-zinc-300">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} />
          <XAxis
            type="number"
            dataKey="brent"
            name="Brent"
            domain={["dataMin - 5", "dataMax + 5"]}
            tick={TICK_STYLE}
            tickFormatter={(v) => `$${Math.round(Number(v))}`}
            label={{ value: "Brent $/bbl", fontSize: 11, dy: 12, fill: "currentColor" }}
          />
          <YAxis
            type="number"
            dataKey="jcc"
            name="JCC"
            domain={["dataMin - 5", "dataMax + 5"]}
            tick={TICK_STYLE}
            tickFormatter={(v) => `$${Math.round(Number(v))}`}
            label={{ value: "JCC $/bbl", fontSize: 11, angle: -90, dx: -28, fill: "currentColor" }}
            width={60}
          />
          <ZAxis range={[30, 30]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{
              fontSize: 11,
              border: "1px solid var(--border, #d4d4d8)",
              borderRadius: 6,
              padding: "4px 8px",
              backgroundColor: "var(--popover, #fff)",
            }}
            formatter={(v) => `$${Number(v).toFixed(2)}`}
            labelFormatter={() => ""}
          />
          <Scatter
            name="months"
            data={points}
            fill="#3b82f6"
            fillOpacity={0.55}
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

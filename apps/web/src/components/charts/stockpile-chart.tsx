"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { convertKl, type StockpileChartRow, type VolumeUnit } from "@/lib/flows";

type View = "change" | "levels";

interface Props {
  data: StockpileChartRow[];
  unit: VolumeUnit;
}

const TICK_STYLE = { fontSize: 11, fill: "currentColor" };
const PRIVATE_COLOR = "#0ea5e9"; // sky-500 — commercial/refiner stocks
const GOVERNMENT_COLOR = "#e11d48"; // rose-600 — national reserve

const TOOLTIP_STYLE = {
  fontSize: 12,
  border: "1px solid var(--border, #d4d4d8)",
  borderRadius: 6,
  padding: "6px 10px",
  backgroundColor: "var(--popover, #fff)",
} as const;

const LEGEND_STYLE = { fontSize: 11 } as const;

export function StockpileChart({ data, unit }: Props) {
  const [view, setView] = useState<View>("change");

  const converted = useMemo(() => {
    const conv = (v: number | null) => (v != null ? convertKl(v, unit) : null);
    return data.map((r) => ({
      month: r.month,
      privateLevel: conv(r.privateKl),
      governmentLevel: conv(r.governmentKl),
      privateDelta: conv(r.privateDeltaKl),
      governmentDelta: conv(r.governmentDeltaKl),
    }));
  }, [data, unit]);

  // The first month has no prior month to diff against — drop it from the change view.
  const changeData = useMemo(
    () => converted.filter((r) => r.privateDelta != null || r.governmentDelta != null),
    [converted],
  );

  const yearTickFormatter = (m: string) => (m.endsWith("-01-01") ? m.slice(0, 4) : "");
  const labelFormatter = (l: unknown) => String(l).slice(0, 7);
  const yTickFormatter =
    unit === "kl"
      ? (v: number) => `${(v / 1_000_000).toFixed(0)}M`
      : (v: number) => `${Math.round(v / 1_000)}k`;
  const formatValue = (v: number) =>
    unit === "kl"
      ? `${(v / 1_000_000).toFixed(2)}M kl`
      : `${Math.round(v).toLocaleString()} kbbl`;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="change">Monthly change</TabsTrigger>
            <TabsTrigger value="levels">Levels</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {view === "change"
            ? "Bars below zero are withdrawals"
            : "End-of-month crude stock levels"}
        </p>
      </div>

      <div className="text-zinc-700 dark:text-zinc-300">
        <ResponsiveContainer width="100%" height={280}>
          {view === "change" ? (
            <BarChart
              data={changeData}
              stackOffset="sign"
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
              <YAxis tickFormatter={yTickFormatter} tick={TICK_STYLE} width={44} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, name) => [
                  formatValue(Number(v)),
                  name === "privateDelta" ? "Private change" : "Government change",
                ]}
                labelFormatter={labelFormatter}
              />
              <Legend
                wrapperStyle={LEGEND_STYLE}
                formatter={(value) =>
                  value === "privateDelta" ? "Private (commercial)" : "Government (national reserve)"
                }
              />
              <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} />
              <Bar
                dataKey="privateDelta"
                stackId="delta"
                fill={PRIVATE_COLOR}
                fillOpacity={0.85}
                isAnimationActive={false}
              />
              <Bar
                dataKey="governmentDelta"
                stackId="delta"
                fill={GOVERNMENT_COLOR}
                fillOpacity={0.85}
                isAnimationActive={false}
              />
            </BarChart>
          ) : (
            <AreaChart data={converted} margin={{ top: 10, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={yearTickFormatter}
                tick={TICK_STYLE}
                interval={0}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={yTickFormatter}
                domain={[0, "auto"]}
                tick={TICK_STYLE}
                width={44}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, name) => [
                  formatValue(Number(v)),
                  name === "privateLevel" ? "Private crude" : "Government crude",
                ]}
                labelFormatter={labelFormatter}
              />
              <Legend
                wrapperStyle={LEGEND_STYLE}
                formatter={(value) =>
                  value === "privateLevel" ? "Private (commercial)" : "Government (national reserve)"
                }
              />
              <Area
                type="monotone"
                dataKey="governmentLevel"
                stackId="level"
                stroke={GOVERNMENT_COLOR}
                fill={GOVERNMENT_COLOR}
                fillOpacity={0.25}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="privateLevel"
                stackId="level"
                stroke={PRIVATE_COLOR}
                fill={PRIVATE_COLOR}
                fillOpacity={0.25}
                isAnimationActive={false}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

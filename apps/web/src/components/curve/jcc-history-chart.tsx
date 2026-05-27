"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventCard } from "@/components/events/event-card";
import type { AlignedRow } from "@/lib/curve";
import type { EventRow } from "@/lib/composition";
import { cn } from "@/lib/utils";

type Unit = "jpy" | "usd";

interface Props {
  aligned: AlignedRow[];
  events?: EventRow[];
  /**
   * `compact = true` hides the embedded event sidebar and renders the chart
   * full-width. Used on `/composition` where the page already provides an
   * event sidebar. Defaults to `false` (full layout used on `/curve`).
   */
  compact?: boolean;
  /**
   * Recharts `syncId` — pass the same value to multiple charts on a page and
   * Recharts will sync their tooltip / active dot on hover.
   */
  syncId?: string;
  /**
   * Optional external month marker (e.g. driven by an event hover lifted to
   * the parent). Drawn as a dashed reference line at that month.
   */
  externalReferenceMonth?: string | null;
  externalReferenceLabel?: string | null;
}

const TICK_STYLE = { fontSize: 11, fill: "currentColor" };

const CATEGORY_BADGE: Record<string, string> = {
  sanctions: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  geopolitics: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  supply_shock: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  demand_shock: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  opec_decision: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  contract_launch: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  disaster: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  policy: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200",
};

export function JccHistoryChart({
  aligned,
  events = [],
  compact = false,
  syncId,
  externalReferenceMonth,
  externalReferenceLabel,
}: Props) {
  const [unit, setUnit] = useState<Unit>("usd");
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  // Sort events most-recent first (matches the /composition sidebar pattern).
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => b.date_from.localeCompare(a.date_from)),
    [events],
  );

  const hoveredEvent = sortedEvents.find((e) => e.id === hoveredEventId) ?? null;

  // Each chart row needs a stable key per unit so Recharts can animate cleanly.
  const data = useMemo(
    () =>
      aligned.map((r) => ({
        month: r.month,
        value: unit === "usd" ? r.jccUsd : r.jccJpy,
      })),
    [aligned, unit],
  );

  // Decide which reference month to draw (internal sidebar hover wins over external).
  const refMonth = useMemo(() => {
    const candidate =
      (hoveredEvent ? hoveredEvent.date_from.slice(0, 7) + "-01" : null) ??
      externalReferenceMonth ??
      null;
    if (!candidate) return null;
    return data.find((r) => r.month === candidate)?.month ?? null;
  }, [hoveredEvent, externalReferenceMonth, data]);
  const refLabel = hoveredEvent?.title ?? externalReferenceLabel ?? null;

  const yearTickFormatter = (m: string) => (m.endsWith("-01-01") ? m.slice(0, 4) : "");
  const yFormatter = unit === "usd" ? (v: number) => `$${v.toFixed(0)}` : (v: number) => `¥${Math.round(v / 1000)}k`;

  const chart = (
    <div className="text-zinc-700 dark:text-zinc-300">
      <ResponsiveContainer width="100%" height={360}>
        <LineChart
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
            tickFormatter={yFormatter}
            domain={["auto", "auto"]}
            tick={TICK_STYLE}
            width={56}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              border: "1px solid var(--border, #d4d4d8)",
              borderRadius: 6,
              padding: "6px 10px",
              backgroundColor: "var(--popover, #fff)",
            }}
            formatter={(v) => {
              const n = Number(v);
              return unit === "usd"
                ? [`$${n.toFixed(2)}/bbl`, "JCC"]
                : [`¥${n.toLocaleString()}/kl`, "JCC"];
            }}
            labelFormatter={(l) => String(l).slice(0, 7)}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#1f2937"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
            className="dark:[&_path]:stroke-zinc-200"
          />
          {refMonth && (
            <ReferenceLine
              x={refMonth}
              stroke="#dc2626"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            >
              {refLabel ? (
                <Label
                  value={refLabel}
                  position="insideTopRight"
                  fill="#dc2626"
                  fontSize={11}
                  offset={8}
                />
              ) : null}
            </ReferenceLine>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Tabs value={unit} onValueChange={(v) => setUnit(v as Unit)}>
        <TabsList>
          <TabsTrigger value="usd">USD / bbl</TabsTrigger>
          <TabsTrigger value="jpy">¥ / kl</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {aligned.length} months
        {!compact && events.length > 0 ? " · hover an event below to mark the chart" : ""}
      </p>
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-3">
        {header}
        {chart}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {chart}

        <aside className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Events
          </div>
          <ScrollArea className="h-[300px]">
            <ol className="space-y-0.5 p-1.5">
              {sortedEvents.map((evt) => (
                <li key={evt.id}>
                  <Popover>
                    <PopoverTrigger
                      type="button"
                      onMouseEnter={() => setHoveredEventId(evt.id)}
                      onMouseLeave={() => setHoveredEventId(null)}
                      onFocus={() => setHoveredEventId(evt.id)}
                      onBlur={() => setHoveredEventId(null)}
                      className={cn(
                        "flex w-full items-start gap-1.5 rounded-md p-1.5 text-left text-[11px] leading-tight transition-colors",
                        hoveredEventId === evt.id
                          ? "bg-zinc-100 dark:bg-zinc-900"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60",
                      )}
                    >
                      <span className="mt-px inline-block w-12 shrink-0 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                        {evt.date_from.slice(0, 7)}
                      </span>
                      <span className="flex-1">{evt.title}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 border-none px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide",
                          CATEGORY_BADGE[evt.category] ?? "",
                        )}
                      >
                        {evt.category.replace("_", " ")}
                      </Badge>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="start"
                      className="w-[min(24rem,calc(100vw-2rem))]"
                    >
                      <EventCard event={evt} />
                    </PopoverContent>
                  </Popover>
                </li>
              ))}
            </ol>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

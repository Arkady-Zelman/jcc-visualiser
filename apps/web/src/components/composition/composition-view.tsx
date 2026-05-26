"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompositionAreaChart } from "@/components/charts/composition-area-chart";
import { CompositionTreemap } from "@/components/charts/composition-treemap";
import { DateScrubber } from "@/components/composition/date-scrubber";
import { ViewModeToggle } from "@/components/composition/view-mode-toggle";
import { EventTimelineSidebar } from "@/components/events/event-timeline-sidebar";
import { snapshotForMonth, type EventRow, type PivotResult, type ViewMode } from "@/lib/composition";

interface Props {
  pivotedByMode: Record<ViewMode, PivotResult>;
  events: EventRow[];
  initialView: ViewMode;
}

export function CompositionView({ pivotedByMode, events, initialView }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const pivoted = pivotedByMode[viewMode];

  // Default scrubber position = latest month.
  const [monthIndex, setMonthIndex] = useState(() => pivoted.rows.length - 1);
  // Treemap updates can lag the slider feedback to keep the UI snappy.
  const deferredMonthIndex = useDeferredValue(monthIndex);

  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  const monthLabels = useMemo(() => pivoted.rows.map((r) => r.month), [pivoted]);

  // Date label for the scrubber: "2026-03" not "2026-03-01" for tightness.
  const scrubbedLabel = useMemo(
    () => (monthLabels[monthIndex] ?? "").slice(0, 7),
    [monthIndex, monthLabels],
  );

  const treemapData = useMemo(
    () => snapshotForMonth(pivoted, deferredMonthIndex),
    [pivoted, deferredMonthIndex],
  );

  // Event currently hovered → its date_from is what we draw on the chart.
  const hoveredEvent = events.find((e) => e.id === hoveredEventId) ?? null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base font-medium">Basket share over time</CardTitle>
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
          </CardHeader>
          <CardContent className="space-y-3">
            <CompositionAreaChart
              data={pivoted.rows}
              seriesKeys={pivoted.seriesKeys}
              displayNames={pivoted.displayNames}
              referenceMonth={hoveredEvent ? hoveredEvent.date_from : monthLabels[monthIndex]}
              referenceLabel={hoveredEvent?.title}
              viewMode={viewMode}
            />
            <DateScrubber
              monthLabels={monthLabels}
              monthIndex={monthIndex}
              onChange={setMonthIndex}
              scrubbedLabel={scrubbedLabel}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Snapshot — {scrubbedLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CompositionTreemap data={treemapData} viewMode={viewMode} />
          </CardContent>
        </Card>
      </div>

      <EventTimelineSidebar
        events={events}
        hoveredEventId={hoveredEventId}
        setHoveredEventId={setHoveredEventId}
      />
    </div>
  );
}

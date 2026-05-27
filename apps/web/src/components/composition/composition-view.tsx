"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompositionAreaChart } from "@/components/charts/composition-area-chart";
import { CompositionTreemap } from "@/components/charts/composition-treemap";
import { DateScrubber } from "@/components/composition/date-scrubber";
import { ViewModeToggle } from "@/components/composition/view-mode-toggle";
import { EventTimelineSidebar } from "@/components/events/event-timeline-sidebar";
import { JccHistoryChart } from "@/components/curve/jcc-history-chart";
import { snapshotForMonth, type EventRow, type PivotResult, type ViewMode } from "@/lib/composition";
import type { AlignedRow } from "@/lib/curve";

interface Props {
  pivotedByMode: Record<ViewMode, PivotResult>;
  events: EventRow[];
  initialView: ViewMode;
  aligned: AlignedRow[];
}

// Shared sync key for the area chart and JCC line chart — Recharts cross-hovers
// any chart pair that shares this id, matching by x-value (month).
const TIME_SYNC_ID = "composition-time";

export function CompositionView({ pivotedByMode, events, initialView, aligned }: Props) {
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
  const eventReferenceMonth = hoveredEvent ? hoveredEvent.date_from : null;
  const eventReferenceLabel = hoveredEvent?.title ?? null;

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
              referenceMonth={eventReferenceMonth ?? monthLabels[monthIndex]}
              referenceLabel={eventReferenceLabel}
              viewMode={viewMode}
              syncId={TIME_SYNC_ID}
            />
            <DateScrubber
              monthLabels={monthLabels}
              monthIndex={monthIndex}
              onChange={setMonthIndex}
              scrubbedLabel={scrubbedLabel}
            />
          </CardContent>
        </Card>

        {aligned.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">
                JCC price (synced to the chart above)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <JccHistoryChart
                aligned={aligned}
                compact
                syncId={TIME_SYNC_ID}
                externalReferenceMonth={eventReferenceMonth}
                externalReferenceLabel={eventReferenceLabel}
              />
            </CardContent>
          </Card>
        )}

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

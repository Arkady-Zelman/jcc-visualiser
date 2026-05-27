"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompositionAreaChart } from "@/components/charts/composition-area-chart";
import { ViewModeToggle } from "@/components/composition/view-mode-toggle";
import { RangeComparison } from "@/components/composition/range-comparison";
import { EventTimelineSidebar } from "@/components/events/event-timeline-sidebar";
import { JccHistoryChart } from "@/components/curve/jcc-history-chart";
import { type EventRow, type PivotResult, type ViewMode } from "@/lib/composition";
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

  // Range selection — defaults to full window. User drags the Brush below the
  // area chart to narrow it. Indices are positions in `pivoted.rows`.
  const lastIdx = Math.max(0, pivoted.rows.length - 1);
  const [startIdx, setStartIdx] = useState(0);
  const [endIdx, setEndIdx] = useState(lastIdx);

  // If the user switches view mode, the row count is the same (months are the
  // same) so indices stay valid. Clamp defensively anyway.
  useEffect(() => {
    setStartIdx((s) => Math.min(s, lastIdx));
    setEndIdx((e) => Math.min(e, lastIdx));
  }, [lastIdx]);

  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  const monthLabels = useMemo(() => pivoted.rows.map((r) => r.month), [pivoted]);

  // Event currently hovered → its date_from is what we draw on the chart.
  const hoveredEvent = events.find((e) => e.id === hoveredEventId) ?? null;
  const eventReferenceMonth = hoveredEvent ? hoveredEvent.date_from : null;
  const eventReferenceLabel = hoveredEvent?.title ?? null;

  const rangeStartMonth = monthLabels[Math.min(startIdx, endIdx)] ?? null;
  const rangeEndMonth = monthLabels[Math.max(startIdx, endIdx)] ?? null;

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
              referenceMonth={eventReferenceMonth}
              referenceLabel={eventReferenceLabel}
              viewMode={viewMode}
              syncId={TIME_SYNC_ID}
              brushStartIndex={startIdx}
              brushEndIndex={endIdx}
              onBrushChange={(s, e) => {
                setStartIdx(s);
                setEndIdx(e);
              }}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Drag the handles below the chart to pick a date range. The
              comparison panel on the right updates live.
            </p>
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
                rangeStartMonth={rangeStartMonth}
                rangeEndMonth={rangeEndMonth}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Range comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <RangeComparison
              pivoted={pivoted}
              startIdx={startIdx}
              endIdx={endIdx}
              viewMode={viewMode}
              aligned={aligned}
            />
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

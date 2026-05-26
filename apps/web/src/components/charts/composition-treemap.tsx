"use client";

import { ResponsiveContainer, Treemap } from "recharts";

import { gradeColor, originColor, REGION_COLORS } from "@/lib/colors";
import type { TreemapDatum, ViewMode } from "@/lib/composition";

interface Props {
  data: TreemapDatum[];
  viewMode: ViewMode;
}

function colorFor(key: string, viewMode: ViewMode): string {
  if (viewMode === "grade") return gradeColor(key);
  if (viewMode === "origin") return originColor(key);
  return REGION_COLORS[key as keyof typeof REGION_COLORS] ?? REGION_COLORS.other;
}

interface ContentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  payload?: TreemapDatum;
  viewMode: ViewMode;
}

function TreemapCell({ x, y, width, height, payload, viewMode }: ContentProps) {
  if (!payload) return null;
  const fill = colorFor(payload.name, viewMode);
  const showLabel = width > 60 && height > 28;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#ffffff" strokeWidth={2} fillOpacity={0.9} />
      {showLabel && (
        <text x={x + 6} y={y + 16} fill="white" fontSize={11} fontWeight={500}>
          {payload.displayName}
        </text>
      )}
      {showLabel && width > 90 && height > 44 && (
        <text x={x + 6} y={y + 32} fill="white" fontSize={11} fillOpacity={0.85}>
          {payload.size.toFixed(1)}%
        </text>
      )}
    </g>
  );
}

export function CompositionTreemap({ data, viewMode }: Props) {
  if (data.length === 0) {
    return (
      <div className="grid h-64 place-items-center text-sm text-zinc-500 dark:text-zinc-400">
        No data for this month.
      </div>
    );
  }
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={data as unknown as Array<Record<string, unknown>>}
          dataKey="size"
          nameKey="displayName"
          aspectRatio={4 / 3}
          isAnimationActive={false}
          content={
            ((props: unknown) => {
              const p = props as ContentProps & { payload?: TreemapDatum };
              return <TreemapCell {...p} viewMode={viewMode} />;
            }) as never
          }
        />
      </ResponsiveContainer>
    </div>
  );
}

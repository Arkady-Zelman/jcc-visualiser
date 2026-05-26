"use client";

import { Slider } from "@/components/ui/slider";

interface Props {
  monthLabels: string[];
  monthIndex: number;
  onChange: (i: number) => void;
  scrubbedLabel: string;
}

export function DateScrubber({ monthLabels, monthIndex, onChange, scrubbedLabel }: Props) {
  if (monthLabels.length === 0) return null;
  return (
    <div className="space-y-1.5 px-1 pt-2">
      <div className="flex items-baseline justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{monthLabels[0]?.slice(0, 7)}</span>
        <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
          {scrubbedLabel}
        </span>
        <span>{monthLabels[monthLabels.length - 1]?.slice(0, 7)}</span>
      </div>
      <Slider
        min={0}
        max={monthLabels.length - 1}
        step={1}
        value={[monthIndex]}
        onValueChange={(vals) => {
          const v = Array.isArray(vals) ? vals[0] : vals;
          if (typeof v === "number") onChange(v);
        }}
        aria-label="Scrub through months"
      />
    </div>
  );
}

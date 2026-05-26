"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EventCard } from "@/components/events/event-card";
import type { EventRow } from "@/lib/composition";
import { cn } from "@/lib/utils";

interface Props {
  events: EventRow[];
  hoveredEventId: string | null;
  setHoveredEventId: (id: string | null) => void;
}

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

export function EventTimelineSidebar({
  events,
  hoveredEventId,
  setHoveredEventId,
}: Props) {
  const sorted = useMemo(
    () => [...events].sort((a, b) => a.date_from.localeCompare(b.date_from)),
    [events],
  );

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle className="text-base font-medium">Why the basket changed</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[640px] px-4 pb-4">
          <ol className="space-y-1">
            {sorted.map((evt) => (
              <li key={evt.id}>
                <Popover>
                  <PopoverTrigger
                    type="button"
                    onMouseEnter={() => setHoveredEventId(evt.id)}
                    onMouseLeave={() => setHoveredEventId(null)}
                    onFocus={() => setHoveredEventId(evt.id)}
                    onBlur={() => setHoveredEventId(null)}
                    className={cn(
                      "group flex w-full items-start gap-2 rounded-md p-2 text-left text-xs transition-colors",
                      hoveredEventId === evt.id
                        ? "bg-zinc-100 dark:bg-zinc-900"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60",
                    )}
                  >
                    <span className="mt-0.5 inline-block w-16 shrink-0 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                      {evt.date_from.slice(0, 7)}
                    </span>
                    <span className="flex-1 leading-snug">{evt.title}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "ml-1 shrink-0 border-none text-[10px] font-medium uppercase tracking-wide",
                        CATEGORY_BADGE[evt.category] ?? "",
                      )}
                    >
                      {evt.category.replace("_", " ")}
                    </Badge>
                    <ChevronRight
                      className="ml-1 size-3.5 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    side="left"
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
      </CardContent>
    </Card>
  );
}

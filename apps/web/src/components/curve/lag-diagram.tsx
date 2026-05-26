import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Stage {
  label: string;
  delta: string;
  detail: string;
}

const STAGES: Stage[] = [
  {
    label: "Physical lift",
    delta: "month M",
    detail:
      "Cargo loads at origin (Ras Tanura, Murban terminal, Kozmino, etc.). Voyage to Japan takes ~2–5 weeks depending on origin.",
  },
  {
    label: "Customs clearance",
    delta: "M + 1",
    detail:
      "Cargo arrives at a Japanese port and clears customs. CIF value (cargo + insurance + freight) is recorded by MOF.",
  },
  {
    label: "PAJ provisional",
    delta: "M + 2",
    detail:
      "Petroleum Association of Japan publishes the month's provisional JCC value — volume-weighted CIF average across all crude that cleared customs that month.",
  },
  {
    label: "PAJ revised / final",
    delta: "M + 3",
    detail:
      "MOF revisions and late filings fold in; PAJ publishes the revised, then final, JCC value.",
  },
  {
    label: "LNG indexation",
    delta: "M + 4",
    detail:
      "JCC values feed into LNG long-term contracts indexed off a trailing 3-month JCC average — the famous 3-0-1 formula. A June 2026 LNG cargo prices off Mar–May 2026 JCC.",
  },
];

export function LagDiagram() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">
          Structural lag: physical cargo to LNG settled price
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          JCC is a backward-looking index. From a tanker loading at Ras Tanura
          to the matching LNG cargo's price settling in Tokyo, roughly four
          months pass.
        </p>

        <ol className="flex flex-col gap-3 sm:flex-row sm:gap-2">
          {STAGES.map((stage, i) => (
            <li key={stage.label} className="flex flex-1 items-stretch gap-2">
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  className="group flex flex-1 flex-col items-start rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {stage.delta}
                  </span>
                  <span className="mt-0.5 text-sm font-medium leading-tight text-zinc-950 dark:text-zinc-50">
                    {stage.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs" side="bottom">
                  {stage.detail}
                </TooltipContent>
              </Tooltip>
              {i < STAGES.length - 1 && (
                <div
                  aria-hidden
                  className="hidden flex-col items-center justify-center text-zinc-400 sm:flex"
                >
                  →
                </div>
              )}
            </li>
          ))}
        </ol>

        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Sources: PAJ statistics publication schedule; Japan Customs Trade
          Statistics release cadence; LNG long-term contract 3-0-1 averaging
          formula (3-month trailing window + 1-month settlement lag).
        </p>
      </CardContent>
    </Card>
  );
}

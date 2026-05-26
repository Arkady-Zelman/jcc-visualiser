import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface Props {
  impliedUsd: number | null;
  impliedJpy: number | null;
  nextMonth: string | null;
  benchmarkInputMonth: string | null;
  brentInput: number | null;
  wtiInput: number | null;
  brent30: number | null;
  wti30: number | null;
  fx30: number | null;
  lagMonths: number;
  lastObserved: { month: string; jpy: number; usd: number | null } | null;
}

export function ForecastCard({
  impliedUsd,
  impliedJpy,
  nextMonth,
  benchmarkInputMonth,
  brentInput,
  wtiInput,
  brent30,
  wti30,
  fx30,
  lagMonths,
  lastObserved,
}: Props) {
  const deltaJpy =
    impliedJpy != null && lastObserved ? impliedJpy - lastObserved.jpy : null;
  const deltaUsd =
    impliedUsd != null && lastObserved?.usd != null ? impliedUsd - lastObserved.usd : null;
  const deltaPct =
    deltaJpy != null && lastObserved ? (deltaJpy / lastObserved.jpy) * 100 : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">
          Implied next-month JCC
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {impliedUsd != null && nextMonth ? (
          <>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Predicted for {nextMonth.slice(0, 7)}
              </p>
              <div className="flex items-baseline gap-3">
                <p className="text-3xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
                  ${impliedUsd.toFixed(2)}
                  <span className="ml-1 text-sm font-normal text-zinc-500">/bbl</span>
                </p>
                {impliedJpy != null && (
                  <p className="text-base tabular-nums text-zinc-600 dark:text-zinc-400">
                    ¥{Math.round(impliedJpy).toLocaleString()}
                    <span className="ml-1 text-xs text-zinc-500">/kl</span>
                  </p>
                )}
              </div>
            </div>

            {deltaJpy != null && deltaPct != null && lastObserved && (
              <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-400">
                  vs last published ({lastObserved.month.slice(0, 7)}):
                </span>{" "}
                <span
                  className={
                    deltaJpy > 0
                      ? "font-mono text-rose-700 dark:text-rose-400"
                      : "font-mono text-emerald-700 dark:text-emerald-400"
                  }
                >
                  {deltaJpy > 0 ? "+" : ""}
                  {Math.round(deltaJpy).toLocaleString()} ¥/kl
                  {deltaUsd != null && (
                    <> · {deltaUsd > 0 ? "+" : ""}${deltaUsd.toFixed(2)}/bbl</>
                  )}{" "}
                  ({deltaPct > 0 ? "+" : ""}
                  {deltaPct.toFixed(1)}%)
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Forecast unavailable — need recent WTI + Brent + FX data.
          </p>
        )}

        <Separator />

        <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <p className="font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Model inputs — Brent + WTI at month{" "}
            {benchmarkInputMonth ? benchmarkInputMonth.slice(0, 7) : "?"} (lag = {lagMonths} months)
          </p>
          <ul className="ml-4 list-disc space-y-0.5">
            {brentInput != null && (
              <li>
                Brent monthly avg: <span className="font-mono">${brentInput.toFixed(2)}/bbl</span>
              </li>
            )}
            {wtiInput != null && (
              <li>
                WTI monthly avg: <span className="font-mono">${wtiInput.toFixed(2)}/bbl</span>
              </li>
            )}
            {fx30 != null && (
              <li>
                JPY/USD (last 30d): <span className="font-mono">¥{fx30.toFixed(2)}</span>
              </li>
            )}
          </ul>
        </div>

        {(brent30 != null || wti30 != null) && (
          <details className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <summary className="cursor-pointer font-medium text-zinc-700 dark:text-zinc-300">
              Today's spot (for reference, not used in prediction)
            </summary>
            <ul className="mt-1 ml-4 list-disc space-y-0.5">
              {brent30 != null && <li>Brent 30d avg: <span className="font-mono">${brent30.toFixed(2)}</span></li>}
              {wti30 != null && <li>WTI 30d avg: <span className="font-mono">${wti30.toFixed(2)}</span></li>}
            </ul>
            <p className="mt-1 text-[11px]">
              Today's spot won't be reflected in JCC until ~{lagMonths} months later — that's the
              physical-cargo + customs-clearance lag baked into the index.
            </p>
          </details>
        )}

        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          This is a model output, not a market quote. JCC has a structural ~
          {lagMonths}-month lag: today's Brent print won't show up in JCC until {lagMonths}{" "}
          months later. The regression was fit on lagged data, so the prediction uses
          Brent + WTI from {lagMonths} months back — i.e. crude that's already on the
          water and clearing customs as we speak.
        </p>
      </CardContent>
    </Card>
  );
}

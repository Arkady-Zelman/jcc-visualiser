import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JccHistoryChart } from "@/components/curve/jcc-history-chart";
import { RegressionCard } from "@/components/curve/regression-card";
import { ForecastCard } from "@/components/curve/forecast-card";
import { LagDiagram } from "@/components/curve/lag-diagram";
import { ForwardCurvePlaceholder } from "@/components/curve/forward-curve-placeholder";
import { createClient, fetchAll } from "@/lib/supabase/server";
import {
  LAG_MONTHS,
  addMonths,
  alignSeries,
  lastNDayAverage,
  monthAverage,
  monthlyAverages,
  type BenchmarkPriceRow,
  type JccRow,
} from "@/lib/curve";
import { linearRegression, predict } from "@/lib/regression";
import type { EventRow } from "@/lib/composition";

export const revalidate = 86400;

export default async function CurvePage() {
  const supabase = createClient();

  const [jcc, wtiDaily, brentDaily, fxDaily, events, jccLatestResp] = await Promise.all([
    fetchAll<JccRow>(() =>
      supabase
        .from("jcc_monthly")
        .select("*")
        .order("month"),
    ),
    fetchAll<BenchmarkPriceRow>(() =>
      supabase
        .from("benchmark_prices_daily")
        .select("*")
        .eq("benchmark", "wti")
        .order("date"),
    ),
    fetchAll<BenchmarkPriceRow>(() =>
      supabase
        .from("benchmark_prices_daily")
        .select("*")
        .eq("benchmark", "brent")
        .order("date"),
    ),
    fetchAll<BenchmarkPriceRow>(() =>
      supabase
        .from("benchmark_prices_daily")
        .select("*")
        .eq("benchmark", "jpy_usd_fx")
        .order("date"),
    ),
    fetchAll<EventRow>(() =>
      supabase
        .from("events")
        .select("*")
        .order("date_from"),
    ),
    supabase
      .from("jcc_monthly")
      .select("month, jcc_value_jpy_per_kl, jcc_value_usd_per_bbl, status")
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const wtiMonthly = monthlyAverages(wtiDaily);
  const brentMonthly = monthlyAverages(brentDaily);
  const aligned = alignSeries(jcc, brentMonthly, wtiMonthly);

  const hasModelData = aligned.length >= 12;

  // Fit JCC_usd_bbl ~ a·Brent + b·WTI + c. Only attempt with enough rows.
  const model = hasModelData
    ? linearRegression(
        aligned.map((r) => [r.brent, r.wti]),
        aligned.map((r) => r.jccUsd),
      )
    : null;

  // Implied next-month JCC: predict JCC[M+1] using Brent/WTI from M+1-LAG_MONTHS,
  // i.e. the same lag the historical regression was fit on.
  const lastJccMonth = jcc[jcc.length - 1]?.month ?? null;
  const nextMonthLabel = lastJccMonth ? addMonths(lastJccMonth, 1) : null;
  // For example with LAG_MONTHS=2: predict 2026-04 → use Brent monthly avg 2026-02.
  const benchmarkInputMonth = nextMonthLabel
    ? addMonths(nextMonthLabel, -LAG_MONTHS)
    : null;
  const brentInput = benchmarkInputMonth ? monthAverage(brentDaily, benchmarkInputMonth) : null;
  const wtiInput = benchmarkInputMonth ? monthAverage(wtiDaily, benchmarkInputMonth) : null;
  // Also surface "current" 30-day spot in the disclosure card — useful even though
  // the prediction itself uses lagged values.
  const brent30 = lastNDayAverage(brentDaily, 30);
  const wti30 = lastNDayAverage(wtiDaily, 30);
  const fx30 = lastNDayAverage(fxDaily, 30);
  const impliedUsd =
    model && brentInput != null && wtiInput != null
      ? predict({ coefficients: model.coefficients, intercept: model.intercept }, [brentInput, wtiInput])
      : null;
  // 1 bbl = 0.158987 kl, so ¥/kl ≈ (USD/bbl × JPY/USD) / 0.158987.
  const impliedJpy =
    impliedUsd != null && fx30 != null ? (impliedUsd * fx30) / 0.158987 : null;

  const jccLatest = jccLatestResp.data;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Curve
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          How the JCC price moves
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          The JCC tracks Brent and WTI with a structural ~4-month lag. This page
          shows the full price history, how JCC has historically related to the
          two reference benchmarks, and where the next month's print is likely
          to land.
        </p>
        {jccLatest && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-zinc-900 px-3 py-1 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-950">
              Latest JCC ({jccLatest.month?.slice(0, 7)}):{" "}
              ¥{jccLatest.jcc_value_jpy_per_kl?.toLocaleString()}/kl
              {jccLatest.jcc_value_usd_per_bbl
                ? ` · $${jccLatest.jcc_value_usd_per_bbl.toFixed(2)}/bbl`
                : ""}
            </span>
            <span className="rounded-full border border-zinc-300 px-3 py-1 text-xs uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              {jccLatest.status}
            </span>
          </div>
        )}
      </header>

      {jcc.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-300 p-8 text-sm dark:border-zinc-700">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">No JCC history yet</p>
          <p className="mt-1 max-w-md text-zinc-600 dark:text-zinc-400">
            Run <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">python -m ingest.paj</code> and <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">python -m ingest.benchmarks</code> to populate the price history and benchmark series.
          </p>
        </div>
      ) : (
        <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">JCC price history</CardTitle>
        </CardHeader>
        <CardContent>
          <JccHistoryChart aligned={aligned} events={events} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {model && <RegressionCard model={model} aligned={aligned} />}
        <ForecastCard
          impliedUsd={impliedUsd}
          impliedJpy={impliedJpy}
          nextMonth={nextMonthLabel}
          benchmarkInputMonth={benchmarkInputMonth}
          brentInput={brentInput}
          wtiInput={wtiInput}
          brent30={brent30}
          wti30={wti30}
          fx30={fx30}
          lagMonths={LAG_MONTHS}
          lastObserved={
            jccLatest
              ? {
                  month: jccLatest.month,
                  jpy: Number(jccLatest.jcc_value_jpy_per_kl),
                  usd: jccLatest.jcc_value_usd_per_bbl
                    ? Number(jccLatest.jcc_value_usd_per_bbl)
                    : null,
                }
              : null
          }
        />
      </div>

      <LagDiagram />

      <ForwardCurvePlaceholder />
        </>
      )}
    </div>
  );
}

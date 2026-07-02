import { Suspense } from "react";

import { CompositionView } from "@/components/composition/composition-view";
import { ImportVolumeChart } from "@/components/charts/import-volume-chart";
import { StockpileChart } from "@/components/charts/stockpile-chart";
import { createClient, fetchAll } from "@/lib/supabase/server";
import {
  pivotToChart,
  type CompositionRow,
  type EventRow,
  type GradeRow,
  type ViewMode,
} from "@/lib/composition";
import {
  stockpileSeries,
  totalImportsByMonth,
  type StockpileRow,
} from "@/lib/flows";
import { MIN_DATA_DATE, MIN_DATA_MONTH } from "@/lib/constants";
import {
  alignSeries,
  monthlyAverages,
  type BenchmarkPriceRow,
  type JccRow,
} from "@/lib/curve";

export const revalidate = 86400; // composition is monthly — refresh daily

interface PageProps {
  searchParams: Promise<{ view?: string }>;
}

export default async function CompositionPage({ searchParams }: PageProps) {
  const { view } = await searchParams;
  const initialView: ViewMode = view === "origin" || view === "region" ? view : "grade";

  const supabase = createClient();

  const [composition, grades, events, jccLatestResp, compositionLatestResp, jcc, wtiDaily, brentDaily, importRows, stockpileRows] = await Promise.all([
    fetchAll<CompositionRow>(() =>
      supabase
        .from("composition_monthly")
        .select("month, grade_id, share_pct, volume_kl, value_jpy, source, ingested_at")
        .gte("month", MIN_DATA_MONTH)
        .order("month", { ascending: true }),
    ),
    fetchAll<GradeRow>(() =>
      supabase
        .from("grades")
        .select("*")
        .order("id"),
    ),
    fetchAll<EventRow>(() =>
      supabase
        .from("events")
        .select("*")
        .gte("date_from", MIN_DATA_MONTH)
        .order("date_from", { ascending: true }),
    ),
    supabase
      .from("jcc_monthly")
      .select("month, jcc_value_jpy_per_kl, jcc_value_usd_per_bbl, status")
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("composition_monthly")
      .select("month")
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchAll<JccRow>(() =>
      supabase
        .from("jcc_monthly")
        .select("*")
        .gte("month", MIN_DATA_MONTH)
        .order("month"),
    ),
    fetchAll<BenchmarkPriceRow>(() =>
      supabase
        .from("benchmark_prices_daily")
        .select("*")
        .eq("benchmark", "wti")
        .gte("date", MIN_DATA_DATE)
        .order("date"),
    ),
    fetchAll<BenchmarkPriceRow>(() =>
      supabase
        .from("benchmark_prices_daily")
        .select("*")
        .eq("benchmark", "brent")
        .gte("date", MIN_DATA_DATE)
        .order("date"),
    ),
    fetchAll<{ month: string; volume_kl: number }>(() =>
      supabase
        .from("imports_monthly")
        .select("month, volume_kl")
        .gte("month", MIN_DATA_MONTH)
        .order("month"),
    ),
    fetchAll<StockpileRow>(() =>
      supabase
        .from("oil_stockpile_monthly")
        .select("*")
        .gte("month", MIN_DATA_MONTH)
        .order("month"),
    ),
  ]);

  const jccLatest = jccLatestResp.data;
  const compositionLatest = compositionLatestResp.data;
  const showFreshnessNote =
    !!jccLatest?.month &&
    !!compositionLatest?.month &&
    compositionLatest.month > jccLatest.month;

  // Build the same `aligned` shape `/curve` uses so we can render JccHistoryChart
  // below the area chart with identical data semantics + cross-hover sync.
  const aligned = alignSeries(jcc, monthlyAverages(brentDaily), monthlyAverages(wtiDaily));

  // Pre-compute all three pivots server-side so the Client Component swaps view-mode
  // without recomputing in the browser.
  const pivotedByMode = {
    grade: pivotToChart(composition, grades, "grade"),
    origin: pivotToChart(composition, grades, "origin"),
    region: pivotToChart(composition, grades, "region"),
  };

  const importVolumes = totalImportsByMonth(importRows);
  const stockpiles = stockpileSeries(stockpileRows);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-7 py-8">
      <header className="mb-6 space-y-2">
        <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Composition
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          What's in the JCC basket
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          The Japan Crude Cocktail is the volume-weighted CIF average price of every
          drop of crude that clears Japanese customs each month. This view shows how
          the basket composition has evolved.
        </p>
        {jccLatest && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-zinc-900 px-3 py-1 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-950">
              Latest JCC ({jccLatest.month}):
              {" "}¥{jccLatest.jcc_value_jpy_per_kl?.toLocaleString()}/kl
              {jccLatest.jcc_value_usd_per_bbl
                ? ` · $${jccLatest.jcc_value_usd_per_bbl.toFixed(2)}/bbl`
                : ""}
            </span>
            <span className="rounded-full border border-zinc-300 px-3 py-1 text-xs uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              {jccLatest.status}
            </span>
          </div>
        )}
        {showFreshnessNote && (
          <p className="mt-3 max-w-2xl rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-400">
            The basket chart goes through <span className="font-medium text-zinc-900 dark:text-zinc-200">{compositionLatest!.month}</span>,
            but the headline JCC price above only goes to <span className="font-medium text-zinc-900 dark:text-zinc-200">{jccLatest.month}</span>.
            That's because Japan Customs publishes import volumes (which we use to build the basket) a few weeks before the Petroleum
            Association of Japan publishes the official JCC price. See <a href="/sources" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">Data sources</a> for details.
          </p>
        )}
      </header>

      {composition.length === 0 ? (
        <EmptyState
          title="No composition data yet"
          body="Run the ingest pipeline (python -m ingest.customs && python -m ingest.derive_composition) to populate composition_monthly. The grade + HS mapping reference data is seeded — only the monthly facts are missing."
        />
      ) : (
        <Suspense>
          <CompositionView
            pivotedByMode={pivotedByMode}
            events={events}
            initialView={initialView}
            aligned={aligned}
          />
        </Suspense>
      )}

      {(importVolumes.length > 0 || stockpiles.length > 0) && (
        <section className="mt-10">
          <header className="mb-4 space-y-1">
            <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Physical flows
            </p>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Volumes behind the basket
            </h2>
            <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              The composition above shows shares; these charts show absolute barrels.
              Supply shocks that barely move the share mix — like the 2026 Hormuz
              closure — show up here as an import collapse and stockpile withdrawals.
            </p>
          </header>
          <div className="grid gap-8 lg:grid-cols-2">
            {importVolumes.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Total crude imports (kl / month)
                </p>
                <ImportVolumeChart data={importVolumes} syncId="composition-time" />
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Source: Japan Customs via e-Stat, HS 2709.00.900. Latest month is
                  provisional.
                </p>
              </div>
            )}
            {stockpiles.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Crude stockpiles — builds and withdrawals (kl)
                </p>
                <StockpileChart data={stockpiles} />
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Source: PAJ Oil Stockpiling (METI data), crude only, from 2017.
                  Government withdrawals mark strategic reserve releases.
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 p-8 text-sm dark:border-zinc-700">
      <p className="font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
      <p className="mt-1 max-w-md text-zinc-600 dark:text-zinc-400">{body}</p>
    </div>
  );
}

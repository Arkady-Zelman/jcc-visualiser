import { Suspense } from "react";

import { CompositionView } from "@/components/composition/composition-view";
import { createClient, fetchAll } from "@/lib/supabase/server";
import {
  pivotToChart,
  type CompositionRow,
  type EventRow,
  type GradeRow,
  type ViewMode,
} from "@/lib/composition";
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

  const [composition, grades, events, jccLatestResp, jcc, wtiDaily, brentDaily] = await Promise.all([
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
  ]);

  const jccLatest = jccLatestResp.data;

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
          <div className="mt-3 flex items-center gap-2 text-sm">
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

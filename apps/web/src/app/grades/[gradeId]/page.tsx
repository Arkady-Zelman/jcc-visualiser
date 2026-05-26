import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { GradePriceChart } from "@/components/charts/grade-price-chart";
import { ShareSparkline } from "@/components/charts/share-sparkline";
import { EventCard } from "@/components/events/event-card";
import { createClient, fetchAll } from "@/lib/supabase/server";
import type { CompositionRow, EventRow, GradeRow } from "@/lib/composition";

export const revalidate = 3600;

const BENCHMARKS_WITH_DAILY_DATA = new Set(["wti", "brent"]);

export async function generateStaticParams() {
  // At build time, if Supabase env isn't available (CI without secrets, fresh
  // local clone), gracefully degrade to dynamic — every grade page still works
  // at request time when env IS populated.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return [];
  }
  try {
    const supabase = createClient();
    const grades = await fetchAll<{ id: string }>(() =>
      supabase.from("grades").select("id"),
    );
    return grades.map((g) => ({ gradeId: g.id }));
  } catch {
    return [];
  }
}

// Allow request-time rendering for any grade not pre-generated.
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ gradeId: string }>;
}

export default async function GradeDetailPage({ params }: PageProps) {
  const { gradeId } = await params;
  const supabase = createClient();

  const { data: gradeResp } = await supabase
    .from("grades")
    .select("*")
    .eq("id", gradeId)
    .maybeSingle();
  const grade = gradeResp as GradeRow | null;
  if (!grade) notFound();

  const composition = await fetchAll<Pick<CompositionRow, "month" | "share_pct">>(() =>
    supabase
      .from("composition_monthly")
      .select("month, share_pct")
      .eq("grade_id", gradeId)
      .order("month"),
  );

  // Only fetch price history for grades whose primary_benchmark is one we
  // actually populate at M3 (wti, brent). For everything else we render a
  // documented empty state.
  const hasDailyData =
    grade.primary_benchmark != null && BENCHMARKS_WITH_DAILY_DATA.has(grade.primary_benchmark);

  const prices = hasDailyData
    ? await fetchAll<{ date: string; price_usd_bbl: number }>(() =>
        supabase
          .from("benchmark_prices_daily")
          .select("date, price_usd_bbl")
          .eq("benchmark", grade.primary_benchmark!)
          .order("date"),
      )
    : [];

  // Events that named this grade in impact_grades.
  const events = await fetchAll<EventRow>(() =>
    supabase
      .from("events")
      .select("*")
      .contains("impact_grades", [gradeId])
      .order("date_from"),
  );

  const isSynthetic = grade.id.startsWith("unmapped_");

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Link
        href="/grades"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="size-3" />
        Back to grades
      </Link>

      <header className="mb-8 space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {grade.display_name}
          </h1>
          {isSynthetic && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              synthetic bucket
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary" className="font-mono">{grade.origin_country}</Badge>
          <Badge variant="secondary">{grade.region.replace("_", " ")}</Badge>
          <Badge variant="secondary">{grade.type.replace("_", " ")}</Badge>
          {grade.api_gravity != null && (
            <Badge variant="outline">API {grade.api_gravity.toFixed(1)}</Badge>
          )}
          {grade.sulphur_pct != null && (
            <Badge variant="outline">S {grade.sulphur_pct.toFixed(2)}%</Badge>
          )}
        </div>
        {isSynthetic && (
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            This is a synthetic bucket for {grade.origin_country} crude imports that
            don't yet have a curated{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
              grade_hs_mapping.yaml
            </code>{" "}
            entry. Useful as-is for telling stories — the shape of this bucket over
            time is real, even if the underlying grades inside it aren't named.
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-medium">Price history</CardTitle>
          </CardHeader>
          <CardContent>
            {hasDailyData && prices.length > 0 ? (
              <GradePriceChart data={prices} benchmark={grade.primary_benchmark!} />
            ) : (
              <div className="rounded-md border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                  Daily price data not in v1
                </p>
                <p className="mt-1 max-w-md">
                  The free-tier data sources don't cover{" "}
                  <span className="font-mono">{grade.primary_benchmark ?? grade.id}</span>{" "}
                  spot prices. v1 only ships WTI and Brent daily history (via EIA);
                  Dubai / Oman / Murban / Arab grades / ESPO need paid feeds. See{" "}
                  <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
                    SESSION_LOG_2026-05-26-M3.md
                  </code>{" "}
                  for details.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Share of basket over time</CardTitle>
          </CardHeader>
          <CardContent>
            <ShareSparkline data={composition} />
            <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
              <p>
                First seen{" "}
                <span className="font-mono">
                  {grade.first_seen_in_jcc?.slice(0, 7) ?? "—"}
                </span>
                , last seen{" "}
                <span className="font-mono">
                  {grade.last_seen_in_jcc?.slice(0, 7) ?? "—"}
                </span>
                .
              </p>
              {composition.length > 0 && (
                <p className="mt-1">
                  Peak share:{" "}
                  <span className="tabular-nums">
                    {Math.max(...composition.map((c) => Number(c.share_pct))).toFixed(2)}%
                  </span>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {grade.notes && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base font-medium">Curator notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
              {grade.notes}
            </p>
          </CardContent>
        </Card>
      )}

      {events.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Events that affected {grade.display_name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {events.map((evt, i) => (
              <div key={evt.id}>
                {i > 0 && <Separator className="mb-4" />}
                <EventCard event={evt} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

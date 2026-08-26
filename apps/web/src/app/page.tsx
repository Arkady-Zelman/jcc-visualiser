import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 86400;

export default async function Home() {
  const supabase = createClient();

  const { data: jccLatest } = await supabase
    .from("jcc_monthly")
    .select("month, jcc_value_jpy_per_kl, jcc_value_usd_per_bbl, status, source")
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="mb-10 space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          The Japan Crude Cocktail, visually
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-zinc-700 dark:text-zinc-300">
          The JCC is the volume-weighted CIF average of every drop of crude that
          clears Japanese customs each month — published monthly by the Petroleum
          Association of Japan. This tool shows what's in the basket, where it
          came from, what affected it, and where its price has gone.
        </p>
      </header>

      {jccLatest && (
        <Card className="mb-8 border-zinc-200 dark:border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Latest JCC ({jccLatest.month?.slice(0, 7)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-4">
              <p className="text-3xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
                ¥{jccLatest.jcc_value_jpy_per_kl?.toLocaleString()}
                <span className="ml-1 text-base font-normal text-zinc-500">/kl</span>
              </p>
              {jccLatest.jcc_value_usd_per_bbl != null && (
                <p className="text-lg tabular-nums text-zinc-600 dark:text-zinc-400">
                  ${jccLatest.jcc_value_usd_per_bbl.toFixed(2)}
                  <span className="ml-1 text-sm text-zinc-500">/bbl</span>
                </p>
              )}
              <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
                {jccLatest.source === "estat_derived" ? "estimated" : jccLatest.status}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <SurfaceCard
          href="/composition"
          title="Composition"
          description="100% stacked area of grade share since 2016, with hover-cards on curated geopolitical events — updated through the latest customs month."
        />
        <SurfaceCard
          href="/grades"
          title="Grades"
          description="Every grade in the basket — price history, share-over-time, specs, and the events that mattered."
        />
        <SurfaceCard
          href="/curve"
          title="Curve"
          description="How JCC moves: full history since 2012, a regression against Brent + WTI, and the structural ~4-month lag from physical to LNG settled."
        />
      </section>

      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        See <span className="font-mono">BUILD_SPEC.md</span> for the full specification.
      </footer>
    </div>
  );
}

function SurfaceCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
    >
      <h3 className="flex items-center justify-between text-lg font-medium text-zinc-950 dark:text-zinc-50">
        {title}
        <ArrowRight className="size-4 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
      </h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
    </Link>
  );
}

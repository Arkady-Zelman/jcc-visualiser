import { createClient } from "@/lib/supabase/server";

export const revalidate = 86400;

interface Freshness {
  jccMonth: string | null;
  importsMonth: string | null;
  compositionMonth: string | null;
  benchmarkDate: string | null;
}

async function fetchFreshness(): Promise<Freshness> {
  const supabase = createClient();
  const [jcc, imports, composition, benchmarks] = await Promise.all([
    supabase.from("jcc_monthly").select("month").order("month", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("imports_monthly").select("month").order("month", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("composition_monthly").select("month").order("month", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("benchmark_prices_daily").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    jccMonth: jcc.data?.month ?? null,
    importsMonth: imports.data?.month ?? null,
    compositionMonth: composition.data?.month ?? null,
    benchmarkDate: benchmarks.data?.date ?? null,
  };
}

export default async function SourcesPage() {
  const freshness = await fetchFreshness();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Data sources
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Where the numbers come from
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          This page lists everything the dashboard pulls in, in plain English —
          what's an exact official figure, what's our own estimate, and how
          fresh each piece is.
        </p>
      </header>

      <section className="mb-10 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950/40">
        <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100">
          Latest data we have right now
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <FreshnessRow label="Headline JCC price" value={freshness.jccMonth} kind="month" />
          <FreshnessRow label="Country-by-country imports" value={freshness.importsMonth} kind="month" />
          <FreshnessRow label="Basket composition" value={freshness.compositionMonth} kind="month" />
          <FreshnessRow label="Daily benchmark prices (WTI, Brent)" value={freshness.benchmarkDate} kind="date" />
        </dl>
      </section>

      <Section title="1. Headline JCC price" badge="Real — official">
        <p>
          The Japan Crude Cocktail is published once a month by the{" "}
          <ExtLink href="https://www.paj.gr.jp/english/statis/">
            Petroleum Association of Japan
          </ExtLink>
          {" "}as a single Excel workbook covering the full history. We pull
          the latest workbook each month and read both the yen-per-kilolitre
          and dollars-per-barrel figures.
        </p>
        <p className="mt-2">
          PAJ runs about two months behind the calendar — April figures
          typically appear in late June. Until they publish, the headline
          number on the dashboard stays on the most recent month they've
          released.
        </p>
        <p className="mt-2">
          Since August 2026 the PAJ website blocks automated access, so months
          PAJ hasn't published (or that we can't fetch) are computed directly
          from the customs data in section 2: total import value divided by
          total volume, converted to dollars with the month's average exchange
          rate. Checked against the full PAJ history, this reproduces the
          official JCC within 0.05% in recent years. Such months are labelled
          "estimated" and are replaced by the official figure once available.
        </p>
      </Section>

      <Section title="2. Country-by-country crude imports" badge="Real — official">
        <p>
          Japan's Ministry of Finance reports, through Japan Customs, how much
          crude entered the country from every origin each month. We pull this
          from{" "}
          <ExtLink href="https://www.e-stat.go.jp/en/stat-search/database?statdisp_id=00350300">
            e-Stat, Japan's official statistics portal
          </ExtLink>
          , filtered to HS code 2709.00.900 (the main "crude oil, other"
          category).
        </p>
        <p className="mt-2">
          The 2026 dataset is browsable directly here:{" "}
          <ExtLink href="https://www.e-stat.go.jp/en/dbview?sid=0004049326">
            Trade Statistics of Japan — 2026 imports
          </ExtLink>
          . Earlier years live in separate datasets:{" "}
          <ExtLink href="https://www.e-stat.go.jp/en/dbview?sid=0003425294">2021–2025</ExtLink>,{" "}
          <ExtLink href="https://www.e-stat.go.jp/en/dbview?sid=0003313966">2016–2020</ExtLink>,{" "}
          <ExtLink href="https://www.e-stat.go.jp/en/dbview?sid=0003228185">2011–2015</ExtLink>.
        </p>
        <p className="mt-2">
          Customs typically publishes monthly numbers within a few weeks of
          month-end, so this data is usually a month ahead of the PAJ JCC
          price. <span className="font-medium">This is why the basket
          composition can extend further than the headline price.</span>
        </p>
      </Section>

      <Section title="3. Basket composition" badge="Real ingredients · modelled recipe">
        <p>
          The dashboard shows the JCC basket broken down by individual crude
          grade — Murban, Arab Light, Upper Zakum, WTI, etc. Japan Customs
          tells us how much crude came from each country, but{" "}
          <span className="font-medium">not which specific grade</span>.
        </p>
        <p className="mt-2">
          To get a grade-level view, we maintain our own curated table that
          says e.g. "from March 2021 onward, UAE crude going to Japan is
          roughly 60% Murban, 15% Das, 25% Upper Zakum." These weights are
          best-effort estimates informed by published industry data — they
          are not measured.
        </p>
        <p className="mt-2">
          So when the chart shows "Murban was 26.4% of the basket in April
          2026," that rests on a real measurement (UAE shipped 1.97 million
          kilolitres of crude to Japan) and a modelled assumption (60% of UAE
          crude exports to Japan are Murban). Country-level totals are
          exact; grade-level shares are model-derived.
        </p>
        <p className="mt-2">
          Smaller-volume origins we haven't mapped yet (Ecuador, Australia,
          Malaysia and a handful of others) appear as their own "Other XX"
          bands rather than being silently lumped into a real grade. Iran is
          deliberately left unmapped so the 2018 sanctions collapse stays
          visible on the chart.
        </p>
      </Section>

      <Section title="4. Import volumes, refinery runs and stockpiles" badge="Real — official">
        <p>
          The "Physical flows" charts use two more workbooks from the{" "}
          <ExtLink href="https://www.paj.gr.jp/english/statis/">
            Petroleum Association of Japan
          </ExtLink>
          {" "}(underlying data: METI). "Supply and Demand of Crude Oil"
          (paj-01E) gives monthly production, imports, refinery throughput and
          end-of-month inventory back to 2002. "Oil Stockpiling" (paj-05E)
          gives private and government stockpile levels and days-of-supply
          back to 2017 — government withdrawals show strategic reserve
          releases, like the ~5.9 million kilolitre release of April 2026.
        </p>
        <p className="mt-2">
          The total-imports chart itself uses the Japan Customs data from
          section 2, so it always matches the composition chart above it.
        </p>
      </Section>

      <Section title="5. Daily reference prices" badge="Real — official">
        <p>
          The forward-curve and regression views need daily reference prices.
          We pull WTI (Cushing) and Brent spot from the{" "}
          <ExtLink href="https://www.eia.gov/opendata/">
            US Energy Information Administration
          </ExtLink>
          {" "}({" "}
          <ExtLink href="https://www.eia.gov/dnav/pet/hist/RWTCD.htm">WTI series</ExtLink>,{" "}
          <ExtLink href="https://www.eia.gov/dnav/pet/hist/RBRTED.htm">Brent series</ExtLink>
          {" "}) and JPY/USD exchange rates from{" "}
          <ExtLink href="https://frankfurter.dev/">Frankfurter</ExtLink>, which
          republishes European Central Bank rates.
        </p>
        <p className="mt-2">
          Both feeds update within a few days of today's date.
        </p>
      </Section>

      <Section title="6. What we don't have" badge="Paywalled or retired">
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <span className="font-medium">JCC futures curve</span> — CME
            publishes a settled futures curve for JCC, but the feed is behind
            a paid CME data subscription. The Curve page shows a placeholder.
          </li>
          <li>
            <span className="font-medium">Dubai, Oman, Murban daily prices</span>{" "}
            — same story, paid CME or ICE feeds.
          </li>
          <li>
            <span className="font-medium">ESPO daily price</span> — published
            by Argus and behind a paywall.
          </li>
          <li>
            <span className="font-medium">Saudi Arab Light/Medium/Heavy OSPs</span>{" "}
            — Aramco publishes these monthly as press releases; we haven't
            built a scraper yet.
          </li>
          <li>
            <span className="font-medium">WTI futures curve</span> — the EIA
            retired the daily-WTI-futures series in April 2024. We have the
            old history but no new updates.
          </li>
        </ul>
      </Section>

      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Refreshed automatically on a monthly cadence. See{" "}
        <span className="font-mono">BUILD_SPEC.md</span> for the full
        technical specification.
      </footer>
    </div>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {badge}
        </span>
      </div>
      <div className="space-y-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {children}
      </div>
    </section>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-700 dark:text-zinc-200 dark:decoration-zinc-600 dark:hover:decoration-zinc-300"
    >
      {children}
    </a>
  );
}

function FreshnessRow({
  label,
  value,
  kind,
}: {
  label: string;
  value: string | null;
  kind: "month" | "date";
}) {
  return (
    <>
      <dt className="text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="font-mono text-zinc-900 dark:text-zinc-100">
        {value
          ? kind === "month"
            ? value.slice(0, 7)
            : value
          : "—"}
      </dd>
    </>
  );
}

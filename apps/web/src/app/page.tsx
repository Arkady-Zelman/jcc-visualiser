export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="max-w-2xl space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Milestone 1 — Scaffold
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            JCC Visualiser
          </h1>
          <p className="text-lg leading-relaxed text-zinc-700 dark:text-zinc-300">
            Research and explanation tool for the Japan Crude Cocktail — the volume-weighted
            CIF average of all crude oil that clears Japanese customs each month.
          </p>
        </header>

        <section className="space-y-3 text-zinc-700 dark:text-zinc-300">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Coming surfaces
          </p>
          <ul className="space-y-2 text-base">
            <li>
              <span className="font-mono text-zinc-500 dark:text-zinc-400">/composition</span>
              {" — "}past grades and how the basket has evolved over 10+ years.
            </li>
            <li>
              <span className="font-mono text-zinc-500 dark:text-zinc-400">/grades</span>
              {" — "}per-grade price history, share-over-time, specs, and narrative.
            </li>
            <li>
              <span className="font-mono text-zinc-500 dark:text-zinc-400">/curve</span>
              {" — "}forward curve from CME futures, decomposed into benchmark contributions.
            </li>
          </ul>
        </section>

        <footer className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          See <span className="font-mono">BUILD_SPEC.md</span> for the full specification.
        </footer>
      </div>
    </main>
  );
}

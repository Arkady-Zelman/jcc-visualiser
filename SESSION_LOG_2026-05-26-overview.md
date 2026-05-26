# SESSION_LOG 2026-05-26 — Full session overview

Meta-log covering the entire build of JCC Visualiser, from empty directory to
five product surfaces shipped. The per-milestone logs (M1–M5) record
implementation detail; this document is the narrative thread tying them
together — what was built, what was decided, what was discovered, and what's
deferred.

---

## What JCC Visualiser is

A focused research and explanation tool for the **Japan Crude Cocktail** —
the volume-weighted CIF average of every drop of crude that clears Japanese
customs each month, published by the Petroleum Association of Japan from
MOF / Japan Customs trade data.

Four surfaces ship in v1, all live:

| Route | Purpose |
|---|---|
| `/` | Landing — latest JCC pill + three surface cards |
| `/composition` | How the basket has evolved over 15 years (100% stacked area + treemap + event sidebar) |
| `/grades` | Sortable index of all 54 grades that have appeared in the basket |
| `/grades/[id]` | Per-grade detail — specs, price history, share-over-time, "events that affected this grade" |
| `/curve` | How JCC moves — historical chart + lag-aware regression + 5-stage lag diagram |

---

## Session arc — what happened, in order

### Phase 0 — Planning before code

The user pointed at two reference projects:

- **`everything-claude-code`** for Claude Code practices (skills > commands, hook discipline, MCP context-window hygiene).
- **`Project Japan`** for the *format* of the build spec — numbered sections, locked tech-stack table with explicit NOT-list, milestone checkpoints each ending in **STOP** with operator verification, `compute_runs` audit table, per-session `SESSION_LOG_*.md` files, thin pointer `CLAUDE.md`, working-agreement bullets, "Not in scope" deferral list.

The user was emphatic: lift Project Japan's *format*, not its content. JCC Visualiser is a different, simpler project — no AI agent, no LSM, no forecasting model in v1.

After parallel research subagents investigated the JCC (PAJ methodology, constituent grades, data sources), visualisation patterns (100% stacked area + treemap + sidebar timeline), and infra options (Next.js 16 + Supabase), the stack was locked: **Next.js 16 + Tailwind v4 + shadcn/ui + Recharts + Supabase Postgres (EU) + Python 3.11 ingest + GitHub Actions cron**.

Output: `BUILD_SPEC.md` (~35 KB, 11 sections), `CLAUDE.md` (thin pointer). Both committed at M1.

### Milestone 1 — Scaffold (commit `6b445d3`)

- npm workspace at repo root with `apps/web` + `apps/ingest`.
- Next.js 16.2.6 + React 19 + Tailwind v4 + shadcn (base-nova) in `apps/web`. Single `button.tsx` shadcn component installed; landing page placeholder.
- Python 3.11 venv in `apps/ingest/` with `pydantic`, `httpx`, `pyyaml`, `python-dotenv`, `supabase`, `tenacity`, `sentry-sdk`. `ingest/healthcheck.py` connects to Supabase.
- `vercel.json` cron schedule stubs.
- Supabase project (free tier, EU region) linked.
- **Decision logged**: spec said "Next.js 14" — outdated; create-next-app installed 16.2.6. BUILD_SPEC + CLAUDE.md updated.
- Operator verification: `npm run dev` shows landing, healthcheck connects to Supabase (after the user fixed a URL-format issue — they had pasted the dashboard URL, not the API URL; hardened the healthcheck to catch that case explicitly).

### Milestone 2 — Database + reference data (commit `764da70`)

- `supabase/migrations/001_init.sql` — full DDL for 10 tables (grades, imports_monthly, composition_monthly, jcc_monthly, benchmark_prices_daily, benchmark_forwards_daily, jcc_futures_daily, events, grade_hs_mapping, compute_runs) + 7 indexes + `updated_at` triggers.
- `data/seed/grades.yaml` — 11 curated majors (Murban, Das, Upper Zakum, Arab Light/Medium/Heavy/Extra Light, Oman, Dubai, ESPO, WTI) with API, sulphur, region, type, primary_benchmark, notes.
- `data/seed/grade_hs_mapping.yaml` — 15 mappings for HS 2709.00.900 across 7 origins. UAE split into pre/post-2021 windows (Murban-futures launch). **Iran intentionally unmapped** so the 2018 sanctions collapse renders as a distinct `unmapped_IR` band in `/composition`.
- `data/seed/events.yaml` — 13 curated geopolitical/market events with markdown narratives + source URLs.
- `data/seed/data_dictionary.yaml` — every column, unit, source.
- `apps/ingest/ingest/common.py` — shared helpers: `audit_run`, `upsert`, `validate`, `supabase_client`.
- `apps/ingest/ingest/seed.py` — Pydantic-validated YAML loader, wrapped in `audit_run("seed")`.
- `apps/ingest/ingest/apply_migration.py` — psycopg-based migration applier (didn't end up being used; the user pasted into Supabase SQL editor instead — pooler region sweep + direct host both failed due to IPv4 deprecation).
- **Decision logged**: added `primary_benchmark` column to `grades` (spec said "inferred from notes"; cleaner as a real column).
- Operator verification: 11 grades + 15 mappings + 13 events landed; sample event row inspected.

### Milestone 3 — Ingest (commits `c07c420` + `eaa0487`)

Five ingest scripts, all implementing the §7.2 required behaviours (idempotent UPSERT, Pydantic validation, polite retry, audit, advisory locking):

- **`paj.py`** — scrapes the latest `paj-03E_YYMM.xlsx` from paj.gr.jp. Backfilled **171 rows** of `jcc_monthly` from 2012-01 to 2026-03 in a single fetch (¥/kl + USD/bbl + status). Decision: PAJ Excel scrape is simpler than e-Stat for JCC (no APP_ID required, no statsDataId discovery).
- **`customs.py`** — initial implementation failed because e-Stat's statsDataId guesses were wrong. **First major M3 finding**: discovered empirically that e-Stat publishes Japan trade statistics as one statsDataId per year-range (2011-2015, 2016-2020, 2021-2025, 2026-YTD), and **monthly data is encoded in `cat02`** (Quantity1-January=150, Value-January=170, …, =500) within yearly tables. Also: `@area` codes are 5-digit (`5` + zero-padded MOF code). After fixing both, ingested **2594 rows** of `imports_monthly` from 2011-01 → 2026-03.
- **`benchmarks.py`** — Frankfurter daily JPY/USD FX (**4197 rows**, 2010-01 → today), EIA WTI + Brent spot, EIA WTI 12-contract forward curve.
- **`jcc_futures.py`** — **second major M3 finding: CME blocks scraping by IP.** CmeWS endpoints return *"This IP address is blocked due to suspected web scraping activity associated with it on this CMEgroup.com page."* OPEC's page is similarly Cloudflare-protected. Result: `jcc_futures_daily` empty, ESPO / Arab OSP / Murban deferred to v1.5 with documented placeholder rows in `compute_runs`.
- **`derive_composition.py`** — joins imports_monthly + grade_hs_mapping into composition_monthly. **Third major M3 finding**: PostgREST silently caps requests at 1000 rows; my `chunk=10000` was getting truncated, only processing the first 1000 imports (2011-2015 only). After fixing to `chunk=1000` with proper pagination, derived **3131 composition rows** across **183 months × 54 grades** (11 named + 43 synthetic `unmapped_<origin>` buckets).

**M4 acceptance signals verified at end of M3 SQL queries:**
- Iran (`unmapped_IR`) share collapses 5–9% → 0% post-May 2018 ✓
- Latest basket (2026-03): Arab Light 24% + Murban 24%, ME ~91% ✓
- Russia (ESPO) declines from ~5% pre-invasion to <1% by 2023 ✓
- Monthly volumes 11–14 M kl, matching Japan's known ~10–12 M kl crude imports ✓

Infrastructure: `apps/web/src/app/api/cron/{4 routes}` as acknowledge-only stubs (real ingest runs on GitHub Actions). `.github/workflows/ingest.yml` with five cron triggers + `workflow_dispatch`. Sentry installed in Next.js (enabled flag gated on DSN, no-ops without).

### Milestone 4 — Composition + Grades + Annotations (commit `29ef696`)

Three product surfaces, all SSG-prerendered:

- **`/composition`** — 100% stacked area chart, **3 view modes** (by grade / origin / region) pre-computed server-side, **date scrubber** driving a treemap snapshot panel, **event sidebar** with hover→ReferenceLine cross-talk. State colocated in `composition-view.tsx`; `useDeferredValue` on the scrubber for a smooth treemap.
- **`/grades`** — sortable 9-column table of all 54 grades.
- **`/grades/[gradeId]`** — `generateStaticParams` pre-renders all 54 detail pages. Per-grade specs, price history line (only when `primary_benchmark` ∈ `{wti, brent}` — graceful empty state otherwise), share-over-time sparkline, "events that affected this grade" filtered by `impact_grades`.

**Critical M4 finding**: Supabase's new publishable (anon) key grants **zero read access** to user tables without explicit RLS policies. Adding RLS purely to enable public reads for a single-operator dashboard is overkill — switched server-side reads to use the **service-role key** (server-only, never in the browser bundle). This was the M4 unblocker; before the switch, all pages rendered the 404-fallback because every query returned `[]`.

**Other M4 decisions:**
- `apps/web/.env.local` symlinks to project-root `.env.local` so `next build` from `apps/web/` sees the right file.
- `generateStaticParams` resilient to missing env (returns `[]`, fall back to dynamic).
- Pre-computed all three view-mode pivots server-side.
- No TanStack Query / Zustand — colocated state.
- Markdown via `react-markdown` for event narratives.

All six M4 acceptance signals verified end-to-end against the production build.

### Milestone 5 — `/curve` (commit `dc8fe1c`)

Adapted from spec — M3 found CME / ICE / DME futures are paywalled. `/curve` became **"How the JCC price moves"**: an honest historical view rather than a market-implied forward curve.

Page composition:
1. JCC historical line chart (162 months, ¥/kl ↔ $/bbl toggle, hoverable event sidebar).
2. **Lag-aware JCC ~ Brent + WTI regression** — fitted on monthly observations with a 2-month structural lag baked in.
3. Implied next-month forecast.
4. 5-stage lag diagram (Physical lift → Customs clearance → PAJ provisional → PAJ revised → LNG indexation).
5. Forward curve placeholder card documenting the v1 gap.

**The M5 unblocker**: unlagged regression predicted JCC at **$115/bbl** for 2026-04, vs last published $68.73. Empirical check showed JCC[M] tracks Brent[M-2], not Brent[M]: in our 2026-Hormuz reality Brent has spiked to $114 but JCC is still reflecting cargoes loaded ~2 months prior at Brent ~$67. Adding `LAG_MONTHS = 2` to the alignment:
- R² climbed from **0.903 → 0.964**
- Equation: `JCC ≈ 0.975·Brent + 0.024·WTI + 2.04`
- Forecast for 2026-04: **$72.68/bbl · ¥72,439/kl** (+7% vs 2026-03 — credible)

Hand-rolled multivariate OLS in `apps/web/src/lib/regression.ts` (~40 lines, Gauss-Jordan with partial pivoting; zero dependencies). `apps/web/src/lib/curve.ts` for monthly aggregation + lagged alignment.

---

## Decisions threaded across the session

Three families of decisions shaped how the v1 turned out:

### A. Data-source reality vs spec

The spec assumed access to CME (JCC, Dubai), ICE (Brent forwards, Murban via IFAD), DME (Oman), and Argus (ESPO). M3 found:

- **CME blocks scraping by IP** (hard wall, not solvable without a paid feed).
- **ICE / IFAD / DME** require subscriptions for any forward-curve historical data.
- **Argus** is paywalled, and post-2022 ESPO is also sanctions-complicated.
- **OPEC's public basket page is Cloudflare-protected** — needs Playwright to bypass; deferred to v1.5.
- **Saudi Aramco Arab OSPs** are monthly press-release scrapes — feasible but brittle; deferred to v1.5.

What v1 actually has, healthy and current:
- PAJ JCC monthly (171 months 2012-01 → 2026-03)
- Japan Customs imports (2594 rows 2011-01 → 2026-03, via e-Stat after the year-range + cat02 + area-prefix discoveries)
- EIA WTI + Brent spot (5000 rows each, through today)
- Frankfurter JPY/USD FX (4197 rows, through today)

This is enough for the four product surfaces to deliver real explanatory power. Where data is missing (Murban / Dubai / ESPO daily prices, JCC forwards), the v1 pages render documented empty states rather than fake numbers.

### B. Schema and parser discoveries — not guessable from documentation

- e-Stat publishes one `statsDataId` per year-range, not one monthly table — discovered via `getStatsList`.
- Monthly data lives in `cat02` codes 150–500, not in `time`.
- e-Stat's `@area` codes are 5-digit (`5` + zero-padded MOF code).
- PostgREST silently caps requests at 1000 rows — `chunk=10000` was getting truncated.
- Supabase's publishable (anon) key grants no SELECT without RLS policies — service-role key is the right server-side choice for a single-operator v1.
- Next.js's `loadEnvConfig` runs in `process.cwd()` — when invoked via the workspace script, that's `apps/web/`, not the repo root. Symlinking `.env.local` keeps one source of truth.
- JCC has a ~2-month structural lag from physical cargoes to published value — contemporaneous regression mispredicts under fast moves (e.g. the 2026 Hormuz spike).

### C. Pragmatic v1 simplifications

- **No AI agent / strategy lab / backtest engine** in v1 (per user direction).
- **No TanStack Query / Zustand** — colocated state.
- **Hand-rolled OLS, not `ml-regression-multivariate-linear`** — 40 lines beats a 5KB dep for one regression.
- **`react-markdown` rather than a custom renderer** — small, well-trusted.
- **Vercel cron routes are acknowledge-only stubs**; real ingest runs on GitHub Actions for unlimited runtime.
- **Sentry installed but source-map upload deferred to M6 polish**.
- **`grade_hs_mapping.yaml` is best-effort** (UAE 60/15/25 post-2021, Saudi 50/20/15/15, etc.). Refinable as we cross-check against Vortexa / JOGMEC.

---

## Repository state at end of session

```
JCC Visualiser/
├── BUILD_SPEC.md                  # source of truth, ~35 KB
├── CLAUDE.md                      # thin pointer; status = "M5 shipped"
├── README.md
├── SESSION_LOG_2026-05-22-M1.md
├── SESSION_LOG_2026-05-26-M2.md
├── SESSION_LOG_2026-05-26-M3.md
├── SESSION_LOG_2026-05-26-M4.md
├── SESSION_LOG_2026-05-26-M5.md
├── SESSION_LOG_2026-05-26-overview.md   ← this file
├── .env.local                     # populated
├── .env                           # populated (Python ingest)
├── apps/
│   ├── web/                       # Next.js 16 + React 19 + Tailwind v4 + shadcn
│   │   ├── src/app/
│   │   │   ├── page.tsx, layout.tsx
│   │   │   ├── composition/{page,loading,error}.tsx
│   │   │   ├── grades/{page,loading,error}.tsx
│   │   │   ├── grades/[gradeId]/{page,loading,error,not-found}.tsx
│   │   │   ├── curve/{page,loading,error}.tsx
│   │   │   └── api/cron/{4 routes}/route.ts + _shared/auth.ts
│   │   ├── src/components/
│   │   │   ├── ui/{13 shadcn components}
│   │   │   ├── composition/{composition-view, date-scrubber, view-mode-toggle}.tsx
│   │   │   ├── charts/{composition-area-chart, composition-treemap, grade-price-chart, share-sparkline}.tsx
│   │   │   ├── grades/grades-table.tsx
│   │   │   ├── events/{event-timeline-sidebar, event-card}.tsx
│   │   │   └── curve/{jcc-history-chart, regression-card, jcc-brent-scatter, forecast-card, lag-diagram, forward-curve-placeholder}.tsx
│   │   ├── src/lib/{supabase/{server,client}, composition, curve, colors, regression, utils}.ts
│   │   ├── src/types/db.ts        # generated
│   │   ├── sentry.{client,server,edge}.config.ts + src/instrumentation.ts
│   │   ├── vercel.json
│   │   └── package.json           # recharts, @supabase/ssr, @supabase/supabase-js, @sentry/nextjs, react-markdown, …
│   └── ingest/                    # Python 3.11
│       ├── ingest/{paj,customs,benchmarks,jcc_futures,derive_composition,seed,healthcheck,apply_migration,common,__init__}.py
│       ├── tests/{test_paj,test_customs,test_benchmarks,test_derive_composition}.py + fixtures/
│       ├── pyproject.toml
│       └── .venv/
├── supabase/migrations/001_init.sql
├── data/seed/{grades,grade_hs_mapping,events,data_dictionary,mof_country_codes}.yaml
└── .github/workflows/ingest.yml
```

Commit graph:

```
dc8fe1c Milestone 5 — /curve (How the JCC price moves)
29ef696 Milestone 4 — Composition + Grades surfaces + Annotations
eaa0487 M3 fixes after operator verification
c07c420 Milestone 3 — Ingest
764da70 Milestone 2 — Database + reference data
6b445d3 Milestone 1 — Scaffold
```

---

## Live verification — how to run the app

```bash
cd "/Users/arkadyzelman/Desktop/Cursor Projects/JCC Visualiser"
npm install
npm run build      # builds Next.js with 54 grade pages SSG-prerendered
npm run start      # production server on http://localhost:3000
# (or: npm run dev for hot reload)
```

The dev server was running at the time of writing this log.

Tour:

- **`/`** — landing with latest JCC pill (¥67,695/kl · $68.73/bbl · provisional · 2026-03) + three surface cards.
- **`/composition`** — 100% stacked area covering 2011–2026. Sidebar event hover: "US withdraws from JCPOA — Iran sanctions snapback" (May 2018) draws a red dashed line; `unmapped_IR` band visibly collapses in the months that follow. Toggle "By region": Russia band visible 2021–2022, declines through 2022–2023. Treemap on 2026-03: Arab Light + Murban dominate.
- **`/grades`** — sort by latest share desc; Arab Light + Murban top.
- **`/grades/wti`** — full EIA spot price line from 2010, share sparkline rising post-2016.
- **`/grades/murban`** — graceful "Daily price data not in v1" empty state; share sparkline shows the rise from 2014.
- **`/grades/unmapped_IR`** — synthetic bucket badge + share sparkline showing the 2018 collapse.
- **`/curve`** — JCC historical chart, regression card (`JCC ≈ 0.975·Brent + 0.024·WTI + 2.04`, R² = 0.964), forecast for 2026-04 ($72.68/bbl, +7%), 5-stage lag diagram, forward-curve placeholder.

---

## What's deferred to v1.5+

| Deferred | Why | Hint for unlocking |
|---|---|---|
| CME JCC futures | IP-blocked scraping | Paid CME Market Data feed |
| Dubai / Oman / Murban / Brent forward curves | ICE / DME / IFAD subscriptions | Paid feed |
| ESPO daily price | Argus paywall + post-2022 sanctions | Paid Argus or restored archive |
| Arab Light/Medium/Heavy/EL OSP | Brittle press-release scraping | Aramco-press parser, monthly |
| OPEC reference basket | opec.org Cloudflare interstitial | Playwright + headless browser |
| WTI forward refresh | Our `benchmark_forwards_daily` ended 2024-04 | EIA `PET.RCLC*.D` may have been retired; investigate at M6 |
| Promote frequent unmapped buckets | Indonesia, Vietnam, Australia, Malaysia, Ecuador, Kuwait all show non-trivial share | Add `grades.yaml` + `grade_hs_mapping.yaml` entries |
| Widen `impact_grades` on events | Iran 2018 should also tag `unmapped_IR`; Russia 2022 should tag `unmapped_RU` | Edit `events.yaml`, re-run `seed.py` |
| Sentry source-map upload | `withSentryConfig` not wrapping `next.config.ts` | M6 polish |
| Mobile responsiveness | Layout is desktop-first | M6 polish |
| Lighthouse ≥ 90 on `/composition` | Not measured | M6 polish |
| AI Analyst tab | Out of v1 scope per user direction | Possible v2 |
| Forecasting beyond the regression | Out of v1 scope | Possible v2 |

---

## Open follow-ups going into M6

- Walk all four surfaces in a browser session, confirm acceptance signals.
- Refresh `benchmark_forwards_daily` (investigate whether EIA `PET.RCLC*.D` is still live).
- Wrap `next.config.ts` with `withSentryConfig` for source-map upload.
- Mobile pass on `/composition` and `/grades/[id]`.
- Lighthouse audit.
- README updated with the demo walkthrough.
- Maybe push the repo to GitHub and confirm the `.github/workflows/ingest.yml` triggers cleanly.

---

## Notable shaping decisions baked into the codebase

Future-me reading this should know:

1. **Service-role key is used server-side** in `apps/web/src/lib/supabase/server.ts`. Not the anon key. Switch to anon + RLS only when auth is added.
2. **`fetchAll<Row>(buildQuery)`** in `apps/web/src/lib/supabase/server.ts` paginates past the 1000-row PostgREST cap. Use it for any large select.
3. **`apps/web/.env.local` symlinks to project-root `.env.local`.** Don't delete the symlink.
4. **`generateStaticParams` returns `[]` if Supabase env is missing** (CI / fresh-clone safe).
5. **`composition_monthly`** is the long-format truth; the three pivots (`grade` / `origin` / `region`) are computed server-side in `apps/web/src/lib/composition.ts`.
6. **`LAG_MONTHS = 2`** in `apps/web/src/lib/curve.ts` controls both the regression fit and the forecast. Documented; bump if a different lag fits a future regime better.
7. **Iran is intentionally unmapped** in `data/seed/grade_hs_mapping.yaml` — the 2018 collapse story depends on it surfacing as a distinct band.
8. **The Vercel cron stubs are acknowledge-only**; real ingest is in `.github/workflows/ingest.yml`.
9. **CME / ICE / DME / IFAD data is paywalled and inaccessible from v1.** Don't write code that assumes their endpoints work.
10. **Markdown rendering uses `react-markdown`**, not a custom renderer.

If you only read one other doc, read `BUILD_SPEC.md`. If you read two, add `SESSION_LOG_2026-05-26-M3.md` (M3 is where most of the data-source reality was discovered).

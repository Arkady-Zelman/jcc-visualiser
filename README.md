# JCC Visualiser

Research and explanation tool for the Japan Crude Cocktail (JCC) — the volume-weighted CIF average of all crude oil that clears Japanese customs each month (published monthly by the Petroleum Association of Japan from MOF / Customs data).

Four surfaces over one Postgres DB:

- `/composition` — past crude grades in the JCC basket and how the mix has evolved month-by-month over 10+ years.
- `/grades` + `/grades/[id]` — individual constituent grades: price history, share-over-time, specs, and events that affected them.
- `/curve` — "How the JCC price moves." Full JCC history with event annotations, a lag-aware Brent + WTI regression (R² = 0.964 with a 2-month structural lag), an implied next-month JCC forecast, and a 5-stage lag diagram from physical lift to LNG indexation.
- `/` — landing with three surface cards.

See `BUILD_SPEC.md` for the full specification (source of truth) and `CLAUDE.md` for the working agreement with Claude Code.

## Status

**Milestones 1–6 shipped.** Ready to demo.

- M1 Scaffold — Next.js 16 + React 19 + Tailwind v4 + shadcn (base-nova) + Python 3.11 ingest venv.
- M2 Database — 10 tables in Supabase (`eu-west-2`), 11 grades + 15 HS mappings + 13 events seeded.
- M3 Ingest — PAJ JCC values, Japan Customs imports, Frankfurter FX + EIA WTI/Brent spot. Composition derived.
- M4 Composition + Grades + Annotations — three live routes, 54 grade detail pages SSG-prerendered.
- M5 Curve (adapted) — lag-aware regression replaces the spec's CME-futures decomposition (CME / ICE futures are paywalled).
- M6 Polish — Sentry source-map upload wired, mobile responsiveness, per-coefficient standard errors + residuals panel, expanded event impact tags, README + walkthrough.

## Setup

### 1. Frontend

```bash
nvm use                # uses .nvmrc (node 20)
npm install
cp .env.local.example .env.local   # fill in Supabase + Sentry + CRON_SECRET
npm run dev                        # http://localhost:3000
```

Required env (`/.env.local`, symlinked from `apps/web/.env.local`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SENTRY_DSN=...            # optional; Sentry no-ops without it
SENTRY_ORG=...            # optional; required only for source-map upload
SENTRY_PROJECT=...        # optional; required only for source-map upload
SENTRY_AUTH_TOKEN=...     # optional; required only for source-map upload at build
CRON_SECRET=...           # used by /api/cron/* handlers
```

### 2. Python ingest

Requires Python 3.11.

```bash
cd apps/ingest
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp ../../.env.example .env    # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + EIA_API_KEY + ESTAT_APP_ID
python -m ingest.healthcheck
```

### 3. Supabase

Create a free-tier project in the `eu-west-2` region at <https://supabase.com>. Copy the project URL, anon key, and service-role key into the two `.env` files above. Apply `supabase/migrations/001_init.sql` (either via `npx supabase db push` once the project is linked, or by pasting the SQL into the Supabase SQL editor).

## Deploy to Vercel

1. **Link the repo**: `vercel link` from the project root, or import via the Vercel dashboard.
2. **Set env vars** in the Vercel project settings (Project → Settings → Environment Variables). Same list as `.env.local` above, plus `SENTRY_AUTH_TOKEN` to activate source-map upload.
3. **Build settings** — Vercel auto-detects Next.js 16. Root directory: `apps/web`. Install command: `npm install` (workspace). Build: `next build`. Output: `.next`.
4. **Cron jobs** — `vercel.json` (or Vercel's Cron Jobs UI) calls the `/api/cron/ingest-*` handlers on the cadence documented below. Each handler is gated on `CRON_SECRET`.
5. **Deploy** — `git push` to `main` triggers a production deploy; PRs get preview URLs.

The GitHub Actions fallback in `.github/workflows/ingest.yml` covers the same cron schedule if you'd rather run ingest from there; just populate the GitHub Secrets with the same values.

## Data refresh cadence

| Job | Cadence | Source | Notes |
|---|---|---|---|
| `paj` | Monthly, 8th | paj.gr.jp Excel scrape | PAJ publishes provisional ~25 days after month end |
| `customs` | Monthly, mid-month | e-Stat API | Japan Customs trade statistics; ~6 week lag |
| `benchmarks` | Daily, 06:00 UTC | Frankfurter (FX), EIA (WTI/Brent spot) | EIA `PET.RCLC*.D` futures retired 2024-04 |
| `derive_composition` | After `customs` | Joins `imports_monthly` + `grade_hs_mapping` | Idempotent; safe to re-run |
| `jcc_futures` | Daily, 22:00 UTC | DEFERRED — CME blocks scraping | Stub logs the gap to `compute_runs` |

The `compute_runs` table audits every job. To check freshness without leaving Supabase:

```sql
select max(month) from jcc_monthly;            -- expect within 60 days
select max(date) from benchmark_prices_daily where benchmark = 'wti';  -- expect within 7 days
select kind, status, started_at, row_count from compute_runs order by started_at desc limit 20;
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (includes Sentry source-map upload when `SENTRY_AUTH_TOKEN` is set) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `python -m ingest.healthcheck` | Connect to Supabase and print server version |
| `python -m ingest.<job>` | Run an ingest job locally (`paj`, `customs`, `benchmarks`, `jcc_futures`, `derive_composition`, `seed`) |

## Troubleshooting

- **Server reads return `[]`** — Supabase anon key has no read access without RLS policies. Server-side reads must use `SUPABASE_SERVICE_ROLE_KEY`. The web app already does this via `apps/web/src/lib/supabase/server.ts`.
- **Next build "missing env" in CI / fresh clones** — `apps/web/.env.local` is a symlink to project-root `.env.local`. Recreate with `ln -s ../../.env.local apps/web/.env.local`. `generateStaticParams` in `grades/[gradeId]/page.tsx` degrades gracefully when env is missing (returns `[]`).
- **PostgREST results capped at 1000 rows** — long tables (`composition_monthly`, `benchmark_prices_daily`) need pagination. Use `fetchAll()` from `apps/web/src/lib/supabase/server.ts` (server) or `chunk=1000` in Python ingest (`derive_composition.py`).
- **e-Stat ingest fails with "no data"** — the env var is `ESTAT_APP_ID` (not `ESTAT_API_ID`). Monthly customs data is encoded in `cat02` codes 150–500, not the `time` dimension. Area codes are prefixed with `5` + zero-pad ("50137" → MOF "137") — `_strip_area_prefix()` in `customs.py` handles this.
- **EIA WTI futures stale** — `PET.RCLC*.D` series retired 2024-04. No replacement in v1.5; would require a paid CME data feed.
- **Sentry "no auth token" warning at build** — expected when `SENTRY_AUTH_TOKEN` is not set. Source-map upload silently no-ops; runtime error capture still works.

## Milestones

See `BUILD_SPEC.md` §12 for the full milestone plan. Per-milestone session logs in `SESSION_LOG_*.md` capture what was built and what was decided.

- M1–M6 — shipped.
- v1.5 candidates (not blocking demo): paid feeds (CME / ICE / DME / Argus), Dubai/Oman/Murban historical price series, ESPO daily, Arab OSP scraper, residuals interactive slider, "What-if Brent = $X" forecast slider.

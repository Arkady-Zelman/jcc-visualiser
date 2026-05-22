# JCC Visualiser

Research and explanation tool for the Japan Crude Cocktail (JCC) — the volume-weighted CIF average of all crude oil that clears Japanese customs each month.

Four surfaces:

- `/composition` — past crude grades in the JCC basket and how the mix has evolved over time.
- `/grades` — individual constituent grades with price history, share-over-time, and specs.
- `/curve` — current JCC forward curve from CME futures, recent-weeks overlay, decomposition into Dubai/Oman/Murban/Brent contributions.
- `/` — landing with latest JCC value, composition snapshot, curve thumbnail, recent events.

See `BUILD_SPEC.md` for the full specification (source of truth) and `CLAUDE.md` for the working agreement with Claude Code.

## Status

Milestone 1 — Scaffold. Frontend skeleton + Python ingest skeleton + Supabase project linkage. No data yet.

## Setup

### 1. Frontend

```bash
nvm use                # uses .nvmrc (node 20)
npm install
cp .env.local.example .env.local   # then fill in Supabase + Sentry + CRON_SECRET
npm run dev            # http://localhost:3000
```

### 2. Python ingest

Requires Python 3.11 (`brew install python@3.11` on macOS).

```bash
cd apps/ingest
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp ../../.env.example .env         # then fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
python -m ingest.healthcheck       # should print Supabase server version
```

### 3. Supabase

Create a free-tier project in the `eu-west-2` region at <https://supabase.com>. Copy the project URL, anon key, and service-role key into the two `.env` files above. Migrations land in `supabase/migrations/` (populated at Milestone 2).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `python -m ingest.healthcheck` | Connect to Supabase and print server version |
| `python -m ingest.<job>` | Run an ingest job locally (`paj`, `customs`, `benchmarks`, `jcc_futures`, `derive_composition`) — available from Milestone 3 onward |

## Milestones

See `BUILD_SPEC.md` §12. Six milestones, each ending in a STOP gate with operator verification.

- M1 — Scaffold (current)
- M2 — Database + reference data
- M3 — Ingest
- M4 — Composition + Grades surfaces + Annotations
- M5 — Forward curve surface
- M6 — Polish

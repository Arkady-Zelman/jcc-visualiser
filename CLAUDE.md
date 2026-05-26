# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Status

**Milestone 5 shipped.** `/curve` is live as "How the JCC price moves" — JCC historical chart with event annotations, lag-aware JCC ~ Brent + WTI regression (R² = 0.964 with 2-month structural lag), implied next-month JCC forecast, 5-stage lag diagram, and a documented placeholder for the missing market forward curve. Adapted from the spec's original design after M3 found CME / ICE futures are paywalled.

Done so far:
- **M1 Scaffold** — Next.js 16 + React 19 + Tailwind v4 + shadcn (base-nova) + Python 3.11 ingest venv.
- **M2 Database** — 10 tables in Supabase (eu-west-2), 11 grades + 15 HS mappings + 13 events seeded.
- **M3 Ingest** — PAJ JCC values (171 months), Japan Customs imports (2594 rows), Frankfurter FX + EIA WTI/Brent spot + WTI futures (~30K rows). Composition derived to 3131 rows across 183 months × 54 grades.
- **M4 Composition + Grades + Annotations** — 3 routes live, 54 grade detail pages SSG-prerendered.
- **M5 Curve (adapted)** — `/curve` page with lag-aware regression, historical chart, forecast card, lag diagram, forward-curve placeholder.

Deferred to v1.5 (not blocking demo):
- Daily CME JCC futures, Dubai, Oman, Murban — paywalled feeds.
- ESPO daily price — Argus-paywalled.
- Arab OSP monthly proxies — needs Aramco press-release scraper.
- Sentry source-map upload (`withSentryConfig`).

**Read `BUILD_SPEC.md` end-to-end before writing any code** — it is the source of truth for schema, sources, units, surfaces, and milestone gating. The spec is non-negotiable on schema, units, and grade-mapping decisions; minor naming and structure choices may be decided locally.

## Product

JCC Visualiser — a focused research and explanation tool for the Japan Crude Cocktail (JCC), the volume-weighted CIF average of all crude oil clearing Japanese customs each month (published monthly by the Petroleum Association of Japan from MOF / Customs data).

Four surfaces over one Postgres DB:

1. **Composition** (`/composition`) — past basket of grades and how it has evolved month-by-month over 10+ years.
2. **Grades** (`/grades`, `/grades/[id]`) — index + per-grade detail with price history, share-over-time, and physical specs.
3. **Annotations** — curated event timeline layered onto Composition and Grades, explaining *why* the basket looks the way it does at any moment (sanctions, OPEC+ decisions, contract launches, etc.).
4. **Forward curve** (`/curve`) — current JCC futures curve from CME, multi-week overlay, decomposition into Dubai / Oman / Murban / Brent contributions plus residual basis, and a static lag-structure diagram.

Plus a thin `/` landing.

## Architecture

Simple npm workspace, two apps:

- **`apps/web/`** — Next.js 16 App Router (TS strict), React 19, Tailwind v4, shadcn/ui, Recharts. Server Components by default; cron endpoints under `src/app/api/cron/`. Deployed to Vercel (auto region). **Read `apps/web/AGENTS.md` before editing Next-specific code** — Next 16 has APIs and conventions that diverge from older training data.
- **`apps/ingest/`** — Python 3.11 (`pyproject.toml`, `.venv`). Five jobs: `paj`, `customs`, `benchmarks`, `jcc_futures`, `derive_composition`. Pydantic validation, `httpx`, idempotent UPSERT into Supabase via service-role key, audited to `compute_runs`. Run monthly via Vercel Cron (mechanism finalised at M3; GitHub Action cron is the fallback).

Supabase Postgres (free tier, `eu-west-2`). No RLS in v1 (single-operator dashboard). Curated YAMLs in `data/seed/` are the editorial layer — `grades.yaml`, `grade_hs_mapping.yaml`, `events.yaml`, `data_dictionary.yaml`.

## Stack constraints (do not deviate without amending the spec)

Explicitly **not** in v1: AI agent, LLM tooling, strategy lab, backtesting, ML forecasting, per-user accounts / RLS, alerts, Modal, Prefect, Airflow, LangChain, TimescaleDB, DuckDB, Redis, Plotly, Platts/Argus paid feeds, real-time updates, public API, Tokyo region lock, sub-grade resolution beyond the curated ~10 majors.

Validation at every boundary: Pydantic in Python, zod in TypeScript. No untyped data crosses a process boundary. Wrap every external HTTP call (PAJ, e-Stat, Customs, CME, ICE, EIA, OPEC, Frankfurter) in try/except with audit logging to `compute_runs`.

## Critical gates

- **M2 reference data:** `grade_hs_mapping.yaml` must cover the top contributors to the JCC import mix or `composition_monthly` will be dominated by `unmapped_<country>` buckets in M4. Initial curation is best-effort and refinable; the gate is "is the unmapped share defensible — i.e. small or concentrated in genuinely minor exotic origins."
- **M3 ingest:** `select max(month)` on every monthly table within 60 days of today; `select max(date)` / `max(settlement_date)` on every daily table within 5 days of today. `compute_runs` shows no error runs since the last clean ingest. **This is the first place real data quality matters; do not proceed to M4 if any source is silently truncated.**
- **M4 composition:** the chart must show a visible Iran share collapse in mid-2018 and a Russia share inflection around 2022–2023. If those signature events do not show up, either the data is wrong or the mapping is wrong — investigate before declaring M4 done.

## Milestone discipline

`BUILD_SPEC.md` §12 defines 6 sequential milestones (Scaffold → Database+reference → Ingest → Composition+Grades+Annotations → Curve → Polish), each ending in **STOP** — commit with a descriptive message naming the milestone, write a `SESSION_LOG_YYYY-MM-DD-Mx.md`, tell the operator exactly how to verify, wait for confirmation before continuing. Never blast through.

## Environment

Keys are populated by the operator in `.env.local` (Next.js, repo root) and `apps/ingest/.env`. Full list in spec §3. Never hardcode keys.

## Commands

- `npm run dev` — Next.js dev server at http://localhost:3000.
- `cd apps/ingest && .venv/bin/python -m ingest.healthcheck` — verify Supabase connectivity.
- `cd apps/ingest && .venv/bin/python -m ingest.<job>` — run any ingest job locally (`paj`, `customs`, `benchmarks`, `jcc_futures`, `derive_composition`, `seed`).
- `npx supabase db push` — apply migrations to the linked Supabase project (or paste `001_init.sql` into the Supabase SQL editor).

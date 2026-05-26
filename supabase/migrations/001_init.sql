-- =========================================================
-- 001_init.sql — JCC Visualiser schema
-- =========================================================
-- See BUILD_SPEC.md §5. Units are non-negotiable:
--   ¥/kl for JCC official price (Japan's native unit)
--   USD/bbl for benchmark spot and futures
--   % for shares
--   kl (kilolitres) for volumes  (1 bbl = 0.158987 kl)
-- No RLS in v1 — single-operator dashboard.

-- Reference: crude grades that have ever appeared in the JCC basket.
create table grades (
  id                 text primary key,                 -- snake_case slug, e.g. 'murban'
  display_name       text not null,                    -- 'Murban'
  origin_country     text not null,                    -- ISO 3166-1 alpha-2, e.g. 'AE'
  region             text not null check (region in ('middle_east','russia','americas','africa','asia_pacific','europe','other')),
  api_gravity        numeric(5,2),                     -- degrees API
  sulphur_pct        numeric(5,3),                     -- weight %
  type               text not null check (type in ('light_sweet','light_sour','medium_sweet','medium_sour','heavy_sweet','heavy_sour')),
  primary_benchmark  text,                             -- benchmark code used for the grade's price line (e.g. 'murban', 'arab_light')
  first_seen_in_jcc  date,                             -- populated by derive_composition
  last_seen_in_jcc   date,
  notes              text,                             -- curator notes
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Raw Japan Customs monthly imports. One row per (month, HS code, origin).
create table imports_monthly (
  month           date not null,                    -- first-of-month UTC
  hs_code         text not null,                    -- e.g. '2709.00.900'
  origin_country  text not null,                    -- ISO 3166-1 alpha-2
  volume_kl       numeric(14,3) not null,
  value_jpy       numeric(18,0) not null,           -- CIF value in JPY
  source          text not null default 'customs',
  ingested_at     timestamptz not null default now(),
  primary key (month, hs_code, origin_country)
);

-- Derived: composition of the JCC basket by grade for each month.
-- Populated by derive_composition.py joining imports_monthly with grade_hs_mapping.
create table composition_monthly (
  month           date not null,
  grade_id        text not null references grades(id),
  volume_kl       numeric(14,3) not null,
  value_jpy       numeric(18,0) not null,
  share_pct       numeric(6,3) not null,            -- volume share of the month's basket, 0–100
  source          text not null default 'derived',
  ingested_at     timestamptz not null default now(),
  primary key (month, grade_id)
);

-- Official JCC monthly value as published by PAJ.
create table jcc_monthly (
  month                  date primary key,
  jcc_value_jpy_per_kl   numeric(12,2) not null,
  jcc_value_usd_per_bbl  numeric(10,4),              -- derived using monthly avg FX
  status                 text not null check (status in ('provisional','revised','final')),
  source                 text not null default 'paj',
  source_url             text,
  ingested_at            timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Daily benchmark spot / settlement prices.
create table benchmark_prices_daily (
  date            date not null,
  benchmark       text not null check (benchmark in ('dubai','oman','murban','brent','wti','arab_light','arab_medium','arab_heavy','arab_extra_light','espo','opec_basket','jpy_usd_fx')),
  price_usd_bbl   numeric(10,4) not null,           -- for FX row this stores JPY per USD
  source          text not null,                    -- 'cme', 'ice', 'eia', 'opec', 'frankfurter'
  ingested_at     timestamptz not null default now(),
  primary key (date, benchmark)
);

-- Daily benchmark forward curve snapshots.
create table benchmark_forwards_daily (
  settlement_date date not null,                    -- date the settlement was taken
  benchmark       text not null check (benchmark in ('dubai','oman','murban','brent','wti')),
  contract_month  date not null,                    -- first-of-month for the contract delivery month
  price_usd_bbl   numeric(10,4) not null,
  source          text not null,
  ingested_at     timestamptz not null default now(),
  primary key (settlement_date, benchmark, contract_month)
);

-- Daily CME JCC futures settlement curves.
create table jcc_futures_daily (
  settlement_date date not null,
  contract_month  date not null,
  price_usd_bbl   numeric(10,4) not null,
  open_interest   integer,
  volume          integer,
  source          text not null default 'cme',
  ingested_at     timestamptz not null default now(),
  primary key (settlement_date, contract_month)
);

-- Curated geopolitical / market events for annotation.
create table events (
  id              text primary key,                 -- slug, e.g. 'iran_sanctions_snapback_2018'
  date_from       date not null,
  date_to         date,                             -- null = point-in-time event
  category        text not null check (category in ('sanctions','geopolitics','supply_shock','demand_shock','opec_decision','contract_launch','disaster','policy')),
  title           text not null,
  description_md  text not null,                    -- markdown body for hover-card / detail
  impact_grades   text[] not null default '{}',     -- array of grades.id this event affected
  sources         text[] not null default '{}',     -- URLs
  created_at      timestamptz not null default now()
);

-- Curated lookup loaded from data/seed/grade_hs_mapping.yaml.
-- Used by derive_composition.py to split (HS code, origin country) → grades and weights.
-- weight_pct in each (hs_code, origin_country) tuple should sum to 100 within a validity window.
create table grade_hs_mapping (
  hs_code         text not null,
  origin_country  text not null,
  grade_id        text not null references grades(id),
  weight_pct      numeric(5,2) not null,            -- 0–100
  applies_from    date not null,                    -- inclusive
  applies_to      date,                             -- nullable = open-ended
  notes           text,
  primary key (hs_code, origin_country, grade_id, applies_from)
);

-- Audit log of every ingest / derivation run.
create table compute_runs (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null,                  -- 'ingest_paj' | 'ingest_customs' | 'ingest_benchmarks' | 'ingest_jcc_futures' | 'derive_composition' | 'seed'
  status            text not null check (status in ('running','success','error')),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  duration_seconds  numeric(10,2),
  row_count         integer,
  error_message     text,
  output_jsonb      jsonb                           -- free-form per-job structured output
);

-- Indexes that pay for themselves on the read patterns we know about.
create index idx_imports_monthly_origin on imports_monthly(origin_country);
create index idx_composition_monthly_grade on composition_monthly(grade_id);
create index idx_benchmark_prices_daily_benchmark on benchmark_prices_daily(benchmark);
create index idx_benchmark_forwards_settlement_benchmark on benchmark_forwards_daily(settlement_date, benchmark);
create index idx_jcc_futures_settlement on jcc_futures_daily(settlement_date);
create index idx_events_date_from on events(date_from);
create index idx_compute_runs_kind_started on compute_runs(kind, started_at desc);

-- Trigger to keep grades.updated_at and jcc_monthly.updated_at fresh on UPSERT.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger grades_updated_at
  before update on grades
  for each row execute function set_updated_at();

create trigger jcc_monthly_updated_at
  before update on jcc_monthly
  for each row execute function set_updated_at();

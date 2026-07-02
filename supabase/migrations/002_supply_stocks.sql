-- 002_supply_stocks.sql — physical crude supply + oil stockpiling (PAJ workbooks 01E / 05E).
--
-- crude_supply_monthly:  PAJ paj-01E "Supply and Demand of Crude Oil" (source data: METI).
--                        Monthly from 2002-01. All volumes in kl (native workbook unit).
-- oil_stockpile_monthly: PAJ paj-05E "Oil Stockpiling". Monthly from 2017-01.
--                        Workbook publishes 10,000-kl units; the ingest job converts to kl
--                        so every volume column in the database reads in kl.

create table crude_supply_monthly (
  month                    date primary key,
  production_kl            numeric(14,1),
  import_kl                numeric(14,1),
  non_refining_use_kl      numeric(14,1),
  refinery_throughput_kl   numeric(14,1),
  refining_capacity_bpd    numeric(12,1),
  utilization_pct          numeric(5,1),
  end_inventory_kl         numeric(14,1),
  status                   text not null check (status in ('provisional','final')) default 'final',
  source                   text not null default 'paj_01e',
  source_url               text,
  ingested_at              timestamptz not null default now()
);

create table oil_stockpile_monthly (
  month                    date primary key,
  private_crude_kl         numeric(14,1),
  private_products_kl      numeric(14,1),
  private_days             numeric(6,1),
  government_crude_kl      numeric(14,1),
  government_products_kl   numeric(14,1),
  government_days          numeric(6,1),
  status                   text not null check (status in ('provisional','final')) default 'final',
  source                   text not null default 'paj_05e',
  source_url               text,
  ingested_at              timestamptz not null default now()
);

-- =========================================================
-- 003_grade_imports.sql — measured grade-level crude imports
-- =========================================================
-- e-Stat 石油統計 (survey 00551020) publishes MEASURED crude imports by named
-- grade (原油油種別輸入) — the ground truth that grade_hs_mapping.yaml only
-- approximates with fixed weights. One row per (month, oil grade code).
--
-- oil_code is the e-Stat 確報 workbook 油種コード (5 digits: 3-digit MOF
-- country code + 2-digit serial, e.g. '13701' = Saudi Arabia ARAB-L). Rows
-- backfilled from the frozen annual DB table 0003171984 that have no workbook
-- code equivalent use 'a' + the table's cat01 code (e.g. 'a40220' = Iranian
-- Heavy). Volumes are kl, zero-volume template rows are not stored.
--
-- origin_country is ISO 3166-1 alpha-2; 'XZ' (user-assigned range) is used for
-- the Saudi–Kuwait neutral zone (中立地帯, MOF 139) which has no ISO code.

create table grade_imports_monthly (
  month           date not null,                    -- first-of-month UTC
  oil_code        text not null,                    -- e-Stat 油種コード or 'a'+cat01
  oil_name        text not null,                    -- romanized name (ARAB-L) or kana for annual-only grades
  oil_name_kana   text,                             -- 原油名漢字・カナ
  origin_country  text not null,                    -- ISO 3166-1 alpha-2 ('XZ' = neutral zone)
  is_condensate   boolean not null default false,   -- condensate stream (outside HS 2709.00.900 scope)
  volume_kl       numeric(14,3) not null,
  source          text not null check (source in ('estat_kakuho','estat_annual')),
  source_url      text,
  ingested_at     timestamptz not null default now(),
  primary key (month, oil_code)
);

create index idx_grade_imports_monthly_origin on grade_imports_monthly(origin_country);

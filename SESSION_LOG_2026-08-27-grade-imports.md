# Session log — 2026-08-27 — Measured grade-level imports (原油油種別輸入)

## Goal

Evaluate replacing (or cross-checking) the curated `grade_hs_mapping.yaml` fixed
weights behind `/composition` with MEASURED grade-level import data from e-Stat
石油統計: the monthly 確報 workbook's 原油輸入（時系列を含む） sheet (~68 grade
rows/month, rolling 16-month window) plus the frozen annual DB table 0003171984
(monthly grade detail 2007-01 → 2024-03).

## What was built

| Piece | File |
|---|---|
| New table `grade_imports_monthly` (PK `(month, oil_code)`) | `supabase/migrations/003_grade_imports.sql` (applied) |
| 油種コード → curated-grade mapping (25 entries, both e-Stat code spaces) | `data/seed/grade_oil_mapping.yaml` |
| Ingest job (current 確報 + `--backfill`: annual table + archived 確報) | `apps/ingest/ingest/grade_imports.py` |
| Read-only comparison report | `apps/ingest/ingest/compare_composition.py` |
| Unit tests (mapping integrity, parser coercions, condensate heuristic) | `apps/ingest/tests/test_grade_imports.py` — 19/19 suite green |
| Cron wiring (monthly, after `customs`) + docs | `.github/workflows/ingest.yml`, `README.md`, `data/seed/data_dictionary.yaml` |

Source stitching (hard boundaries — the two code spaces never cover the same month):

- annual table 0003171984 → **2007-01 .. 2023-10** (`--backfill`)
- archived 確報 edition 2025-02 (window 2023-11..2025-02) → **2023-11 .. 2025-02** (`--backfill`)
- newest 確報 workbook (auto-discovered, same download path as `paj_supply`'s
  fallback) → **2025-03 → current** (monthly cron)

Backfill ran live: **8,810 rows, 234 contiguous months (2007-01 → 2026-06), 0
Pydantic rejects**. Grade rows reconcile against each sheet's published 合計 row
exactly (verified to the kl for 2026-06: 10,031,150).

## Findings

**1. The measured data is excellent.** Grade rows sum exactly to published totals
in every month of every source. Signature events show up unprompted: Iran
5.2% (2016) → 3.9% (2018) → 0.0% (2020); Russia/espo 3.6% (2021) → 1.3% (2022) →
0% (2024). ~95% of recent volume maps onto the 11 curated grades; the unmapped
residual is small and concentrated in genuinely minor streams (Mubarraz, Umm Lulu,
Ecuador Napo, Khafji) — passes the M2 "defensible unmapped share" gate easily.

**2. The curated fixed weights are materially wrong on the two countries where
they matter most.** Over 126 overlap months (2016-01 → 2026-06), share-of-basket
divergence (measured vs mapping-derived):

| grade | mean measured | mean derived | mean \|Δ\| | max \|Δ\| |
|---|---|---|---|---|
| arab_extra_light | 17.5% | 7.8% | 9.8pp | 17.3pp |
| das | 12.0% | 5.7% | 6.6pp | 15.0pp |
| arab_light | 14.2% | 19.6% | 5.7pp | 13.7pp |
| upper_zakum | 4.2% | 9.1% | 5.0pp | 12.3pp |
| arab_medium | 9.3% | 13.4% | 4.3pp | 11.5pp |
| murban | 15.7% | 18.9% | 4.1pp | 13.1pp |

The Saudi 50/20/15/15 guess inverts reality (Arab **Extra Light**, not Arab Light,
is the largest Saudi stream into Japan); the UAE 60/15/25 guess overweights Upper
Zakum ~5× and halves Das.

**3. Fixed weights fail hardest exactly when the story matters.** June 2026
(Hormuz crisis): measured basket is Murban 34.6% (Fujairah loading bypasses the
strait), WTI 32.3%, Arab Light 21.9%, with Arab Extra Light, Arab Heavy, Upper
Zakum, Oman and all Qatar grades at **zero**. The mapping-derived composition
still shows upper_zakum at 8.9% and arab_heavy at 4.0% that month because it can
only spread country totals by fixed ratios.

**4. Bonus finding — customs `imports_monthly` is truncated for recent months.**
2026-04/05 customs totals are ~4.5M kl vs ~7–12M kl measured, with Kuwait/Qatar
rows entirely absent (partial publication, presumably crisis-related lag). The
e-Stat 確報 series is complete for the same months, so `grade_imports_monthly` is
now also the more reliable *total* for recent months.

Caveats: e-Stat includes condensate streams that HS 2709.00.900 excludes — these
are flagged `is_condensate` and excluded from all comparisons; the Saudi–Kuwait
neutral zone (Khafji, `XZ`) exists only in the measured data (customs drops it —
no ISO code); e-Stat measures refinery/importer receipts vs customs clearance, so
individual months drift a few % on timing (63/126 months differ >5% on totals,
long-run means agree).

## Recommendation

Switch `/composition` to derive from `grade_imports_monthly` (measured) with the
HS-mapping derivation kept as fallback for any month the measured table lacks.
Design notes for that switch (operator decision, not done in this session):

- `composition_monthly.value_jpy` has no measured equivalent (e-Stat publishes
  volume only) — either allocate the customs CIF value pro-rata to measured
  volumes or make the column nullable for measured months.
- Keep the KW→arab_medium and QA→dubai proxies or promote them to first-class
  grades (`kuwait_export`, `qatar_marine`, `al_shaheen`) — the measured data now
  supports per-grade resolution the HS mapping never could.
- `grade_hs_mapping.yaml` remains useful for the value split + as the fallback;
  its weights could also simply be *recalibrated* from measured averages if a
  minimal-change path is preferred.

## How to verify

```bash
cd apps/ingest && .venv/bin/python -m pytest tests/ -q
```

```bash
cd apps/ingest && .venv/bin/python -m ingest.compare_composition
```

- `compare_composition` prints the tables above from live DB data (read-only).
- SQL freshness: `select min(month), max(month), count(*) from grade_imports_monthly;`
  → expect `2007-01-01 | 2026-06-01 | 8810`.
- `compute_runs`: latest `ingest_grade_imports` row has `status='success'`,
  `row_count=8810`, `output_jsonb.backfill=true`.
- Monthly cron: `.github/workflows/ingest.yml` now runs `grade_imports` in the
  customs slot (8th, 09:30 UTC); manual dispatch options `grade_imports` /
  `grade_imports_backfill` added.

**STOP — awaiting operator confirmation** before any switch of the
`/composition` derivation to the measured source.

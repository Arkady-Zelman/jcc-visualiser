# jcc-ingest

Python 3.11 ingest scripts for the JCC Visualiser. See repo-root `BUILD_SPEC.md` §7 for the ingestion pipeline contract.

## Setup

```bash
cd apps/ingest
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # then fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
python -m ingest.healthcheck
```

## Jobs (available from Milestone 3 onward)

| Job | Module | Writes to |
|---|---|---|
| PAJ monthly JCC | `python -m ingest.paj` | `jcc_monthly` |
| Japan Customs imports | `python -m ingest.customs` | `imports_monthly` |
| Benchmark daily prices | `python -m ingest.benchmarks` | `benchmark_prices_daily`, `benchmark_forwards_daily` |
| CME JCC futures | `python -m ingest.jcc_futures` | `jcc_futures_daily` |
| Derive composition | `python -m ingest.derive_composition` | `composition_monthly` |
| Load seed YAMLs | `python -m ingest.seed` | `grades`, `grade_hs_mapping`, `events` |

Every job follows the five required behaviours in `BUILD_SPEC.md` §7.2: idempotent UPSERT, Pydantic validation, polite retry, audit to `compute_runs`, advisory locking.

"""Ingest CME JCC futures daily settlements into `jcc_futures_daily`.

**v1 status: not implemented — CME blocks scraping by IP.**

CME Group's CmeWS endpoints behind the public settlements pages return:

    {"message": "This IP address is blocked due to suspected web scraping
     activity associated with it on this CMEgroup.com page. Use of scripts,
     software, spiders, robots, avatars, agents, tools or other scraping
     mechanisms is strictly prohibited by CME Group's website Data Terms
     of Use..."}

There is no free official feed for CME JCC futures (contract JCC / JCY). Options
for a future implementation:

  - CME paid Market Data API subscription.
  - Manual download of the daily settlement file via the operator's browser,
    followed by a CSV upload script (high-touch, low-cadence).
  - Third-party financial data aggregator with a free tier that licenses CME data
    (Polygon.io, Tiingo — both currently require paid plans for futures).

M5 (forward curve view) needs to adapt. Two reasonable v1 paths:
  1. Render WTI futures curve (`benchmark_forwards_daily` populated via EIA in
     benchmarks.py) as a stand-in, with a documented basis caveat.
  2. Defer /curve entirely to v1.5.

This job logs a structured `compute_runs` row so the gap is visible in the audit
trail, then exits 0. Re-enable by replacing `main()` with a real fetcher once a
data path is secured.

Run: `python -m ingest.jcc_futures` from apps/ingest/ with the venv active.
"""

from __future__ import annotations

import logging
import sys

from ingest.common import audit_run, init_sentry, supabase_client

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main() -> int:
    init_sentry()
    client = supabase_client()

    with audit_run(client, kind="ingest_jcc_futures") as state:
        state["row_count"] = 0
        state["output"] = {
            "status": "deferred",
            "reason": "CME blocks scraping by IP. No free CME futures feed exists.",
            "see_session_log": "SESSION_LOG_2026-05-26-M3.md",
            "recommended_paths_v1.5": [
                "paid CME Market Data API subscription",
                "manual CSV upload from CME settlement page",
                "Polygon.io / Tiingo paid plan with futures licensing",
            ],
            "m5_workaround": "use EIA WTI forward curve from benchmark_forwards_daily as a proxy",
        }
        logger.warning(
            "jcc_futures: no data ingested (CME scrape blocked; see SESSION_LOG_2026-05-26-M3.md)"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())

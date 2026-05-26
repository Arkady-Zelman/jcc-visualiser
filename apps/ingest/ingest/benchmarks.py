"""Ingest daily benchmark prices into `benchmark_prices_daily` and `benchmark_forwards_daily`.

Sources, in order of preference and accessibility:

  ✓ Frankfurter (ECB FX)             — JPY/USD daily. No key required.
  ✓ EIA OpenData API                  — WTI spot, Brent spot, WTI futures curve.
                                        Free, requires EIA_API_KEY (eia.gov/opendata/register.php).
  ✗ OPEC Basket                       — Cloudflare-protected; needs browser automation.
                                        Deferred to v1.5 (skipped here with a logged warning).
  ✗ CME Dubai / JCC futures           — IP-blocked by CME's scraping protection.
                                        Requires a paid CME data feed; out of scope for v1.
                                        See SESSION_LOG_2026-05-26-M3.md for details.
  ⚠ Arab Light/Medium/Heavy/EL OSP    — Monthly OSPs only; scraping Aramco press releases
                                        is brittle. Deferred to v1.5; placeholder source row inserted.
  ⚠ ESPO                              — Argus-paywalled; sanctions-complicated.
                                        Deferred to v1.5; placeholder source row inserted.

What v1 actually delivers:
  - JPY/USD FX history (1999+ via Frankfurter)
  - WTI + Brent daily spot (1986+ via EIA)
  - WTI front 12 futures contracts daily (where EIA has them)

Run: `python -m ingest.benchmarks` from apps/ingest/ with the venv active.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from ingest.common import (
    audit_run,
    init_sentry,
    retry_get,
    supabase_client,
    upsert,
    validate,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Earliest day we backfill for spot prices. Predates JCC monthly history start to
# anchor the FX → USD conversion of jcc_value_usd_per_bbl back to 2012-01.
BACKFILL_FROM = date(2010, 1, 1)


# =========================================================
# Pydantic row models
# =========================================================


BenchmarkCode = Literal[
    "dubai",
    "oman",
    "murban",
    "brent",
    "wti",
    "arab_light",
    "arab_medium",
    "arab_heavy",
    "arab_extra_light",
    "espo",
    "opec_basket",
    "jpy_usd_fx",
]


class BenchmarkPriceRow(BaseModel):
    date: date
    benchmark: BenchmarkCode
    price_usd_bbl: float = Field(gt=0)
    source: str

    model_config = {"extra": "forbid"}


WtiBrentBenchmark = Literal["wti", "brent"]


class BenchmarkForwardRow(BaseModel):
    settlement_date: date
    benchmark: WtiBrentBenchmark
    contract_month: date
    price_usd_bbl: float = Field(gt=0)
    source: str

    model_config = {"extra": "forbid"}


# =========================================================
# Source 1: Frankfurter — JPY/USD FX
# =========================================================


def fetch_frankfurter_fx(start: date, end: date) -> list[dict[str, Any]]:
    """Daily JPY-per-USD from Frankfurter (ECB). Saved with benchmark='jpy_usd_fx'."""
    url = f"https://api.frankfurter.dev/v1/{start.isoformat()}..{end.isoformat()}?base=USD&symbols=JPY"
    resp = retry_get(url)
    payload = resp.json()
    rows: list[dict[str, Any]] = []
    for day, rates in payload.get("rates", {}).items():
        jpy = rates.get("JPY")
        if jpy is None:
            continue
        rows.append(
            {
                "date": day,  # already YYYY-MM-DD
                "benchmark": "jpy_usd_fx",
                "price_usd_bbl": float(jpy),  # store JPY/USD in this column (documented in §5)
                "source": "frankfurter",
            }
        )
    return rows


# =========================================================
# Source 2: EIA — WTI + Brent spot, WTI futures curve
# =========================================================


def _eia_series(api_key: str, series_id: str, start: date, end: date) -> list[dict[str, Any]]:
    """Fetch a single EIA series and return list of {date, value} dicts."""
    url = "https://api.eia.gov/v2/seriesid/" + series_id
    params = {
        "api_key": api_key,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "frequency": "daily",
    }
    resp = retry_get(url, params=params)
    data = resp.json().get("response", {}).get("data", [])
    out: list[dict[str, Any]] = []
    for r in data:
        period = r.get("period")
        value = r.get("value")
        if period and value is not None:
            try:
                out.append({"date": period, "value": float(value)})
            except (TypeError, ValueError):
                continue
    return out


def fetch_eia_spot(api_key: str, start: date, end: date) -> list[dict[str, Any]]:
    """WTI (RWTC) and Brent (RBRTE) daily spot, USD/bbl."""
    rows: list[dict[str, Any]] = []
    for series_id, benchmark in [("PET.RWTC.D", "wti"), ("PET.RBRTE.D", "brent")]:
        try:
            for r in _eia_series(api_key, series_id, start, end):
                rows.append(
                    {
                        "date": r["date"],
                        "benchmark": benchmark,
                        "price_usd_bbl": r["value"],
                        "source": "eia",
                    }
                )
        except Exception as exc:  # noqa: BLE001 — per-source failure shouldn't sink the whole run
            logger.warning("eia spot %s failed: %s", series_id, exc)
    return rows


def fetch_eia_wti_futures_curve(api_key: str, start: date, end: date) -> list[dict[str, Any]]:
    """Fetch EIA WTI futures contracts 1–12 (RCLC1..RCLC12) to populate the forward curve.

    EIA reports each contract's daily settlement price; we map contract number → contract
    delivery month by assuming standard CME NYMEX listing convention (contract N delivers
    in N months ahead from trade date — close enough for the M5 visualisation).
    """
    rows: list[dict[str, Any]] = []
    for contract_num in range(1, 13):
        series_id = f"PET.RCLC{contract_num}.D"
        try:
            data = _eia_series(api_key, series_id, start, end)
        except Exception as exc:  # noqa: BLE001
            logger.warning("eia WTI futures %s failed: %s", series_id, exc)
            continue
        for r in data:
            trade_dt = date.fromisoformat(r["date"])
            # Contract month = N months ahead of the trade month.
            y, m = trade_dt.year, trade_dt.month + contract_num
            while m > 12:
                y, m = y + 1, m - 12
            rows.append(
                {
                    "settlement_date": trade_dt.isoformat(),
                    "benchmark": "wti",
                    "contract_month": date(y, m, 1).isoformat(),
                    "price_usd_bbl": r["value"],
                    "source": "eia",
                }
            )
    return rows


# =========================================================
# Source 3-N: deferred sources (logged stubs)
# =========================================================


def fetch_deferred_sources_note() -> dict[str, str]:
    """Return a structured note describing the deferred sources, written to output_jsonb."""
    return {
        "opec_basket": "deferred to v1.5 — opec.org is Cloudflare-protected",
        "cme_dubai": "deferred (paywalled) — CME blocks scraping by IP",
        "cme_jcc_futures": "deferred (paywalled) — CME blocks scraping by IP",
        "arab_osp": "deferred to v1.5 — needs Aramco press-release scraper",
        "espo": "deferred to v1.5 — Argus-paywalled; sanctions-complicated",
        "murban_ice": "deferred (paywalled) — ICE Futures Abu Dhabi requires subscription",
    }


# =========================================================
# Main
# =========================================================


def main() -> int:
    init_sentry()
    client = supabase_client()
    eia_key = os.getenv("EIA_API_KEY")

    today = datetime.now(timezone.utc).date()
    # Ingest is incremental: fetch from latest_observed+1 (per benchmark) forward.
    # For simplicity we use a single window across all sources; UPSERT handles overlap.
    fetch_end = today

    with audit_run(client, kind="ingest_benchmarks") as state:
        all_price_rows: list[dict[str, Any]] = []
        all_forward_rows: list[dict[str, Any]] = []
        per_source: dict[str, int] = {}

        # --- Frankfurter FX (always runs) ---
        # Find latest jpy_usd_fx date already in DB.
        existing_fx = (
            client.table("benchmark_prices_daily")
            .select("date")
            .eq("benchmark", "jpy_usd_fx")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        fx_start = (
            date.fromisoformat(existing_fx.data[0]["date"]) + timedelta(days=1)
            if existing_fx.data
            else BACKFILL_FROM
        )
        if fx_start <= fetch_end:
            fx_rows = fetch_frankfurter_fx(fx_start, fetch_end)
            all_price_rows.extend(fx_rows)
            per_source["frankfurter_fx"] = len(fx_rows)
            logger.info("frankfurter: %d FX rows", len(fx_rows))
        else:
            per_source["frankfurter_fx"] = 0

        # --- EIA WTI/Brent spot + WTI futures (requires EIA_API_KEY) ---
        if eia_key:
            existing_wti = (
                client.table("benchmark_prices_daily")
                .select("date")
                .eq("benchmark", "wti")
                .order("date", desc=True)
                .limit(1)
                .execute()
            )
            eia_start = (
                date.fromisoformat(existing_wti.data[0]["date"]) + timedelta(days=1)
                if existing_wti.data
                else BACKFILL_FROM
            )
            spot_rows = fetch_eia_spot(eia_key, eia_start, fetch_end)
            all_price_rows.extend(spot_rows)
            per_source["eia_spot"] = len(spot_rows)
            logger.info("eia: %d spot rows", len(spot_rows))

            # Futures curve — start always from the same date; UPSERT handles overlap.
            existing_fwd = (
                client.table("benchmark_forwards_daily")
                .select("settlement_date")
                .eq("benchmark", "wti")
                .order("settlement_date", desc=True)
                .limit(1)
                .execute()
            )
            fwd_start = (
                date.fromisoformat(existing_fwd.data[0]["settlement_date"]) + timedelta(days=1)
                if existing_fwd.data
                else BACKFILL_FROM
            )
            fwd_rows = fetch_eia_wti_futures_curve(eia_key, fwd_start, fetch_end)
            all_forward_rows.extend(fwd_rows)
            per_source["eia_wti_futures"] = len(fwd_rows)
            logger.info("eia: %d WTI futures curve rows", len(fwd_rows))
        else:
            logger.warning(
                "benchmarks: EIA_API_KEY not set. Register at "
                "https://www.eia.gov/opendata/register.php and add EIA_API_KEY=... to .env. "
                "Skipping WTI/Brent ingest."
            )
            per_source["eia_spot"] = 0
            per_source["eia_wti_futures"] = 0

        # --- Validate + write ---
        price_valid, price_invalid = validate(BenchmarkPriceRow, all_price_rows)
        price_written = upsert(
            client,
            "benchmark_prices_daily",
            price_valid,
            conflict_cols=["date", "benchmark"],
        )

        fwd_valid, fwd_invalid = validate(BenchmarkForwardRow, all_forward_rows)
        fwd_written = upsert(
            client,
            "benchmark_forwards_daily",
            fwd_valid,
            conflict_cols=["settlement_date", "benchmark", "contract_month"],
        )

        state["row_count"] = price_written + fwd_written
        state["output"] = {
            "per_source": per_source,
            "rows_prices": price_written,
            "rows_forwards": fwd_written,
            "rows_rejected_prices": len(price_invalid),
            "rows_rejected_forwards": len(fwd_invalid),
            "deferred": fetch_deferred_sources_note(),
        }
        logger.info(
            "benchmarks OK: wrote %d prices + %d forwards; deferred: %s",
            price_written,
            fwd_written,
            list(fetch_deferred_sources_note().keys()),
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())

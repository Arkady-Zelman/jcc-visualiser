"""Smoke tests for benchmarks.py against live Frankfurter (no API key required)."""

from __future__ import annotations

from datetime import date

from ingest.benchmarks import (
    BenchmarkForwardRow,
    BenchmarkPriceRow,
    fetch_deferred_sources_note,
    fetch_frankfurter_fx,
)


def test_frankfurter_returns_recent_fx() -> None:
    """Frankfurter is free + has no key — exercise it live with a small recent window."""
    rows = fetch_frankfurter_fx(date(2026, 1, 1), date(2026, 1, 31))
    assert len(rows) > 15, "expected ~20 ECB business days in Jan 2026"
    # Schema
    for r in rows:
        BenchmarkPriceRow.model_validate(r)
    # Sanity: JPY/USD in 2026 is roughly 140-170 range.
    jpy_values = [r["price_usd_bbl"] for r in rows]
    assert min(jpy_values) > 100 and max(jpy_values) < 200, (
        f"JPY/USD outside expected 100-200 range: min={min(jpy_values)}, max={max(jpy_values)}"
    )
    assert {r["benchmark"] for r in rows} == {"jpy_usd_fx"}
    assert {r["source"] for r in rows} == {"frankfurter"}


def test_deferred_sources_note_keys() -> None:
    note = fetch_deferred_sources_note()
    assert {"opec_basket", "cme_dubai", "cme_jcc_futures", "arab_osp", "espo", "murban_ice"} <= note.keys()


def test_pydantic_models_round_trip() -> None:
    BenchmarkPriceRow.model_validate(
        {"date": "2026-05-26", "benchmark": "wti", "price_usd_bbl": 73.45, "source": "eia"}
    )
    BenchmarkForwardRow.model_validate(
        {
            "settlement_date": "2026-05-26",
            "benchmark": "wti",
            "contract_month": "2026-08-01",
            "price_usd_bbl": 73.45,
            "source": "eia",
        }
    )

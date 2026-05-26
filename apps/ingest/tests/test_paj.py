"""Regression test for paj.py parser against a saved May 2026 fixture."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from ingest.paj import JccMonthlyRow, parse_paj03_workbook

FIXTURE = Path(__file__).parent / "fixtures" / "paj" / "paj-03E_2605.xlsx"
FIXTURE_URL = "https://www.paj.gr.jp/sites/default/files/2026-05/paj-03E_2605.xlsx"


def test_parser_extracts_full_monthly_series() -> None:
    rows = parse_paj03_workbook(FIXTURE.read_bytes(), source_url=FIXTURE_URL)
    assert len(rows) == 171, f"expected 171 monthly rows in May 2026 file, got {len(rows)}"
    assert rows[0]["month"] == "2012-01-01"
    assert rows[-1]["month"] == "2026-03-01"


def test_status_lifecycle() -> None:
    rows = parse_paj03_workbook(FIXTURE.read_bytes(), source_url=FIXTURE_URL)
    # Only the very last row should be 'provisional'; everything else 'final'.
    statuses = {r["status"] for r in rows[:-1]}
    assert statuses == {"final"}, f"non-latest rows should all be final; got {statuses}"
    assert rows[-1]["status"] == "provisional"


def test_known_market_signals() -> None:
    """Spot-check famous JCC inflection points against the parsed values."""
    rows = parse_paj03_workbook(FIXTURE.read_bytes(), source_url=FIXTURE_URL)
    by_month = {r["month"]: r for r in rows}

    # 2020-04 COVID collapse — must be very low.
    covid = by_month["2020-04-01"]
    assert covid["jcc_value_jpy_per_kl"] < 35000, (
        f"COVID-trough should be <¥35k/kl; got {covid['jcc_value_jpy_per_kl']}"
    )

    # 2022-06 Russia invasion peak — must be very high.
    invasion = by_month["2022-06-01"]
    assert invasion["jcc_value_jpy_per_kl"] > 80000, (
        f"Russia-invasion peak should be >¥80k/kl; got {invasion['jcc_value_jpy_per_kl']}"
    )


def test_pydantic_round_trip() -> None:
    """Every parsed row must satisfy the JccMonthlyRow Pydantic model."""
    rows = parse_paj03_workbook(FIXTURE.read_bytes(), source_url=FIXTURE_URL)
    for raw in rows:
        model = JccMonthlyRow.model_validate(raw)
        assert model.jcc_value_jpy_per_kl > 0
        assert model.status in ("provisional", "revised", "final")
        assert isinstance(model.month, date)

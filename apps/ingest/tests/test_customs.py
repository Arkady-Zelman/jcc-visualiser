"""Unit tests for customs.py parser against a synthetic e-Stat payload.

(Real e-Stat ingest requires ESTAT_APP_ID; this test verifies the parser logic
in isolation.)
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from ingest.customs import ImportsRow, load_mof_to_iso, months_to_backfill, parse_estat_payload

FIXTURE = Path(__file__).parent / "fixtures" / "customs" / "estat_payload_synthetic.json"


def test_parser_extracts_known_origins() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    mof_to_iso = load_mof_to_iso()
    rows, unknown = parse_estat_payload(payload, mof_to_iso)

    # 6 origins in the fixture; 1 (`999`) is unknown.
    assert len(rows) == 5, f"expected 5 known-origin rows, got {len(rows)}"
    assert unknown == ["999"], f"expected ['999'] unknown; got {unknown}"

    by_iso = {r["origin_country"]: r for r in rows}
    # UAE (147) → AE
    assert "AE" in by_iso
    # Saudi (137) → SA
    assert "SA" in by_iso
    # Oman (141) → OM
    assert "OM" in by_iso
    # Russia (224) → RU
    assert "RU" in by_iso
    # US (304) → US
    assert "US" in by_iso


def test_pydantic_round_trip() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    mof_to_iso = load_mof_to_iso()
    rows, _ = parse_estat_payload(payload, mof_to_iso)
    for raw in rows:
        model = ImportsRow.model_validate(raw)
        assert model.month == date(2026, 4, 1)
        assert model.hs_code == "2709.00.900"
        assert model.volume_kl > 0
        assert model.value_jpy > 0


def test_months_to_backfill_from_empty() -> None:
    months = months_to_backfill(None)
    assert months[0] == "201501"
    # Last month should be < current month
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date()
    last = months[-1]
    last_year, last_month = int(last[:4]), int(last[4:6])
    assert (last_year, last_month) < (today.year, today.month)


def test_months_to_backfill_resumes_after_latest() -> None:
    months = months_to_backfill(date(2026, 2, 1))
    assert months[0] == "202603"  # the next month after 2026-02

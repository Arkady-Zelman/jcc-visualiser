"""Unit tests for customs.py parser logic."""

from __future__ import annotations

from ingest.customs import _MONTH_OFFSETS, _strip_area_prefix, load_mof_to_iso


def test_strip_area_prefix_normalises_to_3_digit_mof() -> None:
    """e-Stat prefixes the 3-digit MOF code with '5' + a zero-pad digit."""
    assert _strip_area_prefix("50137") == "137"  # Saudi Arabia
    assert _strip_area_prefix("50105") == "105"  # China
    assert _strip_area_prefix("50103") == "103"  # Korea
    assert _strip_area_prefix("50224") == "224"  # Russia
    assert _strip_area_prefix("50304") == "304"  # USA
    # Non-prefixed codes pass through unchanged.
    assert _strip_area_prefix("137") == "137"
    assert _strip_area_prefix("abc") == "abc"


def test_mof_country_codes_yaml_covers_key_crude_origins() -> None:
    mof_to_iso = load_mof_to_iso()
    for mof_code, expected_iso in [
        ("133", "IR"),
        ("134", "IQ"),
        ("137", "SA"),
        ("138", "KW"),
        ("140", "QA"),
        ("141", "OM"),
        ("147", "AE"),
        ("224", "RU"),
        ("304", "US"),
    ]:
        assert mof_to_iso.get(mof_code) == expected_iso, (
            f"MOF {mof_code} should map to {expected_iso}, got {mof_to_iso.get(mof_code)}"
        )


def test_month_offsets_cover_all_12_months() -> None:
    """Every month (Jan-Dec) must have both a quantity and a value cat02 code."""
    months_seen: dict[int, set[str]] = {}
    for cat02, (kind, month) in _MONTH_OFFSETS.items():
        months_seen.setdefault(month, set()).add(kind)
    for m in range(1, 13):
        assert m in months_seen, f"month {m} missing from _MONTH_OFFSETS"
        assert months_seen[m] == {"qty", "value"}, (
            f"month {m} should have both qty and value; got {months_seen[m]}"
        )

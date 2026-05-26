"""Unit tests for derive_composition.py math, using synthetic in-memory dicts."""

from __future__ import annotations

from datetime import date

from ingest.derive_composition import _mapping_lookup, _resolve_mapping


def test_resolve_mapping_validity_window() -> None:
    # UAE-style two-window mapping
    mappings = [
        {
            "hs_code": "2709.00.900",
            "origin_country": "AE",
            "grade_id": "murban",
            "weight_pct": 50,
            "applies_from": "2015-01-01",
            "applies_to": "2021-03-01",
        },
        {
            "hs_code": "2709.00.900",
            "origin_country": "AE",
            "grade_id": "murban",
            "weight_pct": 60,
            "applies_from": "2021-03-01",
            "applies_to": None,
        },
    ]
    lookup = _mapping_lookup(mappings)
    key = ("2709.00.900", "AE")

    # Pre-launch month should hit the first row (50%)
    matched_pre = _resolve_mapping(date(2020, 6, 1), lookup[key])
    assert matched_pre is not None
    assert len(matched_pre) == 1
    assert float(matched_pre[0]["weight_pct"]) == 50

    # Post-launch month should hit the second row (60%)
    matched_post = _resolve_mapping(date(2023, 6, 1), lookup[key])
    assert matched_post is not None
    assert len(matched_post) == 1
    assert float(matched_post[0]["weight_pct"]) == 60

    # Edge: exactly on applies_from = 2021-03-01 should match the post-launch window
    matched_edge = _resolve_mapping(date(2021, 3, 1), lookup[key])
    assert matched_edge is not None
    assert float(matched_edge[0]["weight_pct"]) == 60


def test_resolve_mapping_misses_returns_none() -> None:
    mappings = [
        {
            "hs_code": "2709.00.900",
            "origin_country": "RU",
            "grade_id": "espo",
            "weight_pct": 100,
            "applies_from": "2015-01-01",
            "applies_to": None,
        }
    ]
    lookup = _mapping_lookup(mappings)
    # IR has no mapping → must return None
    assert _resolve_mapping(date(2018, 5, 1), lookup.get(("2709.00.900", "IR"), [])) is None
    # Year before applies_from → must return None
    assert _resolve_mapping(date(2010, 1, 1), lookup[("2709.00.900", "RU")]) is None

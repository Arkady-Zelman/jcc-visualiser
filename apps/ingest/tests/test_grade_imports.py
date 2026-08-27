"""Unit tests for grade_imports.py — mapping YAML integrity + parser logic."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from ingest.grade_imports import (
    GradeImportRow,
    _clean_code,
    _is_condensate,
    grade_for_oil_code,
    load_grade_oil_mapping,
)

SEED = Path(__file__).resolve().parents[3] / "data" / "seed"


def test_mapping_grade_ids_exist_in_grades_yaml() -> None:
    """Every grade_id in grade_oil_mapping.yaml must be a curated grade."""
    curated = {g["id"] for g in yaml.safe_load((SEED / "grades.yaml").read_text())["grades"]}
    mapping = load_grade_oil_mapping()
    for m in mapping["mappings"]:
        assert m["grade_id"] in curated, f"unknown grade_id {m['grade_id']!r} for {m.get('oil_name')}"


def test_mapping_codes_are_unique_and_well_formed() -> None:
    mapping = load_grade_oil_mapping()
    oil_codes = [m["oil_code"] for m in mapping["mappings"] if m.get("oil_code")]
    annual_codes = [m["annual_code"] for m in mapping["mappings"] if m.get("annual_code")]
    assert len(oil_codes) == len(set(oil_codes)), "duplicate oil_code in grade_oil_mapping.yaml"
    assert len(annual_codes) == len(set(annual_codes)), "duplicate annual_code"
    for code in oil_codes + annual_codes:
        assert code.isdigit(), f"code {code!r} must be a digit string (quote it in YAML)"
    # Every entry must be reachable by at least one code space.
    for m in mapping["mappings"]:
        assert m.get("oil_code") or m.get("annual_code")


def test_country_kana_values_are_iso_alpha2_strings() -> None:
    """Bare NO parses as YAML boolean False — every ISO value must survive as a 2-char string."""
    mapping = load_grade_oil_mapping()
    for kana, iso in mapping["country_kana"].items():
        assert isinstance(iso, str) and len(iso) == 2, f"country_kana[{kana!r}] = {iso!r}"
    for mof3, iso in mapping["origin_overrides"].items():
        assert isinstance(iso, str) and len(iso) == 2, f"origin_overrides[{mof3!r}] = {iso!r}"


def test_grade_for_oil_code_covers_both_code_spaces() -> None:
    lookup = grade_for_oil_code(load_grade_oil_mapping())
    assert lookup["13701"] == "arab_light"
    assert lookup["14701"] == "murban"
    assert lookup["a60470"] == "wti"  # annual-only entry stored as 'a'+cat01


def test_clean_code_coerces_workbook_cell_variants() -> None:
    assert _clean_code("13701") == "13701"
    assert _clean_code(13701) == "13701"
    assert _clean_code(13701.0) == "13701"
    assert _clean_code("１３７０１") == "13701"  # full-width digits NFKC-normalised
    assert _clean_code("ARAB-L") is None
    assert _clean_code(float("nan")) is None


def test_is_condensate_heuristic() -> None:
    assert _is_condensate("LOWSUL-C", "ローサルファー・コンデンセート")
    assert _is_condensate("WINDYR-C", None)  # '-C' suffix alone is enough
    assert not _is_condensate("ARAB-L", "アラビアン・ライト")
    assert not _is_condensate("MURBAN", "マーバン")


def test_grade_import_row_rejects_bad_rows() -> None:
    base = {
        "month": "2026-06-01",
        "oil_code": "13701",
        "oil_name": "ARAB-L",
        "oil_name_kana": "アラビアン・ライト",
        "origin_country": "SA",
        "is_condensate": False,
        "volume_kl": 1000.0,
        "source": "estat_kakuho",
        "source_url": "https://example.test",
    }
    GradeImportRow.model_validate(base)  # sanity: the happy path validates
    for bad in (
        {"volume_kl": 0},          # zero-volume template rows must be dropped pre-validation
        {"origin_country": "XYZ"}, # not alpha-2
        {"oil_code": "xx"},        # not a code
        {"source": "guesswork"},
    ):
        with pytest.raises(Exception):
            GradeImportRow.model_validate({**base, **bad})

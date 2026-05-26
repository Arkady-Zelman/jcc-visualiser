"""Load curated YAML seeds (grades, grade_hs_mapping, events) into Supabase.

Idempotent: re-running just re-UPSERTs.

Run: `python -m ingest.seed` from `apps/ingest/` with the venv active and Supabase env populated.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, field_validator

from ingest.common import audit_run, supabase_client, upsert, validate

# Repo-root data/seed/*.yaml lives 4 levels up from this file.
SEED_DIR = Path(__file__).resolve().parents[3] / "data" / "seed"


# =========================================================
# Pydantic models — mirror the SQL schema for boundary safety
# =========================================================


class Grade(BaseModel):
    id: str
    display_name: str
    origin_country: str = Field(min_length=2, max_length=2)
    region: Literal["middle_east", "russia", "americas", "africa", "asia_pacific", "europe", "other"]
    api_gravity: float | None = None
    sulphur_pct: float | None = None
    type: Literal["light_sweet", "light_sour", "medium_sweet", "medium_sour", "heavy_sweet", "heavy_sour"]
    primary_benchmark: str | None = None
    notes: str | None = None

    model_config = {"extra": "forbid"}


class GradeHsMapping(BaseModel):
    hs_code: str
    origin_country: str = Field(min_length=2, max_length=2)
    grade_id: str
    weight_pct: float = Field(ge=0, le=100)
    applies_from: date
    applies_to: date | None = None
    notes: str | None = None

    model_config = {"extra": "forbid"}

    @field_validator("applies_from", "applies_to", mode="before")
    @classmethod
    def parse_date(cls, v: Any) -> Any:
        if v is None or isinstance(v, date):
            return v
        return date.fromisoformat(str(v))


class Event(BaseModel):
    id: str
    date_from: date
    date_to: date | None = None
    category: Literal["sanctions", "geopolitics", "supply_shock", "demand_shock", "opec_decision", "contract_launch", "disaster", "policy"]
    title: str
    description_md: str
    impact_grades: list[str] = []
    sources: list[str] = []

    model_config = {"extra": "forbid"}


# =========================================================
# Loader
# =========================================================


def _load_yaml(filename: str, top_key: str) -> list[dict[str, Any]]:
    path = SEED_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Seed file not found: {path}")
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    rows = data.get(top_key, [])
    if not isinstance(rows, list):
        raise ValueError(f"{filename}: top-level key '{top_key}' must be a list")
    return rows


def main() -> int:
    client = supabase_client()

    with audit_run(client, kind="seed") as state:
        # ---- grades ----
        raw_grades = _load_yaml("grades.yaml", "grades")
        grades, bad_grades = validate(Grade, raw_grades)
        grade_count = upsert(client, "grades", grades, conflict_cols=["id"])
        print(f"  grades: upserted {grade_count} (rejected {len(bad_grades)})")

        # ---- grade_hs_mapping ----
        raw_mappings = _load_yaml("grade_hs_mapping.yaml", "mappings")
        mappings, bad_mappings = validate(GradeHsMapping, raw_mappings)
        # Validate every mapping references a real grade we just loaded.
        known_grade_ids = {g.id for g in grades}
        bad_fk = [m for m in mappings if m.grade_id not in known_grade_ids]
        if bad_fk:
            print(
                f"  grade_hs_mapping: WARNING — {len(bad_fk)} rows reference unknown grade_id "
                f"(would violate FK); skipping: {[m.grade_id for m in bad_fk]}"
            )
            mappings = [m for m in mappings if m.grade_id in known_grade_ids]
        mapping_count = upsert(
            client,
            "grade_hs_mapping",
            mappings,
            conflict_cols=["hs_code", "origin_country", "grade_id", "applies_from"],
        )
        print(
            f"  grade_hs_mapping: upserted {mapping_count} "
            f"(rejected {len(bad_mappings)}, FK-skipped {len(bad_fk)})"
        )

        # ---- events ----
        raw_events = _load_yaml("events.yaml", "events")
        events, bad_events = validate(Event, raw_events)
        event_count = upsert(client, "events", events, conflict_cols=["id"])
        print(f"  events: upserted {event_count} (rejected {len(bad_events)})")

        # ---- summary ----
        state["row_count"] = grade_count + mapping_count + event_count
        state["output"] = {
            "grades": grade_count,
            "grade_hs_mapping": mapping_count,
            "events": event_count,
            "rejected": {
                "grades": len(bad_grades),
                "grade_hs_mapping": len(bad_mappings) + len(bad_fk),
                "events": len(bad_events),
            },
        }

        print(f"seed OK: {state['row_count']} rows total")
    return 0


if __name__ == "__main__":
    sys.exit(main())

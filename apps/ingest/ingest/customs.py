"""Ingest Japan Customs monthly crude imports (HS 2709.00.900) into `imports_monthly`.

Source: e-Stat API v3.0 (https://api.e-stat.go.jp), free with APP_ID.

**Data model discovered empirically (2026-05-26):**

e-Stat publishes Japan trade statistics as one statsDataId per year-range
(e.g. 0003425294 covers 2021–2025). Each table's `time` dimension is the
calendar YEAR, and *monthly* observations are encoded in the `cat02`
("Quantity-Value by Commodity") dimension as separate code points per month:

    cat02=100  Unit1                  ← string label like "KL"
    cat02=120  Quantity1-Year         ← annual aggregate
    cat02=140  Value-Year             ← annual aggregate
    cat02=150  Quantity1-January      ← per-month, what we want
    cat02=170  Value-January
    cat02=180  Quantity1-February
    cat02=200  Value-February
    ...
    cat02=480  Quantity1-December
    cat02=500  Value-December

Area codes are prefixed with `5` (e.g. `50137` = Saudi Arabia code 137). We
strip the prefix before looking up `data/seed/mof_country_codes.yaml`.

HS code scope: 2709.00.900 ONLY (crude petroleum, other) — see BUILD_SPEC.md §7.1.

Run: `python -m ingest.customs` from apps/ingest/ with the venv active.
"""

from __future__ import annotations

import logging
import os
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import yaml
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

ESTAT_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json"
HS_CRUDE_OTHER = "270900900"

# statsDataId coverage map: (first_year, last_year) → statsDataId.
# Discovered via getStatsList(statsCode='00350300') on 2026-05-26.
# When a new year-range publication appears, add it here.
COVERAGE = [
    (2011, 2015, "0003228185"),  # Commodity by Country (Import Jan-Dec:Fixed) 2011-2015
    (2016, 2020, "0003313966"),  # Commodity by Country (Import Jan-Dec:Fixed) 2016-2020
    (2021, 2025, "0003425294"),  # Import Fixed 2021-2024, Revised 2025
    (2026, 2026, "0004049326"),  # Import 2026 (Detailed Jan-Feb, Provisional Mar+)
]

# Mapping: cat02 code → (month, kind) where kind ∈ {'qty', 'value'}.
# Quantity2 (cat02=160, 190, 220, ...) is the secondary unit (often KG vs Unit1=KL);
# we only consume Quantity1.
_MONTH_OFFSETS = {
    150: ("qty", 1), 170: ("value", 1),
    180: ("qty", 2), 200: ("value", 2),
    210: ("qty", 3), 230: ("value", 3),
    240: ("qty", 4), 260: ("value", 4),
    270: ("qty", 5), 290: ("value", 5),
    300: ("qty", 6), 320: ("value", 6),
    330: ("qty", 7), 350: ("value", 7),
    360: ("qty", 8), 380: ("value", 8),
    390: ("qty", 9), 410: ("value", 9),
    420: ("qty", 10), 440: ("value", 10),
    450: ("qty", 11), 470: ("value", 11),
    480: ("qty", 12), 500: ("value", 12),
}


# =========================================================
# Pydantic row model — mirrors imports_monthly schema
# =========================================================


class ImportsRow(BaseModel):
    month: date
    hs_code: str = "2709.00.900"
    origin_country: str = Field(min_length=2, max_length=2)
    volume_kl: float = Field(ge=0)
    value_jpy: int = Field(ge=0)
    source: str = "customs_estat"

    model_config = {"extra": "forbid"}


# =========================================================
# MOF country code → ISO 3166-1 alpha-2 lookup
# =========================================================


def load_mof_to_iso() -> dict[str, str | None]:
    """Load the curated MOF code → ISO mapping from data/seed/mof_country_codes.yaml."""
    seed = Path(__file__).resolve().parents[3] / "data" / "seed" / "mof_country_codes.yaml"
    with seed.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    return {entry["mof"]: entry.get("iso") for entry in data["codes"]}


def _strip_area_prefix(area_code: str) -> str:
    """e-Stat prefixes MOF area codes with '5' + a zero-padding digit (e.g. '50137' → MOF '137').

    The MOF 3-digit code is the integer value of the last 4 characters.
    """
    if area_code.startswith("5") and len(area_code) == 5 and area_code[1:].isdigit():
        return str(int(area_code[1:]))
    return area_code


# =========================================================
# e-Stat fetch + parse
# =========================================================


def fetch_estat_table(app_id: str, stats_data_id: str) -> dict[str, Any]:
    """Fetch all rows for HS 270900900 from one year-range statsDataId.

    Returns the parsed JSON payload. Raises on non-zero STATUS.
    """
    # Restrict to the monthly cat02 codes we care about (skip unit labels & annual aggregates).
    cat02_filter = ",".join(str(c) for c in sorted(_MONTH_OFFSETS.keys()))
    params = {
        "appId": app_id,
        "statsDataId": stats_data_id,
        "cdCat01": HS_CRUDE_OTHER,
        "cdCat02": cat02_filter,
        "limit": 100000,
    }
    resp = retry_get(f"{ESTAT_BASE}/getStatsData", params=params)
    payload = resp.json()
    status = payload.get("GET_STATS_DATA", {}).get("RESULT", {}).get("STATUS")
    if status not in (0, "0"):
        msg = payload.get("GET_STATS_DATA", {}).get("RESULT", {}).get("ERROR_MSG", "(no message)")
        raise RuntimeError(f"e-Stat returned STATUS={status}: {msg}")
    return payload


def parse_estat_payload(
    payload: dict[str, Any], mof_to_iso: dict[str, str | None]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Flatten one year-range payload into imports_monthly rows.

    For each (year, area), pair Quantity1-<Month> + Value-<Month> into a row.
    Volume from e-Stat is in KL natively (per Unit1 = "ＫＬ").
    Value is in 1000 JPY units (standard MOF/Japan Customs convention).

    Returns (rows, unknown_area_codes).
    """
    values = (
        payload.get("GET_STATS_DATA", {})
        .get("STATISTICAL_DATA", {})
        .get("DATA_INF", {})
        .get("VALUE", [])
    )
    if not isinstance(values, list):
        values = [values] if values else []

    # Bucket by (year, area, month, kind).
    buckets: dict[tuple[int, str, int], dict[str, float]] = defaultdict(dict)
    unknown: set[str] = set()

    for v in values:
        cat02 = v.get("@cat02")
        try:
            cat02_int = int(cat02)
        except (TypeError, ValueError):
            continue
        m = _MONTH_OFFSETS.get(cat02_int)
        if not m:
            continue  # unit-label or annual roll-up row
        kind, month_num = m

        time_code = str(v.get("@time", ""))
        if len(time_code) < 4 or not time_code[:4].isdigit():
            continue
        year = int(time_code[:4])

        raw_area = str(v.get("@area", ""))
        try:
            val = float(v.get("$", 0))
        except (TypeError, ValueError):
            continue

        buckets[(year, raw_area, month_num)][kind] = val

    rows: list[dict[str, Any]] = []
    for (year, raw_area, month_num), kinds in buckets.items():
        qty = kinds.get("qty")
        val = kinds.get("value")
        if qty is None and val is None:
            continue
        # Volume is in KL; value is in 1000 JPY.
        volume_kl = float(qty or 0)
        value_jpy = int(round((val or 0) * 1000))
        if volume_kl <= 0 and value_jpy <= 0:
            continue  # skip empty buckets (no trade that month/origin)

        mof_code = _strip_area_prefix(raw_area)
        iso = mof_to_iso.get(mof_code)
        if not iso:
            unknown.add(raw_area)
            continue

        rows.append(
            {
                "month": date(year, month_num, 1).isoformat(),
                "hs_code": "2709.00.900",
                "origin_country": iso,
                "volume_kl": round(volume_kl, 3),
                "value_jpy": value_jpy,
                "source": "customs_estat",
            }
        )

    return rows, sorted(unknown)


# =========================================================
# Main
# =========================================================


def main() -> int:
    init_sentry()
    client = supabase_client()

    app_id = os.getenv("ESTAT_APP_ID")
    if not app_id:
        logger.warning(
            "customs: ESTAT_APP_ID not set. Register at https://www.e-stat.go.jp/api/en "
            "and add ESTAT_APP_ID=... to .env. Skipping ingest."
        )
        return 0

    mof_to_iso = load_mof_to_iso()
    logger.info("customs: loaded %d MOF→ISO mappings", len(mof_to_iso))

    with audit_run(client, kind="ingest_customs") as state:
        total_written = 0
        total_rejected = 0
        unknown_all: set[str] = set()
        per_table: dict[str, dict[str, Any]] = {}

        for first_year, last_year, sid in COVERAGE:
            logger.info("customs: fetching %s (%d–%d)", sid, first_year, last_year)
            payload = fetch_estat_table(app_id, sid)
            raw_rows, unknown = parse_estat_payload(payload, mof_to_iso)
            unknown_all.update(unknown)

            valid, invalid = validate(ImportsRow, raw_rows)
            total_rejected += len(invalid)

            written = upsert(
                client,
                "imports_monthly",
                valid,
                conflict_cols=["month", "hs_code", "origin_country"],
            )
            total_written += written
            per_table[sid] = {
                "years": f"{first_year}-{last_year}",
                "rows_written": written,
                "rows_rejected": len(invalid),
                "unknown_areas": unknown[:10],
            }
            logger.info(
                "customs: %s %d-%d — wrote %d rows (rejected %d, unknown areas %d)",
                sid,
                first_year,
                last_year,
                written,
                len(invalid),
                len(unknown),
            )

        state["row_count"] = total_written
        state["output"] = {
            "per_table": per_table,
            "rows_written": total_written,
            "rows_rejected": total_rejected,
            "unknown_areas_all": sorted(unknown_all),
        }
        logger.info(
            "customs OK: wrote %d rows total across %d tables; unknown areas: %s",
            total_written,
            len(COVERAGE),
            sorted(unknown_all)[:10],
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())

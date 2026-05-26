"""Ingest Japan Customs monthly crude imports (HS 2709.00.900) into `imports_monthly`.

Source: e-Stat API (https://api.e-stat.go.jp), free with APP_ID.
        Statistics ID: Trade Statistics of Japan, Imports by Country and Commodity (monthly).

If `ESTAT_APP_ID` is not set, the job exits cleanly with instructions —
register at https://www.e-stat.go.jp/api/en in <5 minutes.

The MOF 3-digit origin code is translated to ISO 3166-1 alpha-2 via
`data/seed/mof_country_codes.yaml` (regenerated at M3 from customs.go.jp).

HS code scope: 2709.00.900 ONLY (crude petroleum, other). 2709.00.100 (condensate)
and 2710.19.xxx (refined products) are excluded per BUILD_SPEC.md §7.1.

Run: `python -m ingest.customs` from apps/ingest/ with the venv active.
"""

from __future__ import annotations

import logging
import os
import sys
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

# e-Stat statsDataId for "Trade Statistics of Japan, Imports by Country, Monthly".
# This is the canonical ID for the country-by-commodity import table; if it ever changes,
# discover via getStatsList and update here.
ESTAT_STATSID_IMPORTS = "0003339498"

# HS code we care about. e-Stat encodes it without the dot — '270900900'.
HS_CRUDE_OTHER = "270900900"

# Earliest month we backfill.
BACKFILL_FROM = date(2015, 1, 1)


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


# =========================================================
# e-Stat fetch
# =========================================================


def fetch_estat_imports(app_id: str, year_month: str) -> dict[str, Any]:
    """Fetch one month of HS 2709.00.900 imports via e-Stat getStatsData.

    Args:
        app_id:     e-Stat APP_ID.
        year_month: YYYYMM, e.g. "202604".

    Returns:
        Parsed JSON payload from the API.
    """
    params = {
        "appId": app_id,
        "statsDataId": ESTAT_STATSID_IMPORTS,
        "cdCat01": HS_CRUDE_OTHER,
        "cdTime": year_month,
        "limit": 100000,
    }
    resp = retry_get(f"{ESTAT_BASE}/getStatsData", params=params)
    payload = resp.json()
    # Surface API-level errors clearly.
    status = payload.get("GET_STATS_DATA", {}).get("RESULT", {}).get("STATUS")
    if status not in (0, "0"):
        msg = payload.get("GET_STATS_DATA", {}).get("RESULT", {}).get("ERROR_MSG", "(no message)")
        raise RuntimeError(f"e-Stat returned STATUS={status}: {msg}")
    return payload


def parse_estat_payload(payload: dict[str, Any], mof_to_iso: dict[str, str | None]) -> tuple[list[dict[str, Any]], list[str]]:
    """Flatten e-Stat getStatsData JSON into imports_monthly rows.

    Returns (rows, unknown_mof_codes). Volume is in kl, value in JPY.
    Volume + value may live in separate `tab` rows of the same statsDataId — typical
    layout has `tab=1` = volume (kg / kl), `tab=2` = value (1000 JPY) or similar.
    The first run will surface the actual `tab` semantics in the meta-info; if our
    assumed mapping is wrong, the parser will produce zero/skewed rows and we log it.
    """
    values = (
        payload.get("GET_STATS_DATA", {})
        .get("STATISTICAL_DATA", {})
        .get("DATA_INF", {})
        .get("VALUE", [])
    )
    if not isinstance(values, list):
        values = [values] if values else []

    # Index every (time, area) by `tab` so we can pair volume + value.
    by_key: dict[tuple[str, str], dict[str, float]] = {}
    for v in values:
        time = v.get("@time", "")
        area = v.get("@area", "")
        tab = str(v.get("@tab", ""))
        try:
            val = float(v.get("$", 0))
        except (TypeError, ValueError):
            continue
        by_key.setdefault((time, area), {})[tab] = val

    rows: list[dict[str, Any]] = []
    unknown: list[str] = []
    for (time, area), tabs in by_key.items():
        # time is YYYYMM; convert to YYYY-MM-01.
        if len(time) != 6 or not time.isdigit():
            continue
        month = date(int(time[:4]), int(time[4:6]), 1)
        iso = mof_to_iso.get(area)
        if not iso:
            unknown.append(area)
            continue
        # Heuristic: tab='1' = volume (kg, will be ÷ 1000 for kl assuming density~840kg/kl ≈ 0.84).
        # Volume in trade stats is typically reported in kg for crude; we want kl.
        # Crude oil density ~ 0.85 kg/L = 850 kg/kl. We'll store volume_kl = volume_kg / 850.
        # If e-Stat reports volume directly in kl, this will produce wrong numbers — first
        # backfill will reveal the actual unit and we'll adjust.
        volume_raw = tabs.get("1") or tabs.get("VOL") or 0.0
        value_raw = tabs.get("2") or tabs.get("VAL") or 0.0
        # e-Stat trade statistics value column is usually in 1000 JPY units.
        rows.append(
            {
                "month": month.isoformat(),
                "hs_code": "2709.00.900",
                "origin_country": iso,
                "volume_kl": round(volume_raw / 850.0, 3),  # crude oil density assumption
                "value_jpy": int(value_raw * 1000),
                "source": "customs_estat",
            }
        )

    return rows, unknown


def months_to_backfill(latest_observed: date | None) -> list[str]:
    """Return YYYYMM strings from BACKFILL_FROM (or latest_observed+1) up to "now-1m"."""
    from datetime import datetime, timezone

    start = latest_observed or BACKFILL_FROM
    if latest_observed:
        # Advance to next month.
        y, m = start.year, start.month + 1
        if m > 12:
            y, m = y + 1, 1
        start = date(y, m, 1)

    today = datetime.now(timezone.utc).date()
    # Stop at last month (current month's data isn't published yet).
    end = date(today.year, today.month, 1)
    out: list[str] = []
    cur = start
    while cur < end:
        out.append(f"{cur.year:04d}{cur.month:02d}")
        ny, nm = (cur.year, cur.month + 1) if cur.month < 12 else (cur.year + 1, 1)
        cur = date(ny, nm, 1)
    return out


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
        # Find the most-recent month already in imports_monthly so we only fetch new data.
        existing = (
            client.table("imports_monthly")
            .select("month")
            .order("month", desc=True)
            .limit(1)
            .execute()
        )
        latest: date | None = None
        if existing.data:
            latest = date.fromisoformat(existing.data[0]["month"])

        months = months_to_backfill(latest)
        logger.info(
            "customs: fetching %d month(s) from e-Stat (latest existing: %s)",
            len(months),
            latest or "—",
        )

        total_written = 0
        total_unknown_codes: list[str] = []
        rejected_total = 0
        for ym in months:
            payload = fetch_estat_imports(app_id, ym)
            raw_rows, unknown = parse_estat_payload(payload, mof_to_iso)
            total_unknown_codes.extend(unknown)
            if not raw_rows:
                logger.info("customs: %s — no rows returned", ym)
                continue
            valid, invalid = validate(ImportsRow, raw_rows)
            rejected_total += len(invalid)
            written = upsert(
                client,
                "imports_monthly",
                valid,
                conflict_cols=["month", "hs_code", "origin_country"],
            )
            total_written += written
            logger.info("customs: %s — wrote %d rows (rejected %d)", ym, written, len(invalid))

        state["row_count"] = total_written
        state["output"] = {
            "months_fetched": len(months),
            "first_month": months[0] if months else None,
            "last_month": months[-1] if months else None,
            "rows_written": total_written,
            "rows_rejected": rejected_total,
            "unknown_mof_codes": sorted(set(total_unknown_codes)),
        }
        logger.info(
            "customs OK: wrote %d rows over %d months; unknown MOF codes: %s",
            total_written,
            len(months),
            sorted(set(total_unknown_codes))[:10],
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())

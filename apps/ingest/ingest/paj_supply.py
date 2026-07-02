"""Ingest PAJ crude supply/demand (paj-01E) and oil stockpiling (paj-05E).

Sources, both published monthly on https://www.paj.gr.jp/english/statis/:

  paj-01E_YYMM.xlsx   "01. Supply and Demand of Crude Oil" (source data: METI).
                      Sheet `Crude Oil`, monthly rows from 2002.01. Unit: kl
                      (capacity/throughput-rate columns are b/d). Feeds
                      `crude_supply_monthly` — production, imports, refinery
                      throughput, utilisation, end-of-month inventory.

  paj-05E_YYYYMM.xls  "05. Oil Stockpiling". Sheet `epaj-5`, monthly rows from
                      2017. Unit: 10,000 kl (converted to kl here so every DB
                      volume column reads in kl); days-of-supply as published.
                      Feeds `oil_stockpile_monthly` — private + government
                      stockpiles. Government crude draw shows IEA-coordinated
                      strategic releases (e.g. April 2026).

Both workbooks footnote "Latest month is preliminary figures" — the last monthly
row is tagged `provisional`, everything else `final`. UPSERT on re-fetch folds
in revisions.

Run: `python -m ingest.paj_supply` from apps/ingest/ with the venv active.
"""

from __future__ import annotations

import logging
import re
import sys
from datetime import date
from io import BytesIO
from typing import Any, Literal

import pandas as pd
from bs4 import BeautifulSoup
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

PAJ_INDEX_URL = "https://www.paj.gr.jp/english/statis/"
PAJ_BASE = "https://www.paj.gr.jp"

TEN_THOUSAND_KL = 10_000  # paj-05E publishes volumes in 10,000-kl units


# =========================================================
# Pydantic row models — mirror the two table schemas
# =========================================================


class CrudeSupplyRow(BaseModel):
    month: date
    production_kl: float | None = Field(default=None, ge=0)
    import_kl: float | None = Field(default=None, ge=0)
    non_refining_use_kl: float | None = Field(default=None, ge=0)
    refinery_throughput_kl: float | None = Field(default=None, ge=0)
    refining_capacity_bpd: float | None = Field(default=None, ge=0)
    utilization_pct: float | None = Field(default=None, ge=0, le=150)
    end_inventory_kl: float | None = Field(default=None, ge=0)
    status: Literal["provisional", "final"]
    source: str = "paj_01e"
    source_url: str

    model_config = {"extra": "forbid"}


class StockpileRow(BaseModel):
    month: date
    private_crude_kl: float | None = Field(default=None, ge=0)
    private_products_kl: float | None = Field(default=None, ge=0)
    private_days: float | None = Field(default=None, ge=0)
    government_crude_kl: float | None = Field(default=None, ge=0)
    government_products_kl: float | None = Field(default=None, ge=0)
    government_days: float | None = Field(default=None, ge=0)
    status: Literal["provisional", "final"]
    source: str = "paj_05e"
    source_url: str

    model_config = {"extra": "forbid"}


# =========================================================
# Workbook discovery
# =========================================================


def discover_workbook_url(stem: str) -> str:
    """Return the newest `<stem>_*.xls[x]` URL from the PAJ statistics index page."""
    resp = retry_get(PAJ_INDEX_URL, follow_redirects=True)
    soup = BeautifulSoup(resp.text, "lxml")
    candidates: list[str] = []
    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        if re.search(rf"{stem}[_].*\.xlsx?$", href, re.IGNORECASE):
            candidates.append(href if href.startswith("http") else PAJ_BASE + href)
    if not candidates:
        raise RuntimeError(f"No {stem} workbook found on {PAJ_INDEX_URL}")
    # URLs embed YYYY-MM/<stem>_<datecode>; lexicographic max is the newest.
    return sorted(candidates)[-1]


def _num(cell: Any) -> float | None:
    """Coerce a workbook cell to float; blank/dash/text -> None."""
    if cell is None or (isinstance(cell, float) and pd.isna(cell)):
        return None
    if isinstance(cell, int | float):
        return float(cell)
    s = str(cell).strip().replace(",", "")
    if not s or s in {"-", "－", "…", "nan"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


# =========================================================
# paj-01E — crude supply & demand
# =========================================================


def parse_paj01_workbook(content: bytes, source_url: str) -> list[dict[str, Any]]:
    """Parse the `Crude Oil` sheet into crude_supply_monthly row-dicts.

    Layout (verified 2026-07): col 0 month `YYYY.MM`, then
    production, import, non-refining use, throughput (kl), throughput (b/d),
    refining capacity (b/d), utilisation %, end inventory (kl).
    """
    df = pd.ExcelFile(BytesIO(content), engine="openpyxl").parse("Crude Oil", header=None)

    rows: list[tuple[date, dict[str, Any]]] = []
    for _, r in df.iterrows():
        label = str(r.iloc[0]).strip() if pd.notna(r.iloc[0]) else ""
        m = re.match(r"^(\d{4})\.(\d{2})$", label)
        if not m:
            continue
        month = date(int(m.group(1)), int(m.group(2)), 1)
        rows.append(
            (
                month,
                {
                    "production_kl": _num(r.iloc[1]),
                    "import_kl": _num(r.iloc[2]),
                    "non_refining_use_kl": _num(r.iloc[3]),
                    "refinery_throughput_kl": _num(r.iloc[4]),
                    # col 5 is throughput in b/d — derivable, skipped.
                    "refining_capacity_bpd": _num(r.iloc[6]),
                    "utilization_pct": _num(r.iloc[7]),
                    "end_inventory_kl": _num(r.iloc[8]),
                },
            )
        )

    if not rows:
        raise RuntimeError("paj-01E workbook contained no monthly rows")

    rows.sort(key=lambda t: t[0])
    latest = rows[-1][0]
    return [
        {
            "month": month.isoformat(),
            **fields,
            "status": "provisional" if month == latest else "final",
            "source": "paj_01e",
            "source_url": source_url,
        }
        for month, fields in rows
    ]


# =========================================================
# paj-05E — oil stockpiling
# =========================================================


def parse_paj05_workbook(content: bytes, source_url: str) -> list[dict[str, Any]]:
    """Parse the `epaj-5` sheet into oil_stockpile_monthly row-dicts.

    Layout (verified 2026-07): col 0 is `YYYY<space>M` on January rows and the
    bare month number otherwise (year carries forward). Volumes are 10,000-kl
    units — converted to kl here. Cols: 1 target days, 2 private crude,
    3 private products, 4 product-equivalent, 5 private days, 6 gov crude,
    7 gov products, 8 product-equivalent, 9 gov days.
    """
    df = pd.ExcelFile(BytesIO(content)).parse("epaj-5", header=None)

    rows: list[tuple[date, dict[str, Any]]] = []
    year: int | None = None
    for _, r in df.iterrows():
        label = str(r.iloc[0]).strip() if pd.notna(r.iloc[0]) else ""
        # January rows: "2017  1" / "2026　1"; other months: bare "2".."12".
        m_year = re.match(r"^(\d{4})[\s　]*(\d{1,2})$", label)
        m_bare = re.match(r"^(\d{1,2})$", label)
        if m_year:
            year = int(m_year.group(1))
            month_num = int(m_year.group(2))
        elif m_bare and year is not None:
            month_num = int(m_bare.group(1))
        else:
            continue
        if not 1 <= month_num <= 12:
            continue

        def scaled(cell: Any) -> float | None:
            v = _num(cell)
            return v * TEN_THOUSAND_KL if v is not None else None

        rows.append(
            (
                date(year, month_num, 1),
                {
                    "private_crude_kl": scaled(r.iloc[2]),
                    "private_products_kl": scaled(r.iloc[3]),
                    "private_days": _num(r.iloc[5]),
                    "government_crude_kl": scaled(r.iloc[6]),
                    "government_products_kl": scaled(r.iloc[7]),
                    "government_days": _num(r.iloc[9]),
                },
            )
        )

    if not rows:
        raise RuntimeError("paj-05E workbook contained no monthly rows")

    rows.sort(key=lambda t: t[0])
    latest = rows[-1][0]
    return [
        {
            "month": month.isoformat(),
            **fields,
            "status": "provisional" if month == latest else "final",
            "source": "paj_05e",
            "source_url": source_url,
        }
        for month, fields in rows
    ]


# =========================================================
# Main
# =========================================================


def main() -> int:
    init_sentry()
    client = supabase_client()

    with audit_run(client, kind="ingest_paj_supply") as state:
        url_01 = discover_workbook_url("paj-01E")
        logger.info("paj_supply: fetching %s", url_01)
        raw_01 = parse_paj01_workbook(retry_get(url_01, follow_redirects=True).content, url_01)
        valid_01, invalid_01 = validate(CrudeSupplyRow, raw_01)
        written_01 = upsert(client, "crude_supply_monthly", valid_01, conflict_cols=["month"])
        logger.info(
            "paj_supply: crude_supply_monthly wrote %d rows (%s → %s); rejected %d",
            written_01,
            valid_01[0].month if valid_01 else "-",
            valid_01[-1].month if valid_01 else "-",
            len(invalid_01),
        )

        url_05 = discover_workbook_url("paj-05E")
        logger.info("paj_supply: fetching %s", url_05)
        raw_05 = parse_paj05_workbook(retry_get(url_05, follow_redirects=True).content, url_05)
        valid_05, invalid_05 = validate(StockpileRow, raw_05)
        written_05 = upsert(client, "oil_stockpile_monthly", valid_05, conflict_cols=["month"])
        logger.info(
            "paj_supply: oil_stockpile_monthly wrote %d rows (%s → %s); rejected %d",
            written_05,
            valid_05[0].month if valid_05 else "-",
            valid_05[-1].month if valid_05 else "-",
            len(invalid_05),
        )

        state["row_count"] = written_01 + written_05
        state["output"] = {
            "crude_supply_rows": written_01,
            "crude_supply_rejected": len(invalid_01),
            "stockpile_rows": written_05,
            "stockpile_rejected": len(invalid_05),
            "source_urls": [url_01, url_05],
        }

    return 0


if __name__ == "__main__":
    sys.exit(main())

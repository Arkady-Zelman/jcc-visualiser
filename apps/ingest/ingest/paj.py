"""Ingest PAJ-published JCC monthly value into `jcc_monthly`.

Source: Petroleum Association of Japan, "Oil Import Price" worksheet
(paj-03E_YYMM.xlsx) published monthly on https://www.paj.gr.jp/english/statis/.

Why PAJ HTML/Excel and not e-Stat?
PAJ is the editorial source of truth for the JCC and publishes the full ~14-year
history in a single Excel workbook each month. e-Stat exposes the same MOF data
but requires APP_ID registration and statsDataId discovery (the canonical IDs were
not confirmable from desk research). PAJ Excel is simpler and authoritative.

Workbook layout (verified 2026-05):
  Sheet `2.Yen`     col 0 = YYYY.MM, col 1 = Crude Oil unit price (¥/kl)
  Sheet `3.Dollars` col 0 = YYYY.MM, col 1 = Crude Oil unit price ($/bbl), col 2 = FX
  Annual `YYYYFY` rows + a single "Latest month is preliminary figures" footnote.

Status mapping: latest month -> 'provisional', all others -> 'final'.
PAJ does not expose a separate "revised" stage — upsert on re-fetch handles that.

Run: `python -m ingest.paj` from apps/ingest/ with the venv active.
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


# =========================================================
# Pydantic row model — mirrors jcc_monthly schema
# =========================================================


class JccMonthlyRow(BaseModel):
    month: date
    jcc_value_jpy_per_kl: float = Field(gt=0)
    jcc_value_usd_per_bbl: float | None = Field(default=None, gt=0)
    status: Literal["provisional", "revised", "final"]
    source: str = "paj"
    source_url: str

    model_config = {"extra": "forbid"}


# =========================================================
# PAJ workbook discovery + parsing
# =========================================================


def discover_latest_paj03_url() -> str:
    """Return the absolute URL of the most recent paj-03E_*.xlsx on the PAJ index page."""
    resp = retry_get(PAJ_INDEX_URL, follow_redirects=True)
    soup = BeautifulSoup(resp.text, "lxml")
    candidates: list[str] = []
    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        if re.search(r"paj-03E[_].*\.xlsx?$", href, re.IGNORECASE):
            candidates.append(href if href.startswith("http") else PAJ_BASE + href)
    if not candidates:
        raise RuntimeError(f"No paj-03E Excel found on {PAJ_INDEX_URL}")
    # Pick lexicographically largest path (URLs embed YYYY-MM/paj-03E_YYMM).
    return sorted(candidates)[-1]


def _parse_month(cell: Any) -> date | None:
    """`'2012.01'` -> `date(2012, 1, 1)`; anything else (FY, NaN, header) -> None."""
    if not isinstance(cell, str):
        return None
    m = re.match(r"^(\d{4})\.(\d{2})$", cell.strip())
    if not m:
        return None
    return date(int(m.group(1)), int(m.group(2)), 1)


def parse_paj03_workbook(content: bytes, source_url: str) -> list[dict[str, Any]]:
    """Parse a paj-03E_YYMM.xlsx blob into a list of jcc_monthly row-dicts.

    Picks JPY/kl from sheet `2.Yen` col 1 and USD/bbl from sheet `3.Dollars` col 1.
    The very last monthly row is tagged `provisional`; everything else is `final`.
    """
    xls = pd.ExcelFile(BytesIO(content), engine="openpyxl")
    yen = xls.parse("2.Yen", header=None)
    usd = xls.parse("3.Dollars", header=None)

    # Build USD lookup: month -> usd_per_bbl
    usd_lookup: dict[date, float] = {}
    for _, row in usd.iterrows():
        m = _parse_month(row.iloc[0])
        if m is None:
            continue
        val = row.iloc[1]
        if pd.notna(val):
            usd_lookup[m] = float(val)

    # Build JPY rows
    rows: list[tuple[date, float]] = []
    for _, row in yen.iterrows():
        m = _parse_month(row.iloc[0])
        if m is None:
            continue
        val = row.iloc[1]
        if pd.notna(val):
            rows.append((m, float(val)))

    if not rows:
        raise RuntimeError("paj-03E workbook contained no monthly JCC rows")

    rows.sort(key=lambda r: r[0])
    latest_month = rows[-1][0]

    out: list[dict[str, Any]] = []
    for m, jpy_per_kl in rows:
        out.append(
            {
                "month": m.isoformat(),
                "jcc_value_jpy_per_kl": jpy_per_kl,
                "jcc_value_usd_per_bbl": usd_lookup.get(m),
                "status": "provisional" if m == latest_month else "final",
                "source": "paj",
                "source_url": source_url,
            }
        )
    return out


# =========================================================
# Main
# =========================================================


def main() -> int:
    init_sentry()
    client = supabase_client()

    with audit_run(client, kind="ingest_paj") as state:
        url = discover_latest_paj03_url()
        logger.info("paj: fetching %s", url)
        resp = retry_get(url, follow_redirects=True)
        raw_rows = parse_paj03_workbook(resp.content, source_url=url)
        valid, invalid = validate(JccMonthlyRow, raw_rows)
        if invalid:
            logger.warning("paj: %d rows rejected by Pydantic", len(invalid))

        written = upsert(client, "jcc_monthly", valid, conflict_cols=["month"])
        state["row_count"] = written
        state["output"] = {
            "source_url": url,
            "rows_parsed": len(raw_rows),
            "rows_written": written,
            "rows_rejected": len(invalid),
            "first_month": valid[0].month.isoformat() if valid else None,
            "last_month": valid[-1].month.isoformat() if valid else None,
            "rejected_samples": invalid[:3],
        }
        logger.info(
            "paj OK: wrote %d rows (%s → %s); rejected %d",
            written,
            valid[0].month.isoformat() if valid else "—",
            valid[-1].month.isoformat() if valid else "—",
            len(invalid),
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())

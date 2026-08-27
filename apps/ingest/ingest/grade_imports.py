"""Ingest measured grade-level crude imports (原油油種別輸入) into `grade_imports_monthly`.

Two e-Stat sources for the same survey (石油統計 / 石油製品需給動態統計調査, 00551020):

  A. Monthly 確報 workbook `dbseYYYYMMkakuho.xlsx` — sheet 原油輸入（時系列を含む）_1,
     one row per (month, origin country, 油種コード named grade) with 輸入量（kl）,
     rolling 16-month window. Same workbook paj_supply's crude-supply fallback
     downloads; grade rows reconcile exactly against the sheet's 合計 row.

  B. e-Stat DB table 0003171984 (資源・エネルギー統計年報 原油油種別輸入 月次,
     getStatsData API) — FROZEN history 2007-01..2024-03 in a different code
     space (cat01), used for one-off backfill. Mapped grades are pinned to
     workbook 油種コード via data/seed/grade_oil_mapping.yaml (annual_code);
     unmapped grades are stored as 'a'+cat01.

Boundary rule — the two code spaces must never cover the same month or unmapped
grades would double count:

  annual rows       months <  2023-11 (ANNUAL_CUTOFF)
  archived 確報      2023-11 .. 2025-02 (BACKFILL_ARCHIVE months, --backfill only)
  current 確報       newest workbook window (monthly cron)

Zero-volume template rows are dropped. Condensate streams (kana contains
コンデンセート / romanized name ends '-C') are flagged `is_condensate` — customs
imports_monthly is HS 2709.00.900 only, which excludes condensate, so comparisons
against the mapping-based composition must filter them out.

Run: `python -m ingest.grade_imports`             (current workbook — monthly cron)
     `python -m ingest.grade_imports --backfill`  (annual + archived + current)
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import unicodedata
from datetime import date
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

import pandas as pd
import yaml
from pydantic import BaseModel, Field

from ingest.common import (
    audit_run,
    init_sentry,
    load_env,
    retry_get,
    supabase_client,
    upsert,
    validate,
)
from ingest.customs import load_mof_to_iso
from ingest.paj_supply import (
    BROWSER_HEADERS,
    ESTAT_DATALIST_URL,
    ESTAT_DOWNLOAD_URL,
    _num,
    _parse_yyyymm,
    fetch_estat_supply_workbook,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

GRADE_SHEET_PREFIX = "原油輸入"
ANNUAL_STATS_DATA_ID = "0003171984"
ESTAT_API_URL = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"

# Annual table rows are only used strictly before this month; 2023-11 onward is
# covered by 確報 workbooks (BACKFILL_ARCHIVE below + the monthly current one).
ANNUAL_CUTOFF = date(2023, 11, 1)
# Archived 確報 workbooks fetched by --backfill. (2025, 2) has window 2023-11..2025-02,
# bridging the gap between ANNUAL_CUTOFF and the current workbook's window.
BACKFILL_ARCHIVE: list[tuple[int, int]] = [(2025, 2)]

# Grade-rows-vs-合計 reconciliation drift thresholds (fraction of the month total).
RECONCILE_WARN = 0.001
RECONCILE_RAISE = 0.01

CONDENSATE_KANA_RE = re.compile(r"コンデンセ[ーイ]ト")

_NFKC = lambda s: unicodedata.normalize("NFKC", str(s))  # noqa: E731


# =========================================================
# Row model
# =========================================================


class GradeImportRow(BaseModel):
    month: date
    oil_code: str = Field(pattern=r"^a?\d{4,6}$")
    oil_name: str = Field(min_length=1)
    oil_name_kana: str | None = None
    origin_country: str = Field(min_length=2, max_length=2)
    is_condensate: bool = False
    volume_kl: float = Field(gt=0)
    source: Literal["estat_kakuho", "estat_annual"]
    source_url: str

    model_config = {"extra": "forbid"}


# =========================================================
# Mapping YAML
# =========================================================


def load_grade_oil_mapping() -> dict[str, Any]:
    """Load data/seed/grade_oil_mapping.yaml.

    Returns {"mappings": [...], "by_annual": {annual_code: entry},
    "origin_overrides": {mof3: iso}, "country_kana": {kana: iso}}.
    """
    seed = Path(__file__).resolve().parents[3] / "data" / "seed" / "grade_oil_mapping.yaml"
    data = yaml.safe_load(seed.read_text(encoding="utf-8"))
    by_annual = {m["annual_code"]: m for m in data["mappings"] if m.get("annual_code")}
    return {
        "mappings": data["mappings"],
        "by_annual": by_annual,
        "origin_overrides": data.get("origin_overrides", {}),
        "country_kana": data.get("country_kana", {}),
    }


def grade_for_oil_code(mapping: dict[str, Any]) -> dict[str, str]:
    """Return {stored oil_code: grade_id} covering both code spaces.

    Workbook-coded entries key on oil_code; annual-only entries key on 'a'+annual_code
    (how the ingest stores them). Used by composition derivation / comparison.
    """
    out: dict[str, str] = {}
    for m in mapping["mappings"]:
        if m.get("oil_code"):
            out[m["oil_code"]] = m["grade_id"]
        elif m.get("annual_code"):
            out["a" + m["annual_code"]] = m["grade_id"]
    return out


def _is_condensate(name: str, kana: str | None) -> bool:
    if kana and CONDENSATE_KANA_RE.search(kana):
        return True
    return name.endswith("-C")


# =========================================================
# Source A — 確報 workbook grade sheet
# =========================================================


def _clean_code(cell: Any) -> str | None:
    """Coerce a code cell ('13701', 13701, 13701.0) to its digit string."""
    m = re.match(r"^(\d+)(?:\.0)?$", _NFKC(cell).strip())
    return m.group(1) if m else None


def parse_kakuho_grade_sheet(content: bytes, source_url: str) -> list[dict[str, Any]]:
    """Parse the 原油輸入（時系列を含む）sheet into grade_imports_monthly row-dicts.

    Layout (verified 2026-08, identical back to the 2025-02 edition): header row
    contains データ年月; rows are hierarchical — 地域名=合計 total, country
    subtotals (国コード without 油種コード), and grade detail rows (油種コード +
    原油名 + 輸入量(kl)). Only grade rows are stored; the 合計 row is used to
    reconcile (grade rows sum exactly to the published total).
    """
    xls = pd.ExcelFile(BytesIO(content), engine="openpyxl")
    sheet_name = next((n for n in xls.sheet_names if n.startswith(GRADE_SHEET_PREFIX)), None)
    if sheet_name is None:
        raise RuntimeError(f"Workbook has no {GRADE_SHEET_PREFIX}* sheet (got {xls.sheet_names})")
    df = xls.parse(sheet_name, header=None)

    header_idx, cols = None, {}
    for i in range(min(8, len(df))):
        names = [_NFKC(v) for v in df.iloc[i].tolist()]
        if any("データ年月" in n for n in names):
            header_idx, cols = i, {n: j for j, n in enumerate(names)}
            break
    if header_idx is None:
        raise RuntimeError("原油輸入 sheet has no データ年月 header row")

    def col(prefix: str) -> int:
        for name, j in cols.items():
            if name.startswith(prefix):
                return j
        raise RuntimeError(f"原油輸入 sheet column {prefix!r} not found in {list(cols)}")

    ym_c, region_c = col("データ年月"), col("地域名")
    ccode_c, ocode_c = col("国コード"), col("油種コード")
    name_c, kana_c, kl_c = col("原油名"), col("原油名漢字・カナ"), col("輸入量")

    mof_to_iso = load_mof_to_iso()
    overrides = load_grade_oil_mapping()["origin_overrides"]

    rows: list[dict[str, Any]] = []
    totals: dict[date, float] = {}
    sums: dict[date, float] = {}
    unknown_origins: set[str] = set()

    for i in range(header_idx + 1, len(df)):
        r = df.iloc[i]
        month = _parse_yyyymm(r.iloc[ym_c])
        if month is None:
            continue
        if _NFKC(r.iloc[region_c]).strip() == "合計":
            totals[month] = _num(r.iloc[kl_c]) or 0.0
            continue
        oil_code = _clean_code(r.iloc[ocode_c])
        if oil_code is None:
            continue  # region / country subtotal row
        vol = _num(r.iloc[kl_c])
        sums[month] = sums.get(month, 0.0) + (vol or 0.0)
        if not vol:
            continue  # zero-volume template row
        mof3 = _clean_code(r.iloc[ccode_c]) or oil_code[:3]
        iso = overrides.get(mof3) or mof_to_iso.get(mof3)
        if not iso:
            unknown_origins.add(mof3)
            continue
        name = _NFKC(r.iloc[name_c]).strip()
        kana = _NFKC(r.iloc[kana_c]).strip() if pd.notna(r.iloc[kana_c]) else None
        rows.append(
            {
                "month": month.isoformat(),
                "oil_code": oil_code,
                "oil_name": name,
                "oil_name_kana": kana,
                "origin_country": iso,
                "is_condensate": _is_condensate(name, kana),
                "volume_kl": vol,
                "source": "estat_kakuho",
                "source_url": source_url,
            }
        )

    if not rows:
        raise RuntimeError("原油輸入 sheet contained no grade rows")
    if unknown_origins:
        logger.warning("grade_imports: skipped rows with unknown MOF origin codes %s", sorted(unknown_origins))

    _reconcile(sums, totals, source_url)
    return rows


def _reconcile(sums: dict[date, float], totals: dict[date, float], source: str) -> None:
    """Grade rows must sum to the published per-month total (within tolerance)."""
    worst = 0.0
    for month, total in totals.items():
        if total <= 0:
            continue
        drift = abs(sums.get(month, 0.0) - total) / total
        worst = max(worst, drift)
        if drift > RECONCILE_WARN:
            logger.warning(
                "grade_imports: %s grade rows sum to %.0f vs published total %.0f (%.2f%%) [%s]",
                month, sums.get(month, 0.0), total, drift * 100, source,
            )
    if worst > RECONCILE_RAISE:
        raise RuntimeError(f"Grade rows drift {worst:.2%} from published totals in {source}")


def fetch_kakuho_workbook_for(year: int, month: int) -> tuple[bytes, str]:
    """Download the 確報 workbook for a specific archive month from e-Stat.

    Same datalist navigation as paj_supply.fetch_estat_supply_workbook, but
    pinned to (year, month) instead of the newest edition, and selecting on the
    原油輸入 sheet. Editions back to ~2020 share the current layout; older ones
    predate it (use the annual table for that history instead).
    """
    resp = retry_get(ESTAT_DATALIST_URL, follow_redirects=True, headers=BROWSER_HEADERS)
    nav = {
        (int(y), int(code[-2:])): code
        for y, code in re.findall(r"year=(\d{4})0&(?:amp;)?month=(\d+)", resp.text)
    }
    code = nav.get((year, month))
    if code is None:
        raise RuntimeError(f"No {year}-{month:02d} edition on {ESTAT_DATALIST_URL}")
    month_url = f"{ESTAT_DATALIST_URL}&year={year}0&month={code}"
    resp = retry_get(month_url, follow_redirects=True, headers=BROWSER_HEADERS)
    sids = sorted(set(re.findall(r"statInfId=(\d+)", resp.text)))

    last_exc: Exception | None = None
    for sid in sids:
        url = ESTAT_DOWNLOAD_URL.format(sid=sid)
        content = retry_get(url, follow_redirects=True, headers=BROWSER_HEADERS).content
        try:
            names = pd.ExcelFile(BytesIO(content), engine="openpyxl").sheet_names
        except Exception as exc:  # noqa: BLE001 — try the next candidate file
            last_exc = exc
            continue
        if any(n.startswith(GRADE_SHEET_PREFIX) for n in names):
            return content, url
    raise RuntimeError(
        f"No {year}-{month:02d} workbook with a {GRADE_SHEET_PREFIX} sheet among {sids}; last error: {last_exc}"
    )


# =========================================================
# Source B — frozen annual DB table (getStatsData API)
# =========================================================


def fetch_annual_rows(mapping: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch table 0003171984 and return row-dicts for months < ANNUAL_CUTOFF.

    cat01 names are `<country-kana>_<grade-kana>`. Codes pinned in
    grade_oil_mapping.yaml are stored under their workbook oil_code (same
    physical grade); everything else is stored as 'a'+cat01 with the country
    resolved via the YAML's country_kana table.
    """
    load_env()
    app_id = os.getenv("ESTAT_APP_ID")
    if not app_id:
        raise RuntimeError("ESTAT_APP_ID must be set for the annual backfill")

    values: list[dict[str, Any]] = []
    cat01_names: dict[str, str] = {}
    time_months: dict[str, date] = {}
    params: dict[str, Any] = {"appId": app_id, "statsDataId": ANNUAL_STATS_DATA_ID, "limit": 100000}
    source_url = f"{ESTAT_API_URL}?statsDataId={ANNUAL_STATS_DATA_ID}"

    while True:
        payload = retry_get(ESTAT_API_URL, params=params, timeout=180).json()["GET_STATS_DATA"]
        if int(payload["RESULT"]["STATUS"]) != 0:
            raise RuntimeError(f"getStatsData error: {payload['RESULT'].get('ERROR_MSG')}")
        stat = payload["STATISTICAL_DATA"]
        if not cat01_names:
            for obj in stat["CLASS_INF"]["CLASS_OBJ"]:
                cls = obj["CLASS"] if isinstance(obj["CLASS"], list) else [obj["CLASS"]]
                if obj["@id"] == "cat01":
                    cat01_names = {c["@code"]: _NFKC(c["@name"]) for c in cls}
                elif obj["@id"] == "time":
                    for c in cls:
                        m = re.match(r"^(\d{4})年(\d{1,2})月$", _NFKC(c["@name"]))
                        if m:
                            time_months[c["@code"]] = date(int(m.group(1)), int(m.group(2)), 1)
        chunk = stat["DATA_INF"]["VALUE"]
        values.extend(chunk if isinstance(chunk, list) else [chunk])
        next_key = stat["RESULT_INF"].get("NEXT_KEY")
        if not next_key:
            break
        params["startPosition"] = next_key

    by_annual = mapping["by_annual"]
    country_kana = mapping["country_kana"]

    rows: list[dict[str, Any]] = []
    totals: dict[date, float] = {}
    sums: dict[date, float] = {}
    unknown_countries: set[str] = set()

    for v in values:
        month = time_months.get(v["@time"])
        if month is None or month >= ANNUAL_CUTOFF:
            continue
        m_num = re.match(r"^([\d,.]+)$", v["$"].strip())
        vol = float(m_num.group(1).replace(",", "")) if m_num else None  # '―' = no trade
        cat01 = v["@cat01"]
        if cat01 == "10000":  # 合計 row — reconciliation only
            totals[month] = vol or 0.0
            continue
        sums[month] = sums.get(month, 0.0) + (vol or 0.0)
        if not vol:
            continue
        entry = by_annual.get(cat01)
        if entry:
            oil_code = entry.get("oil_code") or "a" + cat01
            name, kana, iso = entry["oil_name"], entry["kana"], entry["origin_country"]
        else:
            full = cat01_names.get(cat01, "")
            country, _, kana = full.partition("_")
            iso = country_kana.get(country)
            if not iso:
                unknown_countries.add(country)
                continue
            oil_code, name = "a" + cat01, kana or full
        rows.append(
            {
                "month": month.isoformat(),
                "oil_code": oil_code,
                "oil_name": name,
                "oil_name_kana": kana,
                "origin_country": iso,
                "is_condensate": _is_condensate(name, kana),
                "volume_kl": vol,
                "source": "estat_annual",
                "source_url": source_url,
            }
        )

    if not rows:
        raise RuntimeError("Annual table 0003171984 yielded no rows before the cutoff")
    if unknown_countries:
        logger.warning(
            "grade_imports: annual rows skipped for countries missing from country_kana: %s",
            sorted(unknown_countries),
        )
    _reconcile(sums, totals, source_url)
    return rows


# =========================================================
# Main
# =========================================================


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="also ingest the frozen annual table (2007-01..2023-10) and archived 確報 editions",
    )
    args = parser.parse_args(argv)

    init_sentry()
    client = supabase_client()
    mapping = load_grade_oil_mapping()

    with audit_run(client, kind="ingest_grade_imports") as state:
        # Later sources win on (month, oil_code): annual → archived 確報 → current 確報.
        merged: dict[tuple[str, str], dict[str, Any]] = {}
        source_urls: list[str] = []

        if args.backfill:
            annual = fetch_annual_rows(mapping)
            for row in annual:
                merged[(row["month"], row["oil_code"])] = row
            logger.info("grade_imports: annual backfill %d rows (< %s)", len(annual), ANNUAL_CUTOFF)
            for year, month in BACKFILL_ARCHIVE:
                content, url = fetch_kakuho_workbook_for(year, month)
                archived = parse_kakuho_grade_sheet(content, url)
                for row in archived:
                    merged[(row["month"], row["oil_code"])] = row
                source_urls.append(url)
                logger.info("grade_imports: archived %d-%02d edition %d rows", year, month, len(archived))

        content, url = fetch_estat_supply_workbook()
        current = parse_kakuho_grade_sheet(content, url)
        for row in current:
            merged[(row["month"], row["oil_code"])] = row
        source_urls.append(url)
        logger.info("grade_imports: current edition %d rows", len(current))

        valid, invalid = validate(GradeImportRow, list(merged.values()))
        written = upsert(client, "grade_imports_monthly", valid, conflict_cols=["month", "oil_code"])

        months = sorted({r.month for r in valid})
        state["row_count"] = written
        state["output"] = {
            "rows_written": written,
            "rejected": len(invalid),
            "months": f"{months[0]} → {months[-1]}" if months else None,
            "distinct_months": len(months),
            "backfill": args.backfill,
            "source_urls": source_urls,
        }
        logger.info(
            "grade_imports OK: %d rows across %d months (%s → %s); rejected %d",
            written, len(months), months[0] if months else "-", months[-1] if months else "-", len(invalid),
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())

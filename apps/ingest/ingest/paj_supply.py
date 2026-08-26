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

Fallbacks (PAJ blocks automated access since 2026-08):

  crude_supply_monthly ← e-Stat 石油統計 (石油製品需給動態統計調査, survey
  00551020) monthly 確報 workbook `dbseYYYYMMkakuho.xlsx`, a rolling 16-month
  window refreshed monthly. This is the *upstream* METI data PAJ repackages —
  values match paj-01E digit-for-digit on every overlapping month (verified
  2026-08 across 2025-03..2026-05). Sheet mapping:
    原油受払（確報）      区分名=輸入原油 直受入量        → import_kl
                          区分名=精製業者 消費（原油処理）量 → refinery_throughput_kl
    時系列表_原油のうち生産、在庫  生産量 / 在庫総量      → production_kl / end_inventory_kl
    時系列表_非精製用出荷内訳      出荷合計               → non_refining_use_kl
  The workbook has no capacity column; refining_capacity_bpd is carried forward
  from the latest PAJ row and utilization_pct recomputed with PAJ's own formula
  (throughput b/d ÷ capacity b/d — reproduces PAJ's published % exactly).

  oil_stockpile_monthly ← ANRE 石油備蓄の現況 monthly PDF
  (https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl001/), the
  upstream source of paj-05E. 国家備蓄 → government, 民間備蓄 → private
  (産油国共同備蓄 has no column in our schema and is skipped); the non-IEA
  備蓄日数 figure matches paj-05E days. A PDF published in month M reports
  end-of-month M-2. Values are 万kl, same rounding PAJ republishes.

Fallback rows never overwrite PAJ-sourced months and are themselves overwritten
by PAJ (same `month` conflict key) if PAJ becomes reachable again.

Run: `python -m ingest.paj_supply` from apps/ingest/ with the venv active.
"""

from __future__ import annotations

import logging
import re
import sys
import unicodedata
from calendar import monthrange
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

TEN_THOUSAND_KL = 10_000  # paj-05E and ANRE stockpile PDFs publish volumes in 10,000-kl units
KL_TO_BBL = 6.28981  # barrels per kilolitre (same constant as ingest.paj)

# e-Stat file listing for the 石油統計 monthly 確報 (tstat tree discovered 2026-08;
# the datalist page defaults to the newest month and links its statInfId downloads).
ESTAT_DATALIST_URL = (
    "https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist"
    "&toukei=00551020&tstat=000001024838&cycle=1"
    "&tclass1=000001080335&tclass2=000001080336&tclass3val=0"
)
ESTAT_DOWNLOAD_URL = "https://www.e-stat.go.jp/stat-search/file-download?statInfId={sid}&fileKind=0"

ENECHO_RESULTS_URL = "https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl001/results.html"
ENECHO_BASE = "https://www.enecho.meti.go.jp"
# enecho.meti.go.jp returns 403 to non-browser User-Agents; e-Stat does not care.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    )
}
MAX_ENECHO_PDFS = 8  # politeness cap per run; each PDF covers one month

REIWA_OFFSET = 2018  # 令和 year 1 = 2019


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
# Fallback A — crude supply from the e-Stat 石油統計 monthly 確報 workbook
# =========================================================


def fetch_estat_supply_workbook() -> tuple[bytes, str]:
    """Download the newest 石油統計 確報 workbook (`dbseYYYYMMkakuho.xlsx`) from e-Stat.

    The datalist page carries only year/month navigation (`&year=YYYY0&month=<code>`,
    where the code's last two digits are the month number); the per-month page then
    links `file-download?statInfId=...` endpoints. statInfIds change every month,
    so they are scraped rather than pinned.
    """
    resp = retry_get(ESTAT_DATALIST_URL, follow_redirects=True, headers=BROWSER_HEADERS)
    nav = {
        (int(y), int(code[-2:]), code)
        for y, code in re.findall(r"year=(\d{4})0&(?:amp;)?month=(\d+)", resp.text)
    }
    if not nav:
        raise RuntimeError(f"No year/month navigation found on {ESTAT_DATALIST_URL}")
    year, _, code = max(nav)
    month_url = f"{ESTAT_DATALIST_URL}&year={year}0&month={code}"
    resp = retry_get(month_url, follow_redirects=True, headers=BROWSER_HEADERS)
    sids = sorted(set(re.findall(r"statInfId=(\d+)", resp.text)))
    if not sids:
        raise RuntimeError(f"No statInfId found on {month_url}")

    last_exc: Exception | None = None
    for sid in sids:
        url = ESTAT_DOWNLOAD_URL.format(sid=sid)
        content = retry_get(url, follow_redirects=True, headers=BROWSER_HEADERS).content
        try:
            names = pd.ExcelFile(BytesIO(content), engine="openpyxl").sheet_names
        except Exception as exc:  # noqa: BLE001 — try the next candidate file
            last_exc = exc
            continue
        if any(n.startswith("原油受払") for n in names):
            return content, url
    raise RuntimeError(
        f"No e-Stat workbook with a 原油受払 sheet among statInfIds {sids}; last error: {last_exc}"
    )


def _parse_yyyymm(cell: Any) -> date | None:
    """`202606` / `'202606'` / `202606.0` -> date(2026, 6, 1); anything else -> None."""
    m = re.match(r"^(\d{4})(\d{2})(?:\.0)?$", str(cell).strip())
    if not m or not 1 <= int(m.group(2)) <= 12:
        return None
    return date(int(m.group(1)), int(m.group(2)), 1)


def parse_estat_supply_workbook(content: bytes, source_url: str) -> list[dict[str, Any]]:
    """Flatten the 確報 workbook's crude sheets into crude_supply_monthly row-dicts.

    Values verified identical to paj-01E for every overlapping month (2026-08).
    Capacity/utilisation are not in this workbook — filled in later by
    `derive_supply_fallback_rows`.
    """
    xls = pd.ExcelFile(BytesIO(content), engine="openpyxl")

    def sheet(prefix: str) -> pd.DataFrame:
        for name in xls.sheet_names:
            if name.startswith(prefix):
                return xls.parse(name, header=None)
        raise RuntimeError(f"e-Stat workbook missing sheet {prefix!r} (got {xls.sheet_names})")

    def header_cols(df: pd.DataFrame) -> tuple[int, dict[str, int]]:
        """Locate the header row (contains データ年月) and map NFKC-normalised names → col idx."""
        for i in range(min(8, len(df))):
            names = [unicodedata.normalize("NFKC", str(v)) for v in df.iloc[i].tolist()]
            if any("データ年月" in n for n in names):
                return i, {n: j for j, n in enumerate(names)}
        raise RuntimeError("e-Stat sheet has no データ年月 header row")

    def col(mapping: dict[str, int], prefix: str) -> int:
        for name, j in mapping.items():
            if name.startswith(prefix):
                return j
        raise RuntimeError(f"e-Stat sheet column {prefix!r} not found in {list(mapping)}")

    by_month: dict[date, dict[str, Any]] = {}

    # 原油受払（確報） — one row per (month, 区分); imports + refinery throughput.
    s2 = sheet("原油受払")
    h, c = header_cols(s2)
    ym_c, kubun_c = col(c, "データ年月"), col(c, "区分名")
    ukeire_c, shohi_c = col(c, "直受入量"), col(c, "消費(原油処理)量")
    for i in range(h + 1, len(s2)):
        r = s2.iloc[i]
        month = _parse_yyyymm(r.iloc[ym_c])
        if month is None:
            continue
        kubun = unicodedata.normalize("NFKC", str(r.iloc[kubun_c])).strip()
        fields = by_month.setdefault(month, {})
        if kubun == "輸入原油":
            fields["import_kl"] = _num(r.iloc[ukeire_c])
        elif kubun == "精製業者":
            fields["refinery_throughput_kl"] = _num(r.iloc[shohi_c])

    # 時系列表_原油のうち生産、在庫 — domestic production + total end inventory.
    s9 = sheet("時系列表_原油のうち生産")
    h, c = header_cols(s9)
    ym_c, prod_c, inv_c = col(c, "データ年月"), col(c, "生産量"), col(c, "在庫総量")
    for i in range(h + 1, len(s9)):
        r = s9.iloc[i]
        month = _parse_yyyymm(r.iloc[ym_c])
        if month is None:
            continue
        fields = by_month.setdefault(month, {})
        fields["production_kl"] = _num(r.iloc[prod_c])
        fields["end_inventory_kl"] = _num(r.iloc[inv_c])

    # 時系列表_非精製用出荷内訳 — non-refining shipments.
    s8 = sheet("時系列表_非精製用出荷内訳")
    h, c = header_cols(s8)
    ym_c, ship_c = col(c, "データ年月"), col(c, "出荷合計")
    for i in range(h + 1, len(s8)):
        r = s8.iloc[i]
        month = _parse_yyyymm(r.iloc[ym_c])
        if month is None:
            continue
        by_month.setdefault(month, {})["non_refining_use_kl"] = _num(r.iloc[ship_c])

    if not by_month:
        raise RuntimeError("e-Stat 確報 workbook contained no monthly rows")

    latest = max(by_month)
    return [
        {
            "month": month.isoformat(),
            **fields,
            "status": "provisional" if month == latest else "final",
            "source": "estat_kakuho",
            "source_url": source_url,
        }
        for month, fields in sorted(by_month.items())
    ]


def derive_supply_fallback_rows(client) -> list[dict[str, Any]]:
    """Build estat-sourced crude_supply_monthly rows for months PAJ has not published.

    Never touches a month that already has a paj_01e row. Capacity is carried
    forward from the latest PAJ row (it changes rarely and only via refinery
    closures PAJ would republish anyway); utilisation is recomputed with PAJ's
    formula, which reproduces PAJ's published percentages exactly.
    """
    content, url = fetch_estat_supply_workbook()
    parsed = parse_estat_supply_workbook(content, url)

    existing = (
        client.table("crude_supply_monthly")
        .select("month, source, refining_capacity_bpd")
        .order("month")
        .execute()
    )
    rows = existing.data or []
    paj_months = {r["month"] for r in rows if r["source"] == "paj_01e"}
    capacity = next(
        (
            float(r["refining_capacity_bpd"])
            for r in reversed(rows)
            if r["source"] == "paj_01e" and r["refining_capacity_bpd"]
        ),
        None,
    )

    out: list[dict[str, Any]] = []
    for row in parsed:
        if row["month"] in paj_months:
            continue
        throughput = row.get("refinery_throughput_kl")
        if capacity and throughput:
            month = date.fromisoformat(row["month"])
            days = monthrange(month.year, month.month)[1]
            row["refining_capacity_bpd"] = capacity
            row["utilization_pct"] = round(throughput * KL_TO_BBL / days / capacity * 100, 1)
        out.append(row)
    return out


# =========================================================
# Fallback B — stockpiles from the ANRE 石油備蓄の現況 monthly PDF
# =========================================================


def discover_enecho_pdf_urls() -> list[str]:
    """Return 石油備蓄の現況 PDF URLs, newest first (paths embed YYMMDD publish dates)."""
    resp = retry_get(ENECHO_RESULTS_URL, follow_redirects=True, headers=BROWSER_HEADERS)
    paths = set(
        re.findall(r"/statistics/petroleum_and_lpgas/pl001/pdf/\d{4}/\d{6}oil\.pdf", resp.text)
    )
    if not paths:
        raise RuntimeError(f"No 石油備蓄の現況 PDFs found on {ENECHO_RESULTS_URL}")
    ordered = sorted(paths, key=lambda p: re.findall(r"(\d{6})oil\.pdf", p)[0], reverse=True)
    return [ENECHO_BASE + p for p in ordered]


def parse_enecho_pdf(content: bytes, source_url: str) -> dict[str, Any]:
    """Parse one 石油備蓄の現況 PDF into an oil_stockpile_monthly row-dict.

    The PDF is a single text page; after NFKC-normalising and stripping all
    whitespace it reads e.g.
      令和8年5月末現在...国家備蓄109日分3,067万kl...原油3,078万kl...製品142万kl
      民間備蓄92日分...原油1,138万kl...製品1,520万kl産油国共同備蓄...
    国家備蓄 → government, 民間備蓄 → private; the first N日分 per section is the
    non-IEA figure paj-05E republishes. 産油国共同備蓄 has no schema column.
    """
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover — pypdf is in pyproject deps
        raise RuntimeError("pypdf is required for the ANRE stockpile fallback") from exc

    text = "".join(page.extract_text() or "" for page in PdfReader(BytesIO(content)).pages)
    text = re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))

    m = re.search(r"令和(\d+)年(\d+)月末現在", text)
    if not m:
        raise RuntimeError(f"No 令和N年M月末現在 date in {source_url}")
    month = date(REIWA_OFFSET + int(m.group(1)), int(m.group(2)), 1)

    def section(pattern: str) -> tuple[float, str]:
        sm = re.search(pattern, text)
        if not sm:
            raise RuntimeError(f"Stockpile section {pattern!r} not found in {source_url}")
        return float(sm.group(1)), sm.group(2)

    def volumes(segment: str, label: str) -> float | None:
        vm = re.search(rf"{label}([\d,]+)万kl", segment)
        return float(vm.group(1).replace(",", "")) * TEN_THOUSAND_KL if vm else None

    gov_days, gov_seg = section(r"国家備蓄(\d+)日分(.*?)民間備蓄")
    priv_days, priv_seg = section(r"民間備蓄(\d+)日分(.*?)産油国共同備蓄")

    return {
        "month": month.isoformat(),
        "private_crude_kl": volumes(priv_seg, "原油"),
        "private_products_kl": volumes(priv_seg, "製品"),
        "private_days": priv_days,
        "government_crude_kl": volumes(gov_seg, "原油"),
        "government_products_kl": volumes(gov_seg, "製品"),
        "government_days": gov_days,
        "status": "provisional",
        "source": "enecho_stockpile",
        "source_url": source_url,
    }


def _months_back(d: date, n: int) -> date:
    total = d.year * 12 + (d.month - 1) - n
    return date(total // 12, total % 12 + 1, 1)


def derive_stockpile_fallback_rows(client) -> list[dict[str, Any]]:
    """Build ANRE-sourced oil_stockpile_monthly rows for months PAJ has not published.

    Walks the PDF list newest-first; a PDF published in month M reports end of
    M-2, so the walk stops at the first PDF whose (estimated) data month is
    already in the table. Never touches a month with a paj_05e row.

    Skips the network entirely when the newest possible data month (today − 2)
    is already present — enecho.meti.go.jp soft-blocks (empty HTTP 202) after
    repeated automated hits, so don't fetch when there is nothing to fill.
    """
    existing = client.table("oil_stockpile_monthly").select("month, source").execute()
    rows = existing.data or []
    paj_months = {r["month"] for r in rows if r["source"] == "paj_05e"}
    all_months = {r["month"] for r in rows}

    today = date.today()
    newest_expected = _months_back(date(today.year, today.month, 1), 2)
    if all_months and max(all_months) >= newest_expected.isoformat():
        return []

    out: list[dict[str, Any]] = []
    fetched = 0
    for url in discover_enecho_pdf_urls():
        if fetched >= MAX_ENECHO_PDFS:
            logger.warning("paj_supply: stockpile fallback hit the %d-PDF cap", MAX_ENECHO_PDFS)
            break
        pub = re.search(r"/(\d{2})(\d{2})\d{2}oil\.pdf$", url)
        if not pub:
            continue
        est_data_month = _months_back(date(2000 + int(pub.group(1)), int(pub.group(2)), 1), 2)
        if est_data_month.isoformat() in all_months:
            break  # this month and everything older is already in the table

        content = retry_get(url, follow_redirects=True, headers=BROWSER_HEADERS).content
        fetched += 1
        row = parse_enecho_pdf(content, url)
        if row["month"] in paj_months or any(r["month"] == row["month"] for r in out):
            continue
        out.append(row)

    out.sort(key=lambda r: r["month"])
    return out


# =========================================================
# Main
# =========================================================


def main() -> int:
    init_sentry()
    client = supabase_client()

    with audit_run(client, kind="ingest_paj_supply") as state:
        output: dict[str, Any] = {}

        # ---- crude_supply_monthly: PAJ workbook first, e-Stat 確報 fallback.
        written_01 = 0
        paj01_error: str | None = None
        try:
            url_01 = discover_workbook_url("paj-01E")
            logger.info("paj_supply: fetching %s", url_01)
            raw_01 = parse_paj01_workbook(retry_get(url_01, follow_redirects=True).content, url_01)
            valid_01, invalid_01 = validate(CrudeSupplyRow, raw_01)
            written_01 = upsert(client, "crude_supply_monthly", valid_01, conflict_cols=["month"])
            logger.info(
                "paj_supply: crude_supply_monthly wrote %d PAJ rows (%s → %s); rejected %d",
                written_01,
                valid_01[0].month if valid_01 else "-",
                valid_01[-1].month if valid_01 else "-",
                len(invalid_01),
            )
            output["crude_supply"] = {
                "source_url": url_01,
                "rows_written": written_01,
                "rows_rejected": len(invalid_01),
            }
        except Exception as exc:  # noqa: BLE001 — PAJ blocks bots (403 since 2026-08); fall back
            paj01_error = f"{type(exc).__name__}: {exc}"
            logger.warning("paj_supply: paj-01E failed (%s) — using e-Stat fallback", paj01_error)

        # Fill months PAJ has not (or could not) publish from the e-Stat 確報 workbook.
        written_fb01 = 0
        fb01_error: str | None = None
        try:
            fb_rows_01 = derive_supply_fallback_rows(client)
            valid_fb01, invalid_fb01 = validate(CrudeSupplyRow, fb_rows_01)
            written_fb01 = upsert(
                client, "crude_supply_monthly", valid_fb01, conflict_cols=["month"]
            )
            if written_fb01:
                logger.info(
                    "paj_supply: crude_supply_monthly wrote %d estat_kakuho rows (%s → %s)",
                    written_fb01,
                    valid_fb01[0].month if valid_fb01 else "-",
                    valid_fb01[-1].month if valid_fb01 else "-",
                )
            output["crude_supply_fallback"] = {
                "rows_written": written_fb01,
                "rows_rejected": len(invalid_fb01),
            }
        except Exception as exc:  # noqa: BLE001 — a fallback hiccup must not sink a good PAJ run
            fb01_error = f"{type(exc).__name__}: {exc}"
            logger.warning("paj_supply: e-Stat supply fallback failed: %s", fb01_error)
        if paj01_error and fb01_error:
            raise RuntimeError(
                f"crude supply: PAJ failed ({paj01_error}); "
                f"e-Stat fallback failed ({fb01_error})"
            )

        # ---- oil_stockpile_monthly: PAJ workbook first, ANRE PDF fallback.
        written_05 = 0
        paj05_error: str | None = None
        try:
            url_05 = discover_workbook_url("paj-05E")
            logger.info("paj_supply: fetching %s", url_05)
            raw_05 = parse_paj05_workbook(retry_get(url_05, follow_redirects=True).content, url_05)
            valid_05, invalid_05 = validate(StockpileRow, raw_05)
            written_05 = upsert(client, "oil_stockpile_monthly", valid_05, conflict_cols=["month"])
            logger.info(
                "paj_supply: oil_stockpile_monthly wrote %d PAJ rows (%s → %s); rejected %d",
                written_05,
                valid_05[0].month if valid_05 else "-",
                valid_05[-1].month if valid_05 else "-",
                len(invalid_05),
            )
            output["stockpile"] = {
                "source_url": url_05,
                "rows_written": written_05,
                "rows_rejected": len(invalid_05),
            }
        except Exception as exc:  # noqa: BLE001 — PAJ blocks bots (403 since 2026-08); fall back
            paj05_error = f"{type(exc).__name__}: {exc}"
            logger.warning("paj_supply: paj-05E failed (%s) — using ANRE fallback", paj05_error)

        # Fill months PAJ has not (or could not) publish from the ANRE stockpile PDFs.
        written_fb05 = 0
        fb05_error: str | None = None
        try:
            fb_rows_05 = derive_stockpile_fallback_rows(client)
            valid_fb05, invalid_fb05 = validate(StockpileRow, fb_rows_05)
            written_fb05 = upsert(
                client, "oil_stockpile_monthly", valid_fb05, conflict_cols=["month"]
            )
            if written_fb05:
                logger.info(
                    "paj_supply: oil_stockpile_monthly wrote %d enecho_stockpile rows (%s → %s)",
                    written_fb05,
                    valid_fb05[0].month if valid_fb05 else "-",
                    valid_fb05[-1].month if valid_fb05 else "-",
                )
            output["stockpile_fallback"] = {
                "rows_written": written_fb05,
                "rows_rejected": len(invalid_fb05),
            }
        except Exception as exc:  # noqa: BLE001 — a fallback hiccup must not sink a good PAJ run
            fb05_error = f"{type(exc).__name__}: {exc}"
            logger.warning("paj_supply: ANRE stockpile fallback failed: %s", fb05_error)
        if paj05_error and fb05_error:
            raise RuntimeError(
                f"stockpile: PAJ failed ({paj05_error}) and ANRE fallback failed ({fb05_error})"
            )

        output["paj01_error"] = paj01_error
        output["paj05_error"] = paj05_error
        state["row_count"] = written_01 + written_fb01 + written_05 + written_fb05
        state["output"] = output

    return 0


if __name__ == "__main__":
    sys.exit(main())

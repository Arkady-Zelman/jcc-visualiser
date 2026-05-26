"""Derive monthly basket composition (composition_monthly) from imports_monthly + grade_hs_mapping.

For each (month, hs_code, origin_country) row in imports_monthly:
  1. Look up matching rows in grade_hs_mapping where month ∈ [applies_from, applies_to).
  2. If no mapping is found, attribute the volume to a synthetic `unmapped_<origin>` grade.
  3. Distribute volume + value across the matched grades by weight_pct.
  4. Compute share_pct per (month, grade_id) as volume divided by month total × 100.
  5. UPSERT composition_monthly. Update grades.first_seen_in_jcc / last_seen_in_jcc.

The synthetic `unmapped_<origin>` grades are created on-demand. This is by design:
Iran (IR) is intentionally unmapped so the 2018 sanctions collapse renders as a
visible band on /composition.

Run: `python -m ingest.derive_composition` from apps/ingest/ with the venv active.
"""

from __future__ import annotations

import logging
import sys
from collections import defaultdict
from datetime import date
from typing import Any

from ingest.common import audit_run, init_sentry, supabase_client, upsert

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _load_all(client, table: str, columns: str, chunk: int = 1000) -> list[dict[str, Any]]:
    """Page through a Supabase table. PostgREST caps single requests at 1000 rows."""
    out: list[dict[str, Any]] = []
    start = 0
    while True:
        resp = (
            client.table(table)
            .select(columns)
            .order(columns.split(",")[0].strip())
            .range(start, start + chunk - 1)
            .execute()
        )
        rows = resp.data or []
        out.extend(rows)
        if len(rows) < chunk:
            break
        start += chunk
    return out


def _mapping_lookup(
    mappings: list[dict[str, Any]],
) -> dict[tuple[str, str], list[dict[str, Any]]]:
    """Group mappings by (hs_code, origin_country); each list is the validity timeline."""
    out: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for m in mappings:
        out[(m["hs_code"], m["origin_country"])].append(m)
    return out


def _resolve_mapping(
    month: date,
    mappings: list[dict[str, Any]],
) -> list[dict[str, Any]] | None:
    """Return the mapping rows whose [applies_from, applies_to) window contains `month`."""
    matched: list[dict[str, Any]] = []
    for m in mappings:
        af = date.fromisoformat(m["applies_from"])
        at = date.fromisoformat(m["applies_to"]) if m.get("applies_to") else None
        if af <= month and (at is None or month < at):
            matched.append(m)
    return matched or None


def _ensure_unmapped_grade(client, origin: str, known_ids: set[str]) -> str:
    """Ensure a synthetic `unmapped_<origin>` grade exists in `grades`. Return its id."""
    gid = f"unmapped_{origin}"
    if gid in known_ids:
        return gid
    # Insert idempotently. The check constraint on `region` requires a valid enum;
    # we use 'other' for synthetic buckets.
    client.table("grades").upsert(
        {
            "id": gid,
            "display_name": f"Other {origin}",
            "origin_country": origin,
            "region": "other",
            "type": "medium_sour",  # placeholder; not displayed for unmapped buckets
            "notes": f"Synthetic bucket for {origin} imports with no curated grade mapping.",
        },
        on_conflict="id",
    ).execute()
    known_ids.add(gid)
    return gid


def main() -> int:
    init_sentry()
    client = supabase_client()

    with audit_run(client, kind="derive_composition") as state:
        imports = _load_all(client, "imports_monthly", "month, hs_code, origin_country, volume_kl, value_jpy")
        mappings = _load_all(
            client,
            "grade_hs_mapping",
            "hs_code, origin_country, grade_id, weight_pct, applies_from, applies_to",
        )
        grades = _load_all(client, "grades", "id")
        known_grade_ids = {g["id"] for g in grades}

        logger.info(
            "derive: %d imports rows, %d mappings, %d known grades",
            len(imports),
            len(mappings),
            len(known_grade_ids),
        )

        if not imports:
            state["row_count"] = 0
            state["output"] = {"reason": "imports_monthly is empty; run ingest.customs first"}
            logger.warning("derive: imports_monthly is empty — skipping derivation")
            return 0

        lookup = _mapping_lookup(mappings)

        # Step 1: per (month, grade) accumulator.
        per_grade: dict[tuple[str, str], dict[str, float]] = defaultdict(
            lambda: {"volume_kl": 0.0, "value_jpy": 0.0}
        )
        unmapped_counts: dict[str, int] = defaultdict(int)

        for row in imports:
            month = row["month"]
            month_date = date.fromisoformat(month)
            hs = row["hs_code"]
            origin = row["origin_country"]
            vol = float(row.get("volume_kl") or 0)
            val = float(row.get("value_jpy") or 0)
            if vol <= 0:
                continue

            matches = _resolve_mapping(month_date, lookup.get((hs, origin), []))
            if not matches:
                gid = _ensure_unmapped_grade(client, origin, known_grade_ids)
                unmapped_counts[origin] += 1
                per_grade[(month, gid)]["volume_kl"] += vol
                per_grade[(month, gid)]["value_jpy"] += val
                continue

            for m in matches:
                w = float(m["weight_pct"]) / 100.0
                per_grade[(month, m["grade_id"])]["volume_kl"] += vol * w
                per_grade[(month, m["grade_id"])]["value_jpy"] += val * w

        # Step 2: compute share_pct per month.
        month_totals: dict[str, float] = defaultdict(float)
        for (month, _gid), agg in per_grade.items():
            month_totals[month] += agg["volume_kl"]

        composition_rows: list[dict[str, Any]] = []
        for (month, gid), agg in per_grade.items():
            month_total = month_totals[month]
            share = (agg["volume_kl"] / month_total * 100.0) if month_total > 0 else 0.0
            composition_rows.append(
                {
                    "month": month,
                    "grade_id": gid,
                    "volume_kl": round(agg["volume_kl"], 3),
                    "value_jpy": int(round(agg["value_jpy"])),
                    "share_pct": round(share, 3),
                    "source": "derived",
                }
            )

        # Step 3: UPSERT.
        written = upsert(
            client,
            "composition_monthly",
            composition_rows,
            conflict_cols=["month", "grade_id"],
        )

        # Step 4: update grades.first_seen_in_jcc / last_seen_in_jcc.
        seen_by_grade: dict[str, list[str]] = defaultdict(list)
        for r in composition_rows:
            seen_by_grade[r["grade_id"]].append(r["month"])
        for gid, months in seen_by_grade.items():
            months.sort()
            client.table("grades").update(
                {
                    "first_seen_in_jcc": months[0],
                    "last_seen_in_jcc": months[-1],
                }
            ).eq("id", gid).execute()

        state["row_count"] = written
        state["output"] = {
            "rows_written": written,
            "distinct_months": len(month_totals),
            "distinct_grades": len(seen_by_grade),
            "unmapped_by_origin": dict(unmapped_counts),
        }
        logger.info(
            "derive OK: %d composition_monthly rows across %d months × %d grades; unmapped origins: %s",
            written,
            len(month_totals),
            len(seen_by_grade),
            sorted(unmapped_counts.items(), key=lambda x: -x[1])[:5],
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())

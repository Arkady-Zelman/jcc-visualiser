"""Compare the measured grade composition against the mapping-derived one.

Measured:  grade_imports_monthly (e-Stat 原油油種別輸入, actual volumes per named
           grade) aggregated to curated grade ids via grade_oil_mapping.yaml;
           condensate rows excluded to match the HS 2709.00.900 scope of the
           customs pipeline; unlisted codes → `unmapped_<origin>` (same synthetic
           convention derive_composition uses).
Derived:   composition_monthly (Japan Customs imports_monthly × the fixed
           weights in grade_hs_mapping.yaml).

Read-only analysis — writes nothing to the database. Prints:
  1. coverage + monthly total-volume cross-check (e-Stat vs customs),
  2. latest-common-month and trailing-12-month share comparison per grade,
  3. per-grade divergence stats over the full overlap,
  4. sanity signatures in the measured data (Iran 2018 collapse, Russia 2022).

Run: `python -m ingest.compare_composition` from apps/ingest/ with the venv active.
"""

from __future__ import annotations

import logging
import sys
from collections import defaultdict
from datetime import date

from ingest.common import supabase_client
from ingest.derive_composition import _load_all
from ingest.grade_imports import grade_for_oil_code, load_grade_oil_mapping

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.WARNING)

# Frontend data-quality cutoff (see commit df54a4c) — compare from here.
START = "2016-01-01"


def measured_composition(rows: list[dict]) -> dict[str, dict[str, float]]:
    """{month: {grade_id: share_pct}} from grade_imports_monthly rows (condensate excluded)."""
    mapping = grade_for_oil_code(load_grade_oil_mapping())
    vol: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in rows:
        if r["is_condensate"]:
            continue
        gid = mapping.get(r["oil_code"]) or f"unmapped_{r['origin_country']}"
        vol[r["month"]][gid] += float(r["volume_kl"])
    return {
        m: {g: v / total * 100.0 for g, v in grades.items()}
        for m, grades in vol.items()
        if (total := sum(grades.values())) > 0
    }


def derived_composition(rows: list[dict]) -> dict[str, dict[str, float]]:
    """{month: {grade_id: share_pct}} from composition_monthly rows."""
    out: dict[str, dict[str, float]] = defaultdict(dict)
    for r in rows:
        out[r["month"]][r["grade_id"]] = float(r["share_pct"])
    return dict(out)


def _avg_shares(comp: dict[str, dict[str, float]], months: list[str]) -> dict[str, float]:
    acc: dict[str, float] = defaultdict(float)
    for m in months:
        for g, s in comp.get(m, {}).items():
            acc[g] += s
    return {g: v / len(months) for g, v in acc.items()} if months else {}


def main() -> int:
    client = supabase_client()

    measured_rows = _load_all(
        client, "grade_imports_monthly", "month, oil_code, origin_country, is_condensate, volume_kl"
    )
    derived_rows = _load_all(client, "composition_monthly", "month, grade_id, share_pct, volume_kl")
    imports_rows = _load_all(client, "imports_monthly", "month, hs_code, volume_kl")

    measured = measured_composition(measured_rows)
    derived = derived_composition(derived_rows)

    m_months = sorted(m for m in measured if m >= START)
    d_months = sorted(m for m in derived if m >= START)
    overlap = sorted(set(m_months) & set(d_months))
    print(f"measured months ≥{START[:7]}: {len(m_months)} ({m_months[0][:7]} → {m_months[-1][:7]})")
    print(f"derived  months ≥{START[:7]}: {len(d_months)} ({d_months[0][:7]} → {d_months[-1][:7]})")
    print(f"overlap: {len(overlap)} months")

    # ---- 1. total-volume cross-check (condensate-free e-Stat vs customs 2709.00.900)
    m_tot: dict[str, float] = defaultdict(float)
    for r in measured_rows:
        if not r["is_condensate"]:
            m_tot[r["month"]] += float(r["volume_kl"])
    c_tot: dict[str, float] = defaultdict(float)
    for r in imports_rows:
        if r["hs_code"] == "2709.00.900":
            c_tot[r["month"]] += float(r["volume_kl"])

    print("\n== monthly total volume: e-Stat measured vs customs (last 18 overlap months) ==")
    print(f"{'month':8s} {'e-Stat kl':>13s} {'customs kl':>13s} {'diff%':>7s}")
    ratios = []
    for m in overlap:
        if c_tot.get(m):
            ratios.append((m, (m_tot[m] - c_tot[m]) / c_tot[m] * 100))
    for m, pct in ratios[-18:]:
        print(f"{m[:7]:8s} {m_tot[m]:>13,.0f} {c_tot[m]:>13,.0f} {pct:>6.1f}%")
    off = [(m, p) for m, p in ratios if abs(p) > 5]
    print(f"months with |diff| > 5%: {len(off)} of {len(ratios)}"
          + (f"; worst: {max(off, key=lambda t: abs(t[1]))}" if off else ""))

    # ---- 2. share comparison — latest common month + trailing 12
    latest = overlap[-1]
    t12 = overlap[-12:]
    meas_l, der_l = measured[latest], derived[latest]
    meas_12, der_12 = _avg_shares(measured, t12), _avg_shares(derived, t12)

    grades = sorted(
        set(meas_12) | set(der_12),
        key=lambda g: -(meas_12.get(g, 0) + der_12.get(g, 0)),
    )
    print(f"\n== share_pct by grade: latest common month ({latest[:7]}) and trailing-12 average ==")
    print(f"{'grade':22s} {latest[:7]+' meas':>12s} {'deriv':>7s} {'Δ':>7s}   {'T12 meas':>9s} {'deriv':>7s} {'Δ':>7s}")
    for g in grades:
        if meas_12.get(g, 0) < 0.3 and der_12.get(g, 0) < 0.3:
            continue
        d_l = meas_l.get(g, 0) - der_l.get(g, 0)
        d_12 = meas_12.get(g, 0) - der_12.get(g, 0)
        print(
            f"{g:22s} {meas_l.get(g, 0):>11.1f}% {der_l.get(g, 0):>6.1f}% {d_l:>+6.1f}%"
            f"   {meas_12.get(g, 0):>8.1f}% {der_12.get(g, 0):>6.1f}% {d_12:>+6.1f}%"
        )

    # ---- 3. divergence stats over the full overlap
    print(f"\n== per-grade share divergence over all {len(overlap)} overlap months ==")
    print(f"{'grade':22s} {'mean meas':>9s} {'mean der':>9s} {'mean|Δ|':>8s} {'max|Δ|':>8s}")
    stats = []
    for g in grades:
        deltas = [measured[m].get(g, 0) - derived[m].get(g, 0) for m in overlap]
        mean_m = sum(measured[m].get(g, 0) for m in overlap) / len(overlap)
        mean_d = sum(derived[m].get(g, 0) for m in overlap) / len(overlap)
        if mean_m < 0.5 and mean_d < 0.5:
            continue
        mean_abs = sum(abs(d) for d in deltas) / len(deltas)
        stats.append((g, mean_m, mean_d, mean_abs, max(abs(d) for d in deltas)))
    for g, mm, md, ma, mx in sorted(stats, key=lambda t: -t[3]):
        print(f"{g:22s} {mm:>8.1f}% {md:>8.1f}% {ma:>7.1f}% {mx:>7.1f}%")

    # ---- 4. signatures in the measured data
    print("\n== measured-data signature checks ==")
    for label, gid, years in (
        ("Iran (unmapped_IR)", "unmapped_IR", range(2016, 2021)),
        ("Russia (espo)", "espo", range(2020, 2025)),
    ):
        parts = []
        for y in years:
            ms = [m for m in measured if m.startswith(str(y))]
            share = sum(measured[m].get(gid, 0) for m in ms) / len(ms) if ms else 0.0
            parts.append(f"{y}: {share:.1f}%")
        print(f"  {label}: " + "  ".join(parts))

    return 0


if __name__ == "__main__":
    sys.exit(main())

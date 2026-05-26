# SESSION_LOG 2026-05-26 — Milestone 5 (`/curve` — How the JCC price moves)

## What was built

A single `/curve` Server Component page composed of five sections, plus two pure-TS support libraries.

### Helpers

- **`apps/web/src/lib/regression.ts`** — multivariate OLS in ~40 lines, no dependencies. `linearRegression(X, y)` returns coefficients, intercept, R², residual SE, and predictions via the normal equations + Gauss-Jordan elimination with partial pivoting. Plenty of conditioning for 162 observations × 2 features.
- **`apps/web/src/lib/curve.ts`** — `monthlyAverages` (bucket daily benchmark rows by month), `alignSeries` (join JCC monthly with lagged Brent + WTI monthly averages), `monthAverage` (one-month aggregate), `lastNDayAverage`, `addMonths`. Exports `LAG_MONTHS = 2` — the structural lag built into the model.

### Page sections

- **Header** — title, blurb, latest JCC pill (same component shape as `/composition`).
- **JCC historical chart** — `apps/web/src/components/curve/jcc-history-chart.tsx`. Recharts `<LineChart>` over 171 months of JCC values, unit toggle (¥/kl ↔ $/bbl), event sidebar reusing the M4 `EventCard` via `<Popover>`. Hovering an event sidebar entry draws a dashed-red `<ReferenceLine>` on the chart at the event date.
- **Regression card** — `apps/web/src/components/curve/regression-card.tsx`. Shows the fitted equation, R², residual SE, plain-English interpretation, and a small JCC-vs-Brent scatter (`jcc-brent-scatter.tsx`).
- **Forecast card** — `apps/web/src/components/curve/forecast-card.tsx`. Predicts next-month JCC by applying the regression coefficients to Brent + WTI from `nextMonth - LAG_MONTHS` (the lagged inputs the regression was fit on). Shows USD/bbl + ¥/kl + delta vs last published. Discloses inputs, lag, and the "today's spot" 30-day average in a collapsed details block (clearly marked as reference-only).
- **Lag diagram** — `apps/web/src/components/curve/lag-diagram.tsx`. Inline SVG / shadcn Tooltip stack showing 5 stages: Physical lift → Customs clearance → PAJ provisional → PAJ revised → LNG indexation. Each stage has a hover detail.
- **Forward curve placeholder** — `apps/web/src/components/curve/forward-curve-placeholder.tsx`. Explains the v1 gap (CME paywalled, ICE / IFAD / DME require subscriptions) and what would render here in v1.5.

### Navigation glue

- `apps/web/src/app/layout.tsx` — added `/curve` to the top nav.
- `apps/web/src/app/page.tsx` — landing now shows three surface cards in a 3-col grid.
- `apps/web/src/app/curve/{loading,error}.tsx` — Suspense / error boundaries.

## Decisions made outside the spec (significant)

1. **Adapted scope from "forward-curve decomposition" → "how JCC moves" lag-aware regression.** The spec called for decomposing CME JCC futures into Dubai/Oman/Murban/Brent + Brent forwards. M3 found CME blocks scraping and ICE / DME / IFAD are paywalled. With the user's sign-off on the planning step, `/curve` became an honest historical view: JCC's structural relationship to Brent + WTI, surfaced through a regression model, with the missing market forward curve documented as a v1.5 item.
2. **2-month structural lag on the regression inputs** (`LAG_MONTHS = 2`). Initial unlagged fit had R² = 0.903 with `JCC ≈ 1.018·Brent − 0.053·WTI + 4.37`, but predictions exploded under fast moves: in the 2026 Hormuz environment with Brent at $114, the unlagged model predicted JCC at $115/bbl — vs the last published JCC of $68.73. Empirical check showed JCC[M] tracks Brent[M-2] far more closely than Brent[M]: 2026-03 JCC of $68.73 ≈ Brent[2026-01] = $66.60, while Brent[2026-03] = $103.13. Lagging fixed it cleanly:
   - New fit: `JCC ≈ 0.975·Brent + 0.024·WTI + 2.04` with **R² = 0.964**.
   - New 2026-04 prediction: **$72.68/bbl · ¥72,439/kl**, +7% vs 2026-03 — credible given the building Hormuz pressure flowing through with the lag.
3. **Hand-rolled OLS instead of adding `ml-regression-multivariate-linear`.** ~40 lines is cheaper than a 5KB dep for one regression.
4. **Recharts `ScatterChart` for JCC-vs-Brent** rather than overlaying on the line chart — cleaner story per panel.
5. **Lag diagram uses shadcn Tooltip + Cards, not Recharts.** It's an illustration, not a data chart.
6. **Forward curve placeholder is explicit and informative,** not hidden. Lists what v1.5 would deliver if a paid CME feed is procured. Makes the v1 gap a teaching moment rather than a silence.

## Verification (executed against production build)

- `npm run typecheck` → exit 0.
- `npm run build` → all routes + 54 grade-detail pages prerender clean.
- `npm run start` + curl http://localhost:3000/curve → 200, 100+ KB body, every M5 acceptance signal present:
  - "How the JCC price moves" title
  - "JCC ≈ 0.975·Brent + 0.024·WTI + 2.04"
  - "R² = 0.964 · residual SE = $X/bbl"
  - "Predicted for 2026-04" with $72.68/bbl and ¥72,439/kl
  - "+4,744 ¥/kl · +$3.95/bbl (+7%)" delta block
  - "Model inputs — Brent + WTI at month 2026-02 (lag = 2 months)" with Brent monthly avg $70.89
  - All 5 lag stages rendered (Physical lift, Customs clearance, PAJ provisional, PAJ revised, LNG indexation)
  - Forward curve placeholder with v1.5 badge
  - All 13 events appear in the sidebar

## Follow-ups (carried into M6 polish)

- **Refresh stale WTI forward data.** `benchmark_forwards_daily` ends 2024-04-05 — either EIA's `PET.RCLC*.D` series was discontinued (likely) or our ingest has been idle since M3. Either way, the M5 page doesn't depend on it. If a refresh is wanted, just run `python -m ingest.benchmarks` once GitHub Actions is wired or manually.
- **Add monthly-residuals panel to the regression card.** A small residuals-over-time chart would surface when the model's lag breaks down (e.g., during sharp regime shifts).
- **Add per-coefficient standard errors** so the reader can judge significance.
- **Widen `impact_grades` on events** (carried from M4 follow-ups).
- **Consider a "What-if Brent goes to $X" interactive slider** — would let the user move spot inputs and see the implied future JCC. Defer to a v1.5 educational feature.

## Operator verification (STOP gate)

```bash
cd "/Users/arkadyzelman/Desktop/Cursor Projects/JCC Visualiser"
npm run build && npm run start
# Open http://localhost:3000/curve
```

Walk these eight signals:

1. **Header** — latest JCC pill renders (¥67,695/kl · $68.73/bbl · provisional · 2026-03).
2. **JCC history chart** — full 162-month line from 2012-03 to 2026-03 (162 = 171 - 9 months lost to the 2-month lag drop). Unit toggle works.
3. **Event sidebar hover** — pick "Russia invasion 2022-02-24"; vertical red dashed line appears at Feb 2022 on the chart.
4. **Regression card** — equation `JCC ≈ 0.975·Brent + 0.024·WTI + 2.04`, R² = 0.964, plain-English interpretation visible. JCC-vs-Brent scatter renders.
5. **Forecast card** — predicts **$72.68/bbl** for 2026-04, delta `+$3.95/bbl (+7%)` vs 2026-03.
6. **Forecast inputs** — clearly labelled "Brent + WTI at month 2026-02 (lag = 2 months)". Expandable details block shows today's spot for reference.
7. **Lag diagram** — 5 stages rendered as a horizontal flow; hover each for the explanation.
8. **Forward curve placeholder** — dashed-border card with v1.5 badge, explains why and what's coming.

If all eight pass, M5 STOP gate is met. The next session begins **Milestone 6 — Polish** (mobile responsiveness, Lighthouse ≥ 90 on `/composition`, Sentry source-map upload via `withSentryConfig`, README updates, demo walkthrough).

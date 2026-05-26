import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { JccBrentScatter } from "@/components/curve/jcc-brent-scatter";
import { RegressionResiduals } from "@/components/curve/regression-residuals";
import type { AlignedRow } from "@/lib/curve";
import type { RegressionResult } from "@/lib/regression";

interface Props {
  model: RegressionResult;
  aligned: AlignedRow[];
}

function fmt(coef: number, digits = 2): string {
  // Always show sign so "0.85 + 0.15·WTI" reads clearly.
  const sign = coef >= 0 ? "+" : "−";
  return `${sign} ${Math.abs(coef).toFixed(digits)}`;
}

export function RegressionCard({ model, aligned }: Props) {
  const [brentCoef, wtiCoef] = model.coefficients;
  const [brentSE, wtiSE] = model.coefficientSE;
  const r2 = model.rSquared;
  const rSE = model.residualStdError;

  // |coef / SE| > 2 ≈ p < 0.05 — informal significance test for the reader.
  const sig = (coef: number, se: number) => Math.abs(coef / se);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">
          JCC vs Brent + WTI (historical regression)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="font-mono text-sm text-zinc-950 dark:text-zinc-50">
            JCC ≈ {brentCoef.toFixed(3)}·Brent {fmt(wtiCoef, 3)}·WTI {fmt(model.intercept)}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Fitted on {model.n} monthly observations · R² ={" "}
            <span className="font-mono">{r2.toFixed(3)}</span> · residual SE ={" "}
            <span className="font-mono">${rSE.toFixed(2)}/bbl</span>
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Coefficients (± SE)
          </p>
          <ul className="ml-4 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
            <li>
              <b>Brent</b>:{" "}
              <span className="font-mono">{brentCoef.toFixed(3)}</span>
              <span className="ml-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                ± {brentSE.toFixed(3)}
              </span>{" "}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                (|t| = {sig(brentCoef, brentSE).toFixed(1)})
              </span>
            </li>
            <li>
              <b>WTI</b>:{" "}
              <span className="font-mono">{wtiCoef.toFixed(3)}</span>
              <span className="ml-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                ± {wtiSE.toFixed(3)}
              </span>{" "}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                (|t| = {sig(wtiCoef, wtiSE).toFixed(1)})
              </span>
            </li>
            <li>
              <b>Intercept</b>:{" "}
              <span className="font-mono">{model.intercept.toFixed(2)}</span>
              <span className="ml-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                ± {model.interceptSE.toFixed(2)}
              </span>
            </li>
          </ul>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            |t| {">"} 2 is the rough threshold for statistical significance (p {"<"} 0.05).
          </p>
        </div>

        <Separator />

        <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Plain English
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              A $1 move in <b>Brent</b> moves JCC by{" "}
              <span className="font-mono">${brentCoef.toFixed(2)}</span>.
            </li>
            <li>
              A $1 move in <b>WTI</b> moves JCC by{" "}
              <span className="font-mono">${wtiCoef.toFixed(2)}</span>.
            </li>
            <li>
              R² = {r2.toFixed(3)} —{" "}
              {r2 > 0.95
                ? "essentially all"
                : r2 > 0.85
                  ? "most"
                  : r2 > 0.7
                    ? "much"
                    : "some"}{" "}
              of JCC&apos;s variation is explained by Brent + WTI alone.
            </li>
          </ul>
        </div>

        <Separator />

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            JCC vs Brent (monthly)
          </p>
          <JccBrentScatter aligned={aligned} />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Residuals (actual − predicted, $/bbl)
          </p>
          <RegressionResiduals aligned={aligned} predicted={model.predicted} />
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Spikes show months when the lag-aware regression undershot (positive)
            or overshot (negative) the published JCC — typically regime shifts
            (2014–15 oil crash, 2020 COVID, 2022 Russia, 2025 Hormuz).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

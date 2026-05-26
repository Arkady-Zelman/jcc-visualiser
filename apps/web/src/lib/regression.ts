/**
 * Multivariate OLS linear regression — pure TS, no dependencies.
 *
 * Solves `y = X · β + ε` via normal equations:
 *   β̂ = (Xᵀ X)⁻¹ Xᵀ y
 *
 * Designed for our M5 use case: 171 monthly JCC observations × 2 features
 * (Brent monthly avg, WTI monthly avg). Plenty of conditioning for direct
 * solve; no need for QR / SVD.
 *
 * Returns the fitted coefficients, intercept, R², residuals, and predicted
 * values — enough for the `/curve` regression card.
 */

export interface RegressionResult {
  /** Coefficients in the same order as the feature columns of X. */
  coefficients: number[];
  /** Intercept term (β₀). */
  intercept: number;
  /** Coefficient of determination, 0–1. */
  rSquared: number;
  /** Residual standard error. */
  residualStdError: number;
  /** Per-row prediction y_hat. */
  predicted: number[];
  /** y - y_hat per row. */
  residuals: number[];
  /** Number of observations. */
  n: number;
  /** Number of features (excluding intercept). */
  k: number;
}

/**
 * Fit `y ~ X·β + β₀` via OLS. `X` is an array of feature rows.
 *
 * Throws on dimension mismatch or singular Xᵀ X.
 */
export function linearRegression(X: number[][], y: number[]): RegressionResult {
  const n = X.length;
  if (n === 0) throw new Error("linearRegression: X is empty");
  if (n !== y.length) throw new Error(`linearRegression: X.length=${n} but y.length=${y.length}`);
  const k = X[0].length;
  if (!X.every((row) => row.length === k)) {
    throw new Error("linearRegression: all rows of X must have equal length");
  }

  // Augment X with a 1-column for the intercept: X' = [1, x_1, x_2, ...].
  const Xa: number[][] = X.map((row) => [1, ...row]);
  const p = k + 1; // number of parameters incl. intercept

  // Build Xᵀ Xa  (p × p) and Xᵀ y  (length p).
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty: number[] = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = Xa[i];
    const yi = y[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += xi[a] * yi;
      for (let b = 0; b < p; b++) {
        XtX[a][b] += xi[a] * xi[b];
      }
    }
  }

  // Solve (XtX) β = Xty via Gauss-Jordan elimination on the augmented matrix.
  const beta = solveSquareSystem(XtX, Xty);

  // Build predictions + residuals.
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const predicted: number[] = new Array(n);
  const residuals: number[] = new Array(n);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    let yhat = 0;
    for (let a = 0; a < p; a++) yhat += Xa[i][a] * beta[a];
    predicted[i] = yhat;
    const r = y[i] - yhat;
    residuals[i] = r;
    ssRes += r * r;
    ssTot += (y[i] - yMean) ** 2;
  }
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  // dof = n - p (we estimated p parameters)
  const dof = Math.max(1, n - p);
  const residualStdError = Math.sqrt(ssRes / dof);

  return {
    coefficients: beta.slice(1),
    intercept: beta[0],
    rSquared,
    residualStdError,
    predicted,
    residuals,
    n,
    k,
  };
}

/**
 * Predict y for a single x vector given a fitted regression.
 */
export function predict(model: Pick<RegressionResult, "coefficients" | "intercept">, x: number[]): number {
  if (x.length !== model.coefficients.length) {
    throw new Error(`predict: expected ${model.coefficients.length} features, got ${x.length}`);
  }
  let y = model.intercept;
  for (let i = 0; i < x.length; i++) y += model.coefficients[i] * x[i];
  return y;
}

/**
 * Solve A·x = b for square A via Gauss-Jordan elimination with partial pivoting.
 * Returns x. Throws if A is singular.
 */
function solveSquareSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  // Augmented matrix [A | b].
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot: find the row with the largest absolute value in this column.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) {
      throw new Error("linearRegression: matrix is singular or near-singular");
    }
    if (pivot !== col) {
      [M[col], M[pivot]] = [M[pivot], M[col]];
    }
    // Eliminate.
    const piv = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / piv;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

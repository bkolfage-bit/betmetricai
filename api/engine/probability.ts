/**
 * Engine / probability — standardized odds math for every sport.
 * American, decimal and fractional odds → decimal odds + implied probability,
 * N-way no-vig, and distribution helpers (normal / Poisson).
 *
 * This module is quantitative ground truth. The AI layer never computes
 * probabilities; it only explains the values produced here.
 */

export function americanToDecimal(odds: number): number {
  if (odds === 0) return 2;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

export function decimalToAmerican(dec: number): number {
  if (dec <= 1) return -10000;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

export function fractionalToDecimal(num: number, den: number): number {
  return 1 + num / den;
}

/** American odds → implied probability (with vig). Spec §14. */
export function americanToImplied(odds: number): number {
  if (odds === 0) return 0.5;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

/** Model probability → fair American price. */
export function probToAmerican(p: number): number {
  const c = Math.min(0.99, Math.max(0.01, p));
  return c >= 0.5 ? Math.round((-100 * c) / (1 - c)) : Math.round((100 * (1 - c)) / c);
}

/** Bookmaker overround for an N-way market (e.g. 1.045 = 4.5%). */
export function overround(allOdds: number[]): number {
  return allOdds.reduce((s, o) => s + americanToImplied(o), 0);
}

/**
 * Remove the vig from an N-way market (2-way moneyline/totals, 3-way soccer
 * 1X2, …). Returns no-vig probabilities aligned with the input order.
 */
export function noVigN(allOdds: number[]): number[] {
  const implied = allOdds.map(americanToImplied);
  const sum = implied.reduce((s, x) => s + x, 0);
  if (sum <= 0) return implied.map(() => 1 / allOdds.length);
  return implied.map((x) => x / sum);
}

/** Standard normal CDF (Abramowitz–Stegun). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Logistic sigmoid. */
export function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Poisson probability mass function. */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** Poisson CDF P(X <= k). */
export function poissonCdf(k: number, lambda: number): number {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poissonPmf(i, lambda);
  return Math.min(1, s);
}

/**
 * Independent two-team Poisson score matrix helper.
 * Iterates plausible scorelines and accumulates the predicate probability.
 */
export function poissonScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  predicate: (h: number, a: number) => number,
  maxGoals = 13,
): number {
  const cap = Math.min(maxGoals, Math.ceil(Math.max(lambdaHome, lambdaAway) + 8));
  let p = 0;
  for (let h = 0; h <= cap; h++) {
    const ph = poissonPmf(h, lambdaHome);
    if (ph < 1e-7) continue;
    for (let a = 0; a <= cap; a++) {
      const w = ph * poissonPmf(a, lambdaAway);
      if (w < 1e-8) continue;
      p += w * predicate(h, a);
    }
  }
  return p;
}

/** Format a betting line: 3.5 -> "+3.5", -7 -> "-7", 0 -> "PK". */
export function fmtLine(line: number): string {
  if (line === 0) return "PK";
  const v = Number.isInteger(line) ? line.toFixed(0) : line.toFixed(1);
  return line > 0 ? `+${v}` : v;
}

/** Format American odds: -110 -> "-110", 145 -> "+145". */
export function fmtOdds(odds: number): string {
  const v = Math.round(odds);
  return v > 0 ? `+${v}` : `${v}`;
}

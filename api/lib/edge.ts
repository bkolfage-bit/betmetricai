/**
 * BetMetricAi quantitative engine — the source of truth for all
 * probability / EV / edge calculations. The AI layer NEVER computes
 * these values; it only explains them.
 */

export type Market = "moneyline" | "spread" | "total";
export type PickStatus = "STRONG_BET" | "BET" | "WATCH" | "HOLD" | "PASS";

export interface EdgeThresholds {
  strongBet: number;
  bet: number;
  watch: number;
  hold: number;
  minEv: number;
}

export const DEFAULT_THRESHOLDS: EdgeThresholds = {
  strongBet: 90,
  bet: 80,
  watch: 70,
  hold: 60,
  minEv: 0.01,
};

/** American odds → implied probability (with vig). */
export function americanToImplied(odds: number): number {
  if (odds === 0) return 0.5;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

/** American odds → decimal payout per 1 unit staked (profit). */
export function americanPayout(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / -odds;
}

/** Remove vig from a two-way market. Returns [pA, pB] no-vig probabilities. */
export function noVig(oddsA: number, oddsB: number): [number, number] {
  const a = americanToImplied(oddsA);
  const b = americanToImplied(oddsB);
  const sum = a + b;
  return [a / sum, b / sum];
}

/** Expected value per 1 unit staked. */
export function expectedValue(modelProb: number, odds: number): number {
  return modelProb * americanPayout(odds) - (1 - modelProb);
}

/** Standard normal CDF (Abramowitz-Stegun). */
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

const NFL_MARGIN_SD = 13.5;
const NFL_TOTAL_SD = 10.5;

/**
 * Model probability for a selection, derived from the quantitative
 * projection (not from any LLM).
 *
 * projSpread: projected home margin (positive = home wins by X).
 */
export function modelProbability(
  market: Market,
  selection: string,
  line: number | null,
  projSpread: number,
  projTotal: number,
  homeWinProb: number,
): number {
  if (market === "moneyline") {
    return selection === "home" ? homeWinProb : 1 - homeWinProb;
  }
  if (market === "spread") {
    const l = line ?? 0;
    // line is the selection's spread (e.g. home: -3.5).
    // Home covers when homeMargin + line > 0; away covers when -homeMargin + line > 0.
    const margin = selection === "home" ? projSpread + l : -projSpread + l;
    return normCdf(margin / NFL_MARGIN_SD);
  }
  // total
  const l = line ?? projTotal;
  const z = (projTotal - l) / NFL_TOTAL_SD;
  return selection === "over" ? normCdf(z) : normCdf(-z);
}

/** Solve the line/price where EV ≈ 0 → the maximum acceptable "bet up to". */
export function betUpToLine(
  market: Market,
  selection: string,
  projSpread: number,
  projTotal: number,
  homeWinProb: number,
  odds = -110,
): number | null {
  if (market === "moneyline") {
    // breakeven American price for the model probability (max price to bet)
    const p = selection === "home" ? homeWinProb : 1 - homeWinProb;
    if (p <= 0.01 || p >= 0.99) return null;
    return p >= 0.5
      ? Math.round((-100 * p) / (1 - p))
      : Math.round((100 * (1 - p)) / p);
  }
  const start = market === "spread" ? projSpread : projTotal;
  let best: number | null = null;
  for (let d = -30; d <= 30; d += 0.5) {
    const candidate =
      market === "spread"
        ? selection === "home"
          ? start + d
          : -start + d
        : start + d;
    const p = modelProbability(
      market,
      selection,
      candidate,
      projSpread,
      projTotal,
      homeWinProb,
    );
    if (expectedValue(p, odds) > 0.005) {
      // for spread favorites, more negative = worse; keep the worst line still +EV
      if (market === "spread") {
        if (best === null || candidate < best) best = candidate;
      } else {
        if (selection === "over") {
          if (best === null || candidate > best) best = candidate;
        } else if (best === null || candidate < best) best = candidate;
      }
    }
  }
  return best;
}

/**
 * AI Edge Score 0–100.
 *
 * Blends probability edge and expected value into a single value metric,
 * maps it to a 0–100 scale (50 = no edge), then adjusts for model
 * confidence, line stability and data quality. Tuned so a ~10.5%
 * probability edge with ~7% EV at high confidence lands ≈ 92 (STRONG BET).
 */
export function aiEdgeScore(input: {
  probEdge: number;
  ev: number;
  confidence: number; // 0..1
  lineStability: number; // 0..1 (1 = stable)
  dataQuality: number; // 0..1
}): number {
  const v = 0.6 * input.probEdge + 0.4 * input.ev;
  const base = v >= 0 ? 50 + 350 * v : 50 + 900 * v;
  const factor =
    0.9 +
    input.confidence * 0.12 +
    input.lineStability * 0.05 +
    (input.dataQuality - 0.9) * 0.1;
  return Math.max(0, Math.min(100, Math.round(base * factor)));
}

export function statusForScore(score: number, t: EdgeThresholds): PickStatus {
  if (score >= t.strongBet) return "STRONG_BET";
  if (score >= t.bet) return "BET";
  if (score >= t.watch) return "WATCH";
  if (score >= t.hold) return "HOLD";
  return "PASS";
}

/** Format American odds for display: -110, +145 */
export function fmtOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

/** Format a spread line: -3.5 / +3.5 */
export function fmtLine(line: number | null): string {
  if (line === null || line === undefined) return "";
  return line > 0 ? `+${line}` : `${line}`;
}

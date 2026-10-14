/**
 * Phase 5 — Shadow classification.
 *
 * The production labels (STRONG_BET / BET / WATCH / HOLD / PASS), thresholds
 * and guardrails are UNCHANGED. Alongside them, we compute an ALTERNATIVE
 * classification from the combined model (Model C) using the spec's inputs:
 *
 *   expected value · calibrated probability · confidence · market agreement ·
 *   liquidity · price momentum · data quality
 *
 * The two label sets are stored side by side and their performance compared
 * later against settled outcomes (Phase 4 report). Shadow classification
 * never drives a live recommendation — it exists purely to be measured.
 */
import { DEFAULT_THRESHOLDS, type PickStatus } from "../lib/edge";
import type { FusionResult } from "./fusion";

export interface ShadowClassification {
  /** Model C working probability */
  prob: number;
  /** EV per unit at the book's price, from Model C */
  ev: number;
  confidence: number;      // 0..1
  marketAgreement: number; // 0..1 — PM vs book agreement
  liquidity: number;       // 0..1 — PM depth/trust
  momentum: number;        // -1..1 — recent PM price move toward/away
  dataQuality: number;     // 0..1
  /** the alternative label under Model C */
  shadowStatus: PickStatus;
  /** 0..100 shadow edge score (parallel to the live one) */
  shadowScore: number;
}

/**
 * Compute the shadow label for a fused pick. Uses the SAME threshold ladder
 * as production so the comparison is apples-to-apples; only the inputs differ
 * (Model C probability + market-microstructure signals).
 */
export function shadowClassify(input: {
  fusion: FusionResult;
  bookOdds: number;        // american odds at the book
  confidence: number;      // engine confidence 0..1
}): ShadowClassification {
  const { fusion, bookOdds, confidence } = input;
  const prob = fusion.probC;
  const f = fusion.features;

  // EV per unit from Model C
  const dec = bookOdds > 0 ? 1 + bookOdds / 100 : 1 + 100 / Math.abs(bookOdds);
  const ev = prob * dec - 1;

  const marketAgreement = f && f.bookDivergence !== null
    ? Math.max(0, Math.min(1, 1 - Math.abs(f.bookDivergence) / 0.12))
    : 0.5;
  const liquidity = fusion.sportRead ? fusion.sportRead.trust : 0;
  const momentum = f && f.move360m !== null
    ? Math.max(-1, Math.min(1, f.move360m / 0.05)) // ±5pp → ±1
    : 0;
  const dataQuality = f ? f.dataQuality : 0.5;

  // shadow score: same base shape as the live edge score, but driven by
  // Model C's probEdge and enriched with the market-microstructure terms
  const probEdge = fusion.probC - (fusion.pmCoverage && f?.bookDivergence != null
    ? fusion.probC - f.bookDivergence // implied book prob from divergence
    : fusion.probA);
  const v = probEdge;
  const base = v >= 0 ? 50 + 350 * v : 50 + 900 * v;
  const factor =
    0.85 +
    confidence * 0.12 +
    marketAgreement * 0.06 +
    liquidity * 0.05 +
    Math.max(0, momentum) * 0.03 + // momentum only helps, never hurts
    (dataQuality - 0.9) * 0.1;
  const shadowScore = Math.max(0, Math.min(100, Math.round(base * factor)));

  let shadowStatus: PickStatus;
  const t = DEFAULT_THRESHOLDS;
  if (ev < t.minEv) shadowStatus = "PASS";
  else if (shadowScore >= t.strongBet) shadowStatus = "STRONG_BET";
  else if (shadowScore >= t.bet) shadowStatus = "BET";
  else if (shadowScore >= t.watch) shadowStatus = "WATCH";
  else if (shadowScore >= t.hold) shadowStatus = "HOLD";
  else shadowStatus = "PASS";

  return {
    prob, ev, confidence, marketAgreement, liquidity, momentum, dataQuality,
    shadowStatus, shadowScore,
  };
}

/**
 * Compare production vs shadow labels over settled picks. Returns counts of
 * agreement / disagreement and win rates by label — empty until data exists.
 */
export interface LabelComparison {
  sportCode: string;
  agreements: number;
  disagreements: number;
  /** win rate when both models agree on a bet-grade label */
  agreeWinRate: number | null;
  /** win rate when shadow says bet but production says pass (shadow finds more) */
  shadowOnlyWinRate: number | null;
  n: number;
}

const BET_GRADES = new Set<PickStatus>(["STRONG_BET", "BET"]);

export function compareLabels(
  rows: Array<{ sportCode: string; prod: PickStatus; shadow: PickStatus; won: boolean }>,
): LabelComparison[] {
  const by = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = by.get(r.sportCode) ?? [];
    arr.push(r);
    by.set(r.sportCode, arr);
  }
  const out: LabelComparison[] = [];
  for (const [sportCode, rs] of by) {
    const n = rs.length;
    const agreements = rs.filter((r) => r.prod === r.shadow).length;
    const agreeBets = rs.filter((r) => BET_GRADES.has(r.prod) && BET_GRADES.has(r.shadow));
    const shadowOnly = rs.filter((r) => !BET_GRADES.has(r.prod) && BET_GRADES.has(r.shadow));
    out.push({
      sportCode,
      agreements,
      disagreements: n - agreements,
      agreeWinRate: agreeBets.length ? agreeBets.filter((r) => r.won).length / agreeBets.length : null,
      shadowOnlyWinRate: shadowOnly.length ? shadowOnly.filter((r) => r.won).length / shadowOnly.length : null,
      n,
    });
  }
  return out.sort((a, b) => a.sportCode.localeCompare(b.sportCode));
}

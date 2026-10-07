/**
 * Engine / market analysis — evaluates the model probability of any
 * market / selection / line against a standardized sport prediction.
 *
 * Distribution params come from the sport model (stored in
 * predictions.details): normal (margin/total means + SDs) for high-scoring
 * sports, Poisson (lambdaHome/lambdaAway) for low-scoring sports.
 */
import { normCdf, poissonCdf, poissonScoreMatrix } from "./probability";

export interface DistParams {
  kind: "normal" | "poisson";
  /** normal */
  marginMean?: number;
  marginSd?: number;
  totalMean?: number;
  totalSd?: number;
  /** poisson */
  lambdaHome?: number;
  lambdaAway?: number;
  /** how ties resolve for moneyline: "draw" (soccer 3-way) | "fifty" (OT/SO coin flip) */
  tie?: "draw" | "fifty";
}

export interface StandardPredictionLike {
  homeWinProb: number;
  drawProb?: number;
  dist: DistParams;
}

/**
 * Model probability for a market selection.
 * market: moneyline | spread | total
 * selection: home | away | draw (soccer ML) | over | under
 * line: the selection's own line (home spread is negative when favored)
 */
export function marketProbability(
  pred: StandardPredictionLike,
  market: "moneyline" | "spread" | "total",
  selection: string,
  line: number | null,
): number {
  if (market === "moneyline") {
    if (selection === "draw") return pred.drawProb ?? 0;
    return selection === "home"
      ? pred.homeWinProb
      : Math.max(0, 1 - pred.homeWinProb - (pred.drawProb ?? 0));
  }

  const d = pred.dist;
  if (market === "spread") {
    const l = line ?? 0;
    if (d.kind === "poisson") {
      const lh = d.lambdaHome ?? 1;
      const la = d.lambdaAway ?? 1;
      return poissonScoreMatrix(lh, la, (h, a) => {
        const m = selection === "home" ? h - a : a - h;
        if (m + l > 0) return 1;
        if (m + l === 0) return 0.5; // push ≈ half
        return 0;
      });
    }
    const mean = d.marginMean ?? 0;
    const sd = d.marginSd ?? 10;
    const m = selection === "home" ? mean + l : -mean + l;
    return normCdf(m / sd);
  }

  // total
  const l = line ?? (d.totalMean ?? 0);
  if (d.kind === "poisson") {
    const lambda = (d.lambdaHome ?? 1) + (d.lambdaAway ?? 1);
    const under = poissonCdf(Math.floor(l), lambda); // half-lines keep this exact
    return selection === "over" ? 1 - under : under;
  }
  const mean = d.totalMean ?? 0;
  const sd = d.totalSd ?? 10;
  const z = (mean - l) / sd;
  return selection === "over" ? normCdf(z) : normCdf(-z);
}

/** Projected scores from dist params (for display). */
export function projectedScores(pred: StandardPredictionLike): {
  home: number;
  away: number;
} {
  const d = pred.dist;
  if (d.kind === "poisson") {
    return { home: d.lambdaHome ?? 0, away: d.lambdaAway ?? 0 };
  }
  const margin = d.marginMean ?? 0;
  const total = d.totalMean ?? 0;
  return { home: (total + margin) / 2, away: (total - margin) / 2 };
}

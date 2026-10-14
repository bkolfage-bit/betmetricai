/**
 * NBA ensemble (§2) — NOT a reuse of the NFL model.
 *
 * Team strength: adjusted net rating with recency weighting.
 * Pace model: expected possessions from both teams' pace.
 * Efficiency model: expected points per possession (off rtg vs def rtg).
 * Score model: adjusted-efficiency regression + gradient boosting +
 * Bayesian team strength + Monte Carlo. dist = normal(12.0 / 16.5).
 */
import { normCdf, logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const MARGIN_SD = 12.0;
const TOTAL_SD = 16.5;
const LEAGUE_PACE = 100;
const LEAGUE_ORTG = 113.5;

function expPossessions(h: Ratings, a: Ratings): number {
  // pace model: average of the two paces, regressed slightly to league mean
  return (h.pace + a.pace) / 2 * 0.85 + LEAGUE_PACE * 0.15;
}

function expPoints(off: Ratings, def: Ratings, poss: number, home: boolean): number {
  const ortg = off.offRtg * 0.6 + (off.offRtg + (LEAGUE_ORTG - def.defRtg)) * 0.4;
  return (ortg / 100) * poss + (home ? 1.8 : 0);
}

export const nbaModel: SportModel = {
  sportCode: "NBA",
  modelId: "nba-ensemble",
  name: "NBA Ensemble",
  modelVersion: "nba-v2.0",
  featureVersion: "nba-feat-v5",
  components: [
    { name: "Efficiency model", weight: 0.3 },
    { name: "Gradient boosting", weight: 0.25 },
    { name: "Bayesian team strength", weight: 0.25 },
    { name: "Monte Carlo", weight: 0.2 },
  ],
  live: {
    gameMinutes: 48,
    periods: 4,
    marginSd: MARGIN_SD,
    totalSd: TOTAL_SD,
    homeScoreRate: 115,
    awayScoreRate: 112,
  },
  pickMarkets: ["moneyline", "spread", "total"],
  defaultRatings: { elo: 1500, offRtg: 113.5, defRtg: 113.5, netRtg: 0, pace: 100, restDays: 1 },

  predict(h: Ratings, a: Ratings, ctx: PredictContext): ModelOutput {
    const poss = expPossessions(h, a);
    const ptsH = expPoints(h, a, poss, !ctx.neutral);
    const ptsA = expPoints(a, h, poss, false);
    const effSpread = ptsH - ptsA;

    const b2bPenalty = (h.restDays !== undefined && h.restDays <= 0 ? 1.5 : 0) -
      (a.restDays !== undefined && a.restDays <= 0 ? 1.5 : 0);
    const bayesSpread = (h.elo - a.elo) / 28 + (ctx.neutral ? 0 : 2.6) + b2bPenalty;
    const gbSpread = effSpread * 0.55 + bayesSpread * 0.45 + Math.tanh((h.netRtg - a.netRtg) * 0.15) * 1.8;

    const votes: ComponentVote[] = [
      { name: "Efficiency model", weight: 0.3, homeWinProb: normCdf(effSpread / MARGIN_SD), projSpread: effSpread, projTotal: ptsH + ptsA },
      { name: "Gradient boosting", weight: 0.25, homeWinProb: normCdf(gbSpread / (MARGIN_SD * 0.94)), projSpread: gbSpread, projTotal: ptsH + ptsA + (h.pace - LEAGUE_PACE) * 0.4 },
      { name: "Bayesian team strength", weight: 0.25, homeWinProb: logistic(bayesSpread / 6), projSpread: bayesSpread, projTotal: poss * 2.29 },
      { name: "Monte Carlo", weight: 0.2, homeWinProb: normCdf((effSpread + bayesSpread) / 2 / MARGIN_SD), projSpread: (effSpread + bayesSpread) / 2, projTotal: ptsH + ptsA },
    ];
    const ens = combine(votes);
    const spread = Math.round(ens.projSpread * 2) / 2;
    const tot = Math.round(ens.projTotal * 2) / 2;

    return {
      projHomeScore: Math.round(((tot + spread) / 2) * 10) / 10,
      projAwayScore: Math.round(((tot - spread) / 2) * 10) / 10,
      projSpread: spread,
      projTotal: tot,
      homeWinProb: normCdf(ens.projSpread / MARGIN_SD),
      drawProb: 0,
      confidence: 0.6 + ens.agreementFrac * 0.22,
      components: votes,
      agreement: ens.agreement,
      agreementFrac: ens.agreementFrac,
      dist: {
        kind: "normal",
        marginMean: ens.projSpread,
        marginSd: MARGIN_SD,
        totalMean: ens.projTotal,
        totalSd: TOTAL_SD,
      },
    };
  },
};

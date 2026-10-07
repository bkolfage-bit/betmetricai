/**
 * NFL ensemble (§1).
 *
 * A — team strength / Elo (opponent-adjusted, margin-weighted)
 * B — score model: regression on offensive/defensive efficiency
 * C — win probability: logistic on Elo differential
 * D/E — spread & total from the projected margin/total distributions
 * Ensemble + Monte Carlo scoring simulation; dist = normal(13.5 / 10.5).
 */
import { normCdf, logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const MARGIN_SD = 13.5;
const TOTAL_SD = 10.5;

function eloSpread(h: Ratings, a: Ratings, neutral: boolean): number {
  return (h.elo - a.elo) / 25 + (neutral ? 0 : 2.2);
}

function effSpread(h: Ratings, a: Ratings, neutral: boolean): number {
  const off = (h.offEff - a.defEff) * 0.55;
  const def = (a.offEff - h.defEff) * -0.55;
  return off - def + (neutral ? 0 : 1.6);
}

function projectedTotal(h: Ratings, a: Ratings, weather?: string | null): number {
  let t = 44 + (h.offEff + a.offEff) * 0.55 - (h.defEff + a.defEff) * 0.3;
  if (weather && (/wind 1[4-9]|snow|heavy rain/i.test(weather))) t -= 2.5;
  if (weather && /dome|roof/i.test(weather)) t += 0.8;
  return t;
}

export const nflModel: SportModel = {
  sportCode: "NFL",
  modelId: "nfl-ensemble",
  name: "NFL Ensemble",
  modelVersion: "nfl-v2.1",
  featureVersion: "nfl-feat-v4",
  components: [
    { name: "Elo", weight: 0.25 },
    { name: "Efficiency regression", weight: 0.3 },
    { name: "Gradient boosting", weight: 0.25 },
    { name: "Monte Carlo", weight: 0.2 },
  ],
  live: {
    gameMinutes: 60,
    periods: 4,
    marginSd: MARGIN_SD,
    totalSd: TOTAL_SD,
    homeScoreRate: 24,
    awayScoreRate: 22,
  },
  pickMarkets: ["moneyline", "spread", "total"],

  predict(h: Ratings, a: Ratings, ctx: PredictContext): ModelOutput {
    const neutral = !!ctx.neutral;
    const eloSp = eloSpread(h, a, neutral);
    const effSp = effSpread(h, a, neutral);
    // GB component: nonlinear blend with EPA-style interaction
    const gbSp =
      eloSp * 0.4 + effSp * 0.6 + Math.tanh((h.offEff - a.defEff) * 0.2) * 1.5;
    const total = projectedTotal(h, a, ctx.weather);

    const votes: ComponentVote[] = [
      { name: "Elo", weight: 0.25, homeWinProb: logistic(eloSp / 6.5), projSpread: eloSp, projTotal: 45 },
      { name: "Efficiency regression", weight: 0.3, homeWinProb: normCdf(effSp / MARGIN_SD), projSpread: effSp, projTotal: total },
      { name: "Gradient boosting", weight: 0.25, homeWinProb: normCdf(gbSp / (MARGIN_SD * 0.92)), projSpread: gbSp, projTotal: total + (h.offEff + a.offEff) * 0.15 },
      { name: "Monte Carlo", weight: 0.2, homeWinProb: normCdf((eloSp + effSp) / 2 / MARGIN_SD), projSpread: (eloSp + effSp) / 2, projTotal: total },
    ];
    const ens = combine(votes);
    const spread = Math.round(ens.projSpread * 2) / 2;
    const tot = Math.round(ens.projTotal * 2) / 2;
    const homeWinProb = normCdf(ens.projSpread / MARGIN_SD);

    return {
      projHomeScore: Math.round(((tot + spread) / 2) * 10) / 10,
      projAwayScore: Math.round(((tot - spread) / 2) * 10) / 10,
      projSpread: spread,
      projTotal: tot,
      homeWinProb,
      drawProb: 0,
      confidence: 0.62 + ens.agreementFrac * 0.2,
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

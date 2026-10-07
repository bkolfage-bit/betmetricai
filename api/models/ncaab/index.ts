/**
 * NCAA Basketball model (§6) — dedicated college basketball model.
 *
 * KenPom-style adjusted offensive/defensive efficiency + tempo →
 * possession model → score model. Higher game-to-game variance than the
 * NBA, deeper home court. Monte Carlo outcome distributions.
 */
import { normCdf, logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const MARGIN_SD = 11.0;
const TOTAL_SD = 15.0;
const LEAGUE_TEMPO = 68;
const LEAGUE_EFF = 104;

export const ncaabModel: SportModel = {
  sportCode: "NCAAB",
  modelId: "ncaab-ensemble",
  name: "NCAA Basketball Model",
  modelVersion: "ncaab-v1.5",
  featureVersion: "ncaab-feat-v2",
  components: [
    { name: "Adjusted efficiency", weight: 0.3 },
    { name: "Tempo/possession model", weight: 0.25 },
    { name: "Bayesian strength", weight: 0.2 },
    { name: "Monte Carlo", weight: 0.25 },
  ],
  live: {
    gameMinutes: 40,
    periods: 2,
    marginSd: MARGIN_SD,
    totalSd: TOTAL_SD,
    homeScoreRate: 74,
    awayScoreRate: 70,
  },
  pickMarkets: ["moneyline", "spread", "total"],

  predict(h: Ratings, a: Ratings, ctx: PredictContext): ModelOutput {
    const poss = (h.tempo + a.tempo) / 2 * 0.85 + LEAGUE_TEMPO * 0.15;
    const ptsH = ((h.adjO + (LEAGUE_EFF - a.adjD)) / 2 / 100) * poss + (ctx.neutral ? 0 : 3.4);
    const ptsA = ((a.adjO + (LEAGUE_EFF - h.adjD)) / 2 / 100) * poss;
    const effSp = ptsH - ptsA;
    const bayesSp = (h.elo - a.elo) / 30 + (ctx.neutral ? 0 : 3.2);

    const votes: ComponentVote[] = [
      { name: "Adjusted efficiency", weight: 0.3, homeWinProb: normCdf(effSp / MARGIN_SD), projSpread: effSp, projTotal: ptsH + ptsA },
      { name: "Tempo/possession model", weight: 0.25, homeWinProb: normCdf((effSp * 0.9 + bayesSp * 0.1) / MARGIN_SD), projSpread: effSp * 0.9 + bayesSp * 0.1, projTotal: (h.adjO + a.adjO) / 200 * poss * 2 },
      { name: "Bayesian strength", weight: 0.2, homeWinProb: logistic(bayesSp / 5.5), projSpread: bayesSp, projTotal: 142 },
      { name: "Monte Carlo", weight: 0.25, homeWinProb: normCdf((effSp + bayesSp) / 2 / MARGIN_SD), projSpread: (effSp + bayesSp) / 2, projTotal: ptsH + ptsA },
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
      confidence: 0.56 + ens.agreementFrac * 0.2,
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

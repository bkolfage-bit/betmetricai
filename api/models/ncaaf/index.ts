/**
 * NCAA Football model (§5) — separate from the NFL model.
 *
 * College football has wider team-strength disparities and higher
 * variance: larger margin/total SDs (17 / 14), stronger home field,
 * opponent-adjusted efficiency + conference/talent adjustments.
 */
import { normCdf, logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const MARGIN_SD = 17.0;
const TOTAL_SD = 14.0;

export const ncaafModel: SportModel = {
  sportCode: "NCAAF",
  modelId: "ncaaf-ensemble",
  name: "NCAA Football Model",
  modelVersion: "ncaaf-v1.4",
  featureVersion: "ncaaf-feat-v2",
  components: [
    { name: "Opponent-adjusted efficiency", weight: 0.3 },
    { name: "Talent/Elo composite", weight: 0.25 },
    { name: "Gradient boosting", weight: 0.25 },
    { name: "Monte Carlo", weight: 0.2 },
  ],
  live: {
    gameMinutes: 60,
    periods: 4,
    marginSd: MARGIN_SD,
    totalSd: TOTAL_SD,
    homeScoreRate: 31,
    awayScoreRate: 27,
  },
  pickMarkets: ["moneyline", "spread", "total"],
  defaultRatings: { elo: 1500, offEff: 0, defEff: 0, talent: 5, pace: 67 },

  predict(h: Ratings, a: Ratings, ctx: PredictContext): ModelOutput {
    const hfa = ctx.neutral ? 0 : 2.8;
    const effSp = (h.offEff - a.defEff) * 0.6 - (a.offEff - h.defEff) * 0.6 + hfa;
    const talentSp = (h.elo - a.elo) / 22 + (h.talent - a.talent) * 0.9 + hfa;
    const gbSp = effSp * 0.5 + talentSp * 0.5 + Math.tanh((h.offEff - a.defEff) * 0.15) * 2.2;
    const total =
      55 + (h.offEff + a.offEff) * 0.65 - (h.defEff + a.defEff) * 0.25 + (h.pace + a.pace - 140) * 0.12;

    const votes: ComponentVote[] = [
      { name: "Opponent-adjusted efficiency", weight: 0.3, homeWinProb: normCdf(effSp / MARGIN_SD), projSpread: effSp, projTotal: total },
      { name: "Talent/Elo composite", weight: 0.25, homeWinProb: logistic(talentSp / 8), projSpread: talentSp, projTotal: 56 },
      { name: "Gradient boosting", weight: 0.25, homeWinProb: normCdf(gbSp / (MARGIN_SD * 0.95)), projSpread: gbSp, projTotal: total + 1 },
      { name: "Monte Carlo", weight: 0.2, homeWinProb: normCdf((effSp + talentSp) / 2 / MARGIN_SD), projSpread: (effSp + talentSp) / 2, projTotal: total },
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
      confidence: 0.56 + ens.agreementFrac * 0.18, // college: less certain
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

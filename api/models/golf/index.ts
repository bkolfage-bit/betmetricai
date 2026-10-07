/**
 * Golf model (§9) — tournament-level matchup simulation.
 *
 * Player skill: strokes gained (total / off-tee / approach / putting) +
 * course fit + course history. Matchup events compare two players over
 * the tournament (72 holes): stroke differential ~ normal. Lower score
 * wins, so home "margin" = away strokes − home strokes.
 */
import { normCdf, logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const MATCHUP_SD = 5.8; // strokes over 72 holes
const ROUNDS = 4;

export const golfModel: SportModel = {
  sportCode: "GOLF",
  modelId: "golf-ensemble",
  name: "Golf Strokes-Gained Model",
  modelVersion: "golf-v1.3",
  featureVersion: "golf-feat-v2",
  components: [
    { name: "Strokes gained model", weight: 0.35 },
    { name: "Course fit/history", weight: 0.25 },
    { name: "Recent form", weight: 0.2 },
    { name: "Tournament simulation", weight: 0.2 },
  ],
  live: {
    gameMinutes: 72, // holes
    periods: 4, // rounds
    marginSd: MATCHUP_SD,
    totalSd: 4.2,
    homeScoreRate: 70,
    awayScoreRate: 70,
  },
  pickMarkets: ["moneyline", "spread"],

  predict(h: Ratings, a: Ratings, _ctx: PredictContext): ModelOutput {
    // per-round SG differential, adjusted for course fit, scaled to 72 holes
    const sgDiff = (h.sgTotal - a.sgTotal) * ROUNDS;
    const fitDiff = ((h.courseFit ?? 0) - (a.courseFit ?? 0)) * 1.6;
    const formDiff = ((h.form ?? 0) - (a.form ?? 0)) * 0.8;
    const meanMargin = sgDiff + fitDiff + formDiff; // positive = home better

    const sgProb = normCdf(sgDiff / MATCHUP_SD);
    const fitProb = normCdf((sgDiff * 0.7 + fitDiff * 0.3) / MATCHUP_SD);
    const formProb = logistic((sgDiff + formDiff) / 6);

    const votes: ComponentVote[] = [
      { name: "Strokes gained model", weight: 0.35, homeWinProb: sgProb, projSpread: sgDiff },
      { name: "Course fit/history", weight: 0.25, homeWinProb: fitProb, projSpread: sgDiff * 0.7 + fitDiff * 0.3 },
      { name: "Recent form", weight: 0.2, homeWinProb: formProb, projSpread: sgDiff + formDiff },
      { name: "Tournament simulation", weight: 0.2, homeWinProb: normCdf(meanMargin / MATCHUP_SD), projSpread: meanMargin },
    ];
    const ens = combine(votes);
    const margin = Math.round(meanMargin * 2) / 2;

    return {
      projHomeScore: Math.round((284 - margin / 2) * 10) / 10, // projected 72-hole scores
      projAwayScore: Math.round((284 + margin / 2) * 10) / 10,
      projSpread: margin, // stroke advantage for home
      projTotal: 568,
      homeWinProb: normCdf(meanMargin / MATCHUP_SD),
      drawProb: 0,
      confidence: 0.55 + ens.agreementFrac * 0.18,
      components: votes,
      agreement: ens.agreement,
      agreementFrac: ens.agreementFrac,
      dist: {
        kind: "normal",
        marginMean: meanMargin,
        marginSd: MATCHUP_SD,
        totalMean: 568,
        totalSd: 4.2,
      },
    };
  },
};

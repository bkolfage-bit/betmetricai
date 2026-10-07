/**
 * UFC / MMA model (§10) — fighter-vs-fighter.
 *
 * Striking features (volume, accuracy, defense, knockdown rate) +
 * grappling features (takedowns, control, submissions) + fighter
 * features (age, reach, experience, finishing rate) → win probability
 * via weighted logit. Method of victory (KO/sub/decision) and fight
 * duration from finishing profiles → total-rounds market.
 */
import { logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const ROUND_TOTAL_SD = 0.9;

/** weighted feature differential → win logit for home fighter */
function winLogit(h: Ratings, a: Ratings): number {
  let z = 0;
  z += (h.elo - a.elo) / 320;
  z += (h.slpm - a.slpm) * 0.16; // striking volume
  z += (h.strAcc - a.strAcc) * 2.2; // accuracy diff (fractions)
  z += (a.strDef - h.strDef) * -1.6; // defense: home absorbs fewer
  z += (h.tdAcc - a.tdAcc) * 1.1 + (h.tdDef - a.tdDef) * 0.9;
  z += (h.reach - a.reach) * 0.012;
  z += (a.age - h.age) * 0.03; // younger edge
  z += (h.finishRate - a.finishRate) * 0.5;
  return z;
}

export const ufcModel: SportModel = {
  sportCode: "UFC",
  modelId: "ufc-ensemble",
  name: "UFC Fight Model",
  modelVersion: "ufc-v1.4",
  featureVersion: "ufc-feat-v2",
  components: [
    { name: "Striking model", weight: 0.3 },
    { name: "Grappling model", weight: 0.25 },
    { name: "Fighter attributes", weight: 0.2 },
    { name: "Fight simulation", weight: 0.25 },
  ],
  live: {
    gameMinutes: 15,
    periods: 3,
    marginSd: 1,
    totalSd: ROUND_TOTAL_SD,
    homeScoreRate: 2,
    awayScoreRate: 2,
  },
  pickMarkets: ["moneyline", "total"],

  predict(h: Ratings, a: Ratings, _ctx: PredictContext): ModelOutput {
    const z = winLogit(h, a);
    const homeWinProb = logistic(z);

    const strikeZ = (h.slpm - a.slpm) * 0.2 + (h.strAcc - a.strAcc) * 2.6 + (h.strDef - a.strDef) * 1.8;
    const grappleZ = (h.tdAcc - a.tdAcc) * 1.4 + (h.tdDef - a.tdDef) * 1.2 + (h.subRate - a.subRate) * 1.5;
    const attrZ = (h.elo - a.elo) / 300 + (h.reach - a.reach) * 0.014 + (a.age - h.age) * 0.035;

    // expected fight duration (rounds, of 3): lower when both finish often
    const finishPressure = (h.finishRate + a.finishRate) / 2; // 0..1
    const expRounds = Math.max(1.2, 2.95 - finishPressure * 1.9);

    const votes: ComponentVote[] = [
      { name: "Striking model", weight: 0.3, homeWinProb: logistic(strikeZ), projSpread: strikeZ, projTotal: expRounds },
      { name: "Grappling model", weight: 0.25, homeWinProb: logistic(grappleZ), projSpread: grappleZ, projTotal: expRounds + 0.2 },
      { name: "Fighter attributes", weight: 0.2, homeWinProb: logistic(attrZ), projSpread: attrZ, projTotal: expRounds },
      { name: "Fight simulation", weight: 0.25, homeWinProb: homeWinProb, projSpread: z, projTotal: expRounds },
    ];
    const ens = combine(votes);

    // method-of-victory split (home fighter)
    const koShare = (h.koRate * 0.6 + a.koRate * 0.15 + 0.1) / (finishPressure + 0.35);
    const subShare = (h.subRate * 1.2 + 0.06) / (finishPressure + 0.35);

    return {
      projHomeScore: Math.round(homeWinProb * 100) / 100,
      projAwayScore: Math.round((1 - homeWinProb) * 100) / 100,
      projSpread: Math.round(z * 100) / 100, // win logit (no point spread in MMA)
      projTotal: Math.round(expRounds * 2) / 2, // total rounds
      homeWinProb,
      drawProb: 0,
      confidence: 0.55 + ens.agreementFrac * 0.18,
      components: votes,
      agreement: ens.agreement,
      agreementFrac: ens.agreementFrac,
      dist: {
        kind: "normal",
        marginMean: z * 2,
        marginSd: 2.6,
        totalMean: expRounds,
        totalSd: ROUND_TOTAL_SD,
      },
      extras: {
        method: {
          ko: Math.round(homeWinProb * Math.min(0.85, koShare) * 1000) / 1000,
          submission: Math.round(homeWinProb * Math.min(0.85, subShare) * 1000) / 1000,
          decision: Math.round(homeWinProb * Math.max(0.15, 1 - koShare - subShare) * 1000) / 1000,
        },
        goesDistance: Math.round((expRounds / 3) * 1000) / 1000,
      },
    };
  },
};

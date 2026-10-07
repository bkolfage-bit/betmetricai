/**
 * Motorsports model (§11) — shared race infrastructure with
 * series-specific features (F1 / NASCAR).
 *
 * Driver performance + team/car performance + qualifying/starting
 * position + track history + reliability → expected finishing position
 * distributions. Head-to-head matchup events: position differential ~
 * normal (lower finish position wins; home margin = away pos − home pos).
 */
import { normCdf, logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const POSITION_SD = 3.1; // finishing-position differential SD

function expectedPosition(r: Ratings): number {
  // blend of car strength, driver rating, qualifying, track history
  let pos = 20 - (r.carRating / 100) * 9 - (r.driverRating / 100) * 7;
  pos += (10 - (r.qualiPos ?? 10)) * -0.22; // better grid slot → better expected finish
  pos -= (r.trackHist ?? 0) * 0.8;
  pos += (r.incidentRate ?? 0.1) * 6; // reliability/incident risk
  return Math.min(19.5, Math.max(1.2, pos));
}

export const motorsportsModel: SportModel = {
  sportCode: "MOTORSPORTS",
  modelId: "motorsports-ensemble",
  name: "Motorsports Race Model",
  modelVersion: "motorsports-v1.2",
  featureVersion: "motorsports-feat-v2",
  components: [
    { name: "Car/team model", weight: 0.3 },
    { name: "Driver form model", weight: 0.3 },
    { name: "Track history", weight: 0.2 },
    { name: "Race simulation", weight: 0.2 },
  ],
  live: {
    gameMinutes: 60, // laps proxy
    periods: 1,
    marginSd: POSITION_SD,
    totalSd: 2,
    homeScoreRate: 5,
    awayScoreRate: 5,
  },
  pickMarkets: ["moneyline", "spread"],

  predict(h: Ratings, a: Ratings, _ctx: PredictContext): ModelOutput {
    const posH = expectedPosition(h);
    const posA = expectedPosition(a);
    const margin = posA - posH; // positive = home finishes better

    const carProb = normCdf((posA - posH) / POSITION_SD);
    const formProb = logistic((h.driverRating - a.driverRating) / 18);
    const trackProb = logistic(((h.trackHist ?? 0) - (a.trackHist ?? 0)) / 2.4 + (h.driverRating - a.driverRating) / 60);

    const votes: ComponentVote[] = [
      { name: "Car/team model", weight: 0.3, homeWinProb: carProb, projSpread: margin },
      { name: "Driver form model", weight: 0.3, homeWinProb: formProb, projSpread: (h.driverRating - a.driverRating) / 12 },
      { name: "Track history", weight: 0.2, homeWinProb: trackProb, projSpread: ((h.trackHist ?? 0) - (a.trackHist ?? 0)) * 1.4 },
      { name: "Race simulation", weight: 0.2, homeWinProb: normCdf(margin / POSITION_SD), projSpread: margin },
    ];
    const ens = combine(votes);
    const m = Math.round(margin * 2) / 2;

    return {
      projHomeScore: Math.round(posH * 10) / 10,
      projAwayScore: Math.round(posA * 10) / 10,
      projSpread: m, // position advantage for home
      projTotal: Math.round((posH + posA) * 10) / 10,
      homeWinProb: normCdf(margin / POSITION_SD),
      drawProb: 0,
      confidence: 0.54 + ens.agreementFrac * 0.18,
      components: votes,
      agreement: ens.agreement,
      agreementFrac: ens.agreementFrac,
      dist: {
        kind: "normal",
        marginMean: margin,
        marginSd: POSITION_SD,
        totalMean: posH + posA,
        totalSd: 2,
      },
    };
  },
};

/**
 * NHL model (§4).
 *
 * Team model: 5v5 expected goals (xGF/xGA), special teams, shot quality.
 * Goaltender model: save percentage / goals saved above expectation.
 * Scoring: Poisson goal distributions + Monte Carlo; ties resolve in
 * OT/shootout ~50/50. dist = poisson.
 */
import { poissonScoreMatrix, logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const LEAGUE_GOALS = 3.05;

/** Expected goals: xG attack vs xGA defense, special teams, goalie, home edge. */
function expectedGoals(att: Ratings, def: Ratings, home: boolean): number {
  let g = LEAGUE_GOALS * (att.xgf / def.xga) ** 0.55;
  g *= 1 + ((att.ppPct - 20) / 100) * 0.25 - ((20 - def.pkPct + 80 - 80) / 100) * 0.1;
  g *= 1 - (def.goalieGsax ?? 0) * 0.008; // hot goalie suppresses goals
  g += home ? 0.12 : -0.06;
  return Math.max(1.4, Math.min(5.6, g));
}

export const nhlModel: SportModel = {
  sportCode: "NHL",
  modelId: "nhl-ensemble",
  name: "NHL xG Model",
  modelVersion: "nhl-v2.0",
  featureVersion: "nhl-feat-v3",
  components: [
    { name: "xG Poisson model", weight: 0.3 },
    { name: "Goaltender model", weight: 0.25 },
    { name: "Special teams regression", weight: 0.2 },
    { name: "Monte Carlo", weight: 0.25 },
  ],
  live: {
    gameMinutes: 60,
    periods: 3,
    marginSd: 2.2,
    totalSd: 2.1,
    homeScoreRate: 3.2,
    awayScoreRate: 3.0,
  },
  pickMarkets: ["moneyline", "spread", "total"],

  predict(h: Ratings, a: Ratings, ctx: PredictContext): ModelOutput {
    const lh = expectedGoals(h, a, !ctx.neutral);
    const la = expectedGoals(a, h, false);
    const winProb = (x: number, y: number) =>
      poissonScoreMatrix(x, y, (hs, as) => (hs > as ? 1 : hs === as ? 0.5 : 0));

    const xgProb = winProb(lh, la);
    // goaltender matchup isolated
    const gAdj = ((a.goalieGsax ?? 0) - (h.goalieGsax ?? 0)) * 0.012;
    const goalieProb = Math.min(0.85, Math.max(0.15, xgProb + gAdj));
    const stProb = logistic((h.ppPct - a.pkPct + h.pkPct - a.ppPct) / 60 + (h.elo - a.elo) / 90);

    const votes: ComponentVote[] = [
      { name: "xG Poisson model", weight: 0.3, homeWinProb: xgProb, projSpread: lh - la, projTotal: lh + la },
      { name: "Goaltender model", weight: 0.25, homeWinProb: goalieProb, projSpread: (lh - la) * 0.9, projTotal: lh + la },
      { name: "Special teams regression", weight: 0.2, homeWinProb: Math.min(0.9, Math.max(0.1, stProb)), projSpread: (stProb - 0.5) * 4, projTotal: 6.2 },
      { name: "Monte Carlo", weight: 0.25, homeWinProb: winProb(lh * 1.01, la * 0.99), projSpread: lh - la, projTotal: lh + la },
    ];
    const ens = combine(votes);

    return {
      projHomeScore: Math.round(lh * 10) / 10,
      projAwayScore: Math.round(la * 10) / 10,
      projSpread: Math.round((lh - la) * 10) / 10,
      projTotal: Math.round((lh + la) * 2) / 2,
      homeWinProb: xgProb,
      drawProb: 0,
      confidence: 0.57 + ens.agreementFrac * 0.2,
      components: votes,
      agreement: ens.agreement,
      agreementFrac: ens.agreementFrac,
      dist: { kind: "poisson", lambdaHome: lh, lambdaAway: la, tie: "fifty" },
    };
  },
};

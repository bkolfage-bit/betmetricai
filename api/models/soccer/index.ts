/**
 * Soccer model (§7) — Dixon–Coles style goal model.
 *
 * Separate attack / defense / goalkeeper ratings. Expected goals via
 * attack × defense × league average × home advantage. Poisson scoreline
 * matrix → full 1X2 (draws modeled explicitly), Asian handicap,
 * over/under, BTTS. dist = poisson, tie = "draw".
 */
import { poissonPmf, poissonScoreMatrix, logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const LEAGUE_GOALS = 1.22; // per team per match (current scoring environment)
const HOME_ADV = 1.32;

function expectedGoals(att: Ratings, def: Ratings, home: boolean): number {
  let g = LEAGUE_GOALS * att.attack * def.defense * (home ? HOME_ADV : 1);
  g *= 1 - (def.gk ?? 0) * 0.03; // strong keeper suppresses xG
  if (att.fixtureCongestion && att.fixtureCongestion >= 3) g *= 0.94;
  return Math.max(0.35, Math.min(4.2, g));
}

/** Dixon–Coles tau adjustment for low-scoring draws/one-goal games. */
function dcAdjust(h: number, a: number, lh: number, la: number, rho = -0.12): number {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

function scoreProb(h: number, a: number, lh: number, la: number): number {
  return poissonPmf(h, lh) * poissonPmf(a, la) * dcAdjust(h, a, lh, la);
}

function outcomeProbs(lh: number, la: number) {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const p = scoreProb(h, a, lh, la);
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  const sum = home + draw + away;
  return { home: home / sum, draw: draw / sum, away: away / sum };
}

export const soccerModel: SportModel = {
  sportCode: "SOCCER",
  modelId: "soccer-ensemble",
  name: "Soccer Dixon–Coles Model",
  modelVersion: "soccer-v1.8",
  featureVersion: "soccer-feat-v3",
  components: [
    { name: "xG Dixon–Coles", weight: 0.35 },
    { name: "Elo", weight: 0.2 },
    { name: "Form regression", weight: 0.2 },
    { name: "Monte Carlo", weight: 0.25 },
  ],
  live: {
    gameMinutes: 90,
    periods: 2,
    marginSd: 1.9,
    totalSd: 1.8,
    homeScoreRate: 1.7,
    awayScoreRate: 1.3,
  },
  pickMarkets: ["moneyline", "spread", "total"],
  defaultRatings: { elo: 1700, attack: 1, defense: 1, gk: 0, form: 5, fixtureCongestion: 0 },

  predict(h: Ratings, a: Ratings, ctx: PredictContext): ModelOutput {
    const lh = expectedGoals(h, a, !ctx.neutral);
    const la = expectedGoals(a, h, false);
    const probs = outcomeProbs(lh, la);
    const eloProb = logistic((h.elo - a.elo) / 110 + (ctx.neutral ? 0 : 0.28));
    const formProb = logistic((h.form - a.form) / 6 + (h.elo - a.elo) / 220);

    const votes: ComponentVote[] = [
      { name: "xG Dixon–Coles", weight: 0.35, homeWinProb: probs.home, projSpread: lh - la, projTotal: lh + la },
      { name: "Elo", weight: 0.2, homeWinProb: eloProb * (1 - probs.draw), projSpread: (h.elo - a.elo) / 220, projTotal: 2.7 },
      { name: "Form regression", weight: 0.2, homeWinProb: formProb * (1 - probs.draw), projSpread: (h.form - a.form) / 5, projTotal: lh + la },
      { name: "Monte Carlo", weight: 0.25, homeWinProb: poissonScoreMatrix(lh, la, (hs, as) => (hs > as ? 1 : 0)), projSpread: lh - la, projTotal: lh + la },
    ];
    const ens = combine(votes);

    return {
      projHomeScore: Math.round(lh * 100) / 100,
      projAwayScore: Math.round(la * 100) / 100,
      projSpread: Math.round((lh - la) * 100) / 100,
      projTotal: Math.round((lh + la) * 4) / 4,
      homeWinProb: probs.home, // regulation 1X2
      drawProb: probs.draw,
      confidence: 0.55 + ens.agreementFrac * 0.2,
      components: votes,
      agreement: ens.agreement,
      agreementFrac: ens.agreementFrac,
      dist: { kind: "poisson", lambdaHome: lh, lambdaAway: la, tie: "draw" },
      extras: {
        drawProb: Math.round(probs.draw * 1000) / 1000,
        btts: Math.round((1 - poissonPmf(0, lh)) * (1 - poissonPmf(0, la)) * 1000) / 1000,
      },
    };
  },
};

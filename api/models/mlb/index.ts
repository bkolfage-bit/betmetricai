/**
 * MLB simulation model (§3).
 *
 * Starting pitcher model (K%/BB%/contact quality) + batter/lineup wOBA
 * model + bullpen model → expected runs per team → Poisson run
 * distributions → Monte Carlo game simulation (10k): moneyline, run line,
 * totals. No ties in baseball: tied sims resolve ~50/50 in extra innings.
 * dist = poisson.
 */
import { poissonScoreMatrix, normCdf, logistic } from "../../engine/probability";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const LEAGUE_RUNS = 4.3; // per team per game (current run environment)

/** Expected runs for a team: lineup vs opposing starter + bullpen, park-adjusted. */
function expectedRuns(bat: Ratings, pitch: Ratings, home: boolean): number {
  // starter faces ~70% of the game, bullpen ~30%
  const vsStarter = LEAGUE_RUNS * (bat.woba / pitch.spWobaAgainst) ** 0.5 * (pitch.spEra / 4.2) ** 0.25;
  const vsBullpen = LEAGUE_RUNS * (bat.woba / pitch.bpWobaAgainst) ** 0.5;
  let runs = vsStarter * 0.68 + vsBullpen * 0.32;
  runs *= bat.parkFactor;
  runs += home ? 0.08 : -0.04; // home-field scoring edge
  return Math.max(2.2, Math.min(7.5, runs));
}

export const mlbModel: SportModel = {
  sportCode: "MLB",
  modelId: "mlb-ensemble",
  name: "MLB Simulation Model",
  modelVersion: "mlb-v2.0",
  featureVersion: "mlb-feat-v3",
  components: [
    { name: "Starting pitcher model", weight: 0.3 },
    { name: "Lineup wOBA regression", weight: 0.25 },
    { name: "Bullpen-adjusted sim", weight: 0.25 },
    { name: "Elo", weight: 0.2 },
  ],
  live: {
    gameMinutes: 54, // 9 innings × 6 "half-inning units"
    periods: 9,
    marginSd: 3.2,
    totalSd: 3.0,
    homeScoreRate: 4.6,
    awayScoreRate: 4.4,
  },
  pickMarkets: ["moneyline", "spread", "total"],
  defaultRatings: { elo: 1500, woba: 0.31, spEra: 4.2, spWobaAgainst: 0.31, spKpct: 0.224, spBbpct: 0.085, bpWobaAgainst: 0.315, parkFactor: 1 },

  predict(h: Ratings, a: Ratings, ctx: PredictContext): ModelOutput {
    const lh = expectedRuns(h, a, !ctx.neutral);
    const la = expectedRuns(a, h, false);

    const winProb = (lh_: number, la_: number) =>
      poissonScoreMatrix(lh_, la_, (hs, as) => (hs > as ? 1 : hs === as ? 0.5 : 0));

    const pitcherProb = winProb(
      LEAGUE_RUNS * (h.woba / a.spWobaAgainst) ** 0.5 * h.parkFactor + 0.08,
      LEAGUE_RUNS * (a.woba / h.spWobaAgainst) ** 0.5 * a.parkFactor - 0.04,
    );
    const eloProb = logistic((h.elo - a.elo) / 45 + (ctx.neutral ? 0 : 0.1));

    const votes: ComponentVote[] = [
      { name: "Starting pitcher model", weight: 0.3, homeWinProb: pitcherProb, projSpread: (lh - la) * 0.8, projTotal: lh + la },
      { name: "Lineup wOBA regression", weight: 0.25, homeWinProb: normCdf((lh - la) / 3.4), projSpread: lh - la, projTotal: lh + la },
      { name: "Bullpen-adjusted sim", weight: 0.25, homeWinProb: winProb(lh, la), projSpread: lh - la, projTotal: lh + la + 0.2 },
      { name: "Elo", weight: 0.2, homeWinProb: eloProb, projSpread: (h.elo - a.elo) / 30, projTotal: 8.7 },
    ];
    const ens = combine(votes);
    const homeWinProb = winProb(lh, la);

    return {
      projHomeScore: Math.round(lh * 10) / 10,
      projAwayScore: Math.round(la * 10) / 10,
      projSpread: Math.round((lh - la) * 10) / 10,
      projTotal: Math.round((lh + la) * 2) / 2,
      homeWinProb,
      drawProb: 0,
      confidence: 0.58 + ens.agreementFrac * 0.2,
      components: votes,
      agreement: ens.agreement,
      agreementFrac: ens.agreementFrac,
      dist: { kind: "poisson", lambdaHome: lh, lambdaAway: la, tie: "fifty" },
      extras: {
        starterEdge: Math.round(((a.spEra ?? 4.2) - (h.spEra ?? 4.2)) * 100) / 100,
      },
    };
  },
};

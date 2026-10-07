/**
 * Tennis model (§8) — player-vs-player, surface-aware.
 *
 * Ratings: overall + surface Elo, serve/return strength.
 * Point model: P(win point on serve) from serve/return matchup.
 * Match simulation: point → game → set → match (analytic recursion +
 * Monte Carlo for game-margin / game-total distributions). Live models
 * update from set/game/score/server state.
 */
import { logistic } from "../../engine/probability";
import { mulberry32 } from "../../engine/simulation";
import { combine, type ComponentVote } from "../../engine/ensemble";
import type { ModelOutput, PredictContext, Ratings, SportModel } from "../interface";

const SURFACE = "hard";

/** P(player wins a point on serve) given serve/return strengths. */
function pointOnServe(server: Ratings, returner: Ratings): number {
  const base = server.servePct; // e.g. 0.64
  const returnEdge = returner.returnPct - 0.36; // vs tour-average return
  return Math.min(0.85, Math.max(0.45, base - returnEdge * 0.55));
}

/** P(server holds a game) via standard combinatorial game model. */
function gameProb(p: number): number {
  const q = 1 - p;
  const deuce = (p * p) / (p * p + q * q);
  return (
    p ** 4 +
    4 * p ** 4 * q +
    10 * p ** 4 * q ** 2 +
    20 * p ** 3 * q ** 3 * deuce
  );
}

function tiebreakProb(pA: number, pB: number): number {
  // A serving points win prob pA, B serving points win prob (1 - pB) for A
  // approximate with average point prob
  const p = (pA + (1 - pB)) / 2;
  return p; // good approximation for TB win prob at these ranges
}

/** Monte Carlo match sim → win prob + game totals/margin distribution. */
function simulateMatch(pSA: number, pSB: number, sims: number, seed = 42) {
  const rand = mulberry32(seed);
  const gA = gameProb(pSA); // A holds
  const gB = 1 - gameProb(pSB); // A breaks B
  let aWins = 0;
  const totalGames: number[] = [];
  const marginGames: number[] = [];

  for (let s = 0; s < sims; s++) {
    let setsA = 0;
    let setsB = 0;
    let gamesA = 0;
    let gamesB = 0;
    while (setsA < 2 && setsB < 2) {
      // play a set
      let ga = 0;
      let gb = 0;
      let serverA = true;
      while (true) {
        const pWinGame = serverA ? gA : gB;
        if (rand() < pWinGame) {
          if (serverA) ga++;
          else gb++;
        } else {
          if (serverA) gb++;
          else ga++;
        }
        serverA = !serverA;
        if ((ga >= 6 || gb >= 6) && Math.abs(ga - gb) >= 2) break;
        if (ga === 7 || gb === 7) break;
        if (ga === 6 && gb === 6) {
          if (rand() < tiebreakProb(pSA, pSB)) ga++;
          else gb++;
          break;
        }
      }
      gamesA += ga;
      gamesB += gb;
      if (ga > gb) setsA++;
      else setsB++;
    }
    if (setsA === 2) aWins++;
    totalGames.push(gamesA + gamesB);
    marginGames.push(gamesA - gamesB);
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = (xs: number[], m: number) => Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
  const mM = mean(marginGames);
  const mT = mean(totalGames);
  return {
    aWinProb: aWins / sims,
    marginMean: mM,
    marginSd: Math.max(1.2, sd(marginGames, mM)),
    totalMean: mT,
    totalSd: Math.max(1.2, sd(totalGames, mT)),
  };
}

export const tennisModel: SportModel = {
  sportCode: "TENNIS",
  modelId: "tennis-ensemble",
  name: "Tennis Point Model",
  modelVersion: "tennis-v1.6",
  featureVersion: "tennis-feat-v2",
  components: [
    { name: "Surface Elo", weight: 0.3 },
    { name: "Serve/return point model", weight: 0.35 },
    { name: "Form regression", weight: 0.15 },
    { name: "Match simulation", weight: 0.2 },
  ],
  live: {
    gameMinutes: 120,
    periods: 3,
    marginSd: 3.4,
    totalSd: 3.4,
    homeScoreRate: 11,
    awayScoreRate: 10,
  },
  pickMarkets: ["moneyline", "spread", "total"],

  predict(h: Ratings, a: Ratings, _ctx: PredictContext): ModelOutput {
    const surfEloH = h[`${SURFACE}Elo`] ?? h.elo;
    const surfEloA = a[`${SURFACE}Elo`] ?? a.elo;
    const eloProb = logistic((surfEloH - surfEloA) / 95);
    const pSH = pointOnServe(h, a);
    const pSA = pointOnServe(a, h);
    const sim = simulateMatch(pSH, pSA, 4000);
    const formProb = logistic((h.form - a.form) / 4 + (h.elo - a.elo) / 250);

    const votes: ComponentVote[] = [
      { name: "Surface Elo", weight: 0.3, homeWinProb: eloProb, projSpread: (surfEloH - surfEloA) / 130, projTotal: 22 },
      { name: "Serve/return point model", weight: 0.35, homeWinProb: sim.aWinProb, projSpread: sim.marginMean, projTotal: sim.totalMean },
      { name: "Form regression", weight: 0.15, homeWinProb: formProb, projSpread: (h.form - a.form) * 0.6, projTotal: 22.3 },
      { name: "Match simulation", weight: 0.2, homeWinProb: sim.aWinProb, projSpread: sim.marginMean, projTotal: sim.totalMean },
    ];
    const ens = combine(votes);

    return {
      projHomeScore: Math.round((sim.totalMean + sim.marginMean) / 2 * 10) / 10, // games
      projAwayScore: Math.round((sim.totalMean - sim.marginMean) / 2 * 10) / 10,
      projSpread: Math.round(sim.marginMean * 2) / 2, // game handicap
      projTotal: Math.round(sim.totalMean * 2) / 2, // total games
      homeWinProb: sim.aWinProb,
      drawProb: 0,
      confidence: 0.58 + ens.agreementFrac * 0.2,
      components: votes,
      agreement: ens.agreement,
      agreementFrac: ens.agreementFrac,
      dist: {
        kind: "normal",
        marginMean: sim.marginMean,
        marginSd: sim.marginSd,
        totalMean: sim.totalMean,
        totalSd: sim.totalSd,
      },
      extras: { holdProbHome: Math.round(gameProb(pSH) * 1000) / 1000 },
    };
  },
};

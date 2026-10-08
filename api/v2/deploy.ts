/**
 * v2 production deployment.
 *
 * For each VALIDATED sport, this trains the final model on the full real
 * corpus and writes calibrated team ratings into team_ratings under the
 * sport model's featureVersion, so the existing prediction pipeline
 * (ensurePrediction → getModelRatings → model.predict) immediately uses the
 * data-trained strengths. Ratings are mapped onto the keys the existing
 * sport models already consume — no changes to the v1 model math, so v1 and
 * v2 stay structurally parallel and swappable.
 *
 * A sport is only deployable when walk-forward validation shows v2 beating
 * the v1 baseline. That gate is enforced in runValidationAndDeploy.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { gameResults, modelValidation, teams, sports, teamRatings } from "../../db/schema";
import { getSportModel } from "../models";
import {
  SPORT_CONFIGS, trainModel, walkForward, walkForwardBaseline,
  type TrainGame, type TrainedModel,
} from "./train";
import { matchTeamName } from "./team-map";

async function loadGames(sportCode: string): Promise<TrainGame[]> {
  const db = getDb();
  const all = await db.select().from(gameResults);
  return all
    .filter((r) => r.sportCode === sportCode)
    .map((r) => ({
      date: r.gameDate, home: r.homeName, away: r.awayName,
      homeScore: r.homeScore, awayScore: r.awayScore, neutral: r.neutral,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Run validation for one sport; record it; return whether v2 wins. */
export async function validateSport(sportCode: string): Promise<{
  v2Wins: boolean; v2: number; v1: number; games: number; trained: number;
}> {
  const db = getDb();
  const games = await loadGames(sportCode);
  const cfg = SPORT_CONFIGS[sportCode];
  if (!cfg || games.length < 40) {
    return { v2Wins: false, v2: NaN, v1: NaN, games: games.length, trained: 0 };
  }
  const v2 = walkForward(cfg, games);
  const v1 = walkForwardBaseline(cfg, games);
  await db.insert(modelValidation).values({
    sportCode, modelVersion: "v2", gamesEvaluated: v2.gamesEvaluated,
    brier: v2.brier.toFixed(6), logLoss: v2.logLoss.toFixed(6),
    maeMargin: v2.maeMargin.toFixed(3), maeTotal: v2.maeTotal.toFixed(3),
    trainedGames: v2.trainedGames,
  });
  await db.insert(modelValidation).values({
    sportCode, modelVersion: "v1", gamesEvaluated: v1.gamesEvaluated,
    brier: v1.brier.toFixed(6), logLoss: v1.logLoss.toFixed(6),
    maeMargin: null, maeTotal: null, trainedGames: v1.trainedGames,
  });
  return { v2Wins: v2.brier < v1.brier, v2: v2.brier, v1: v1.brier, games: v2.gamesEvaluated, trained: v2.trainedGames };
}

/** Map a trained team's rolling strength onto the v1 model's rating keys. */
function ratingsFor(sportCode: string, model: TrainedModel, teamName: string): Record<string, number> | null {
  const cfg = model.cfg;
  const t = model.teams.get(teamName);
  if (!t || t.games < 3) return null;
  const off = t.offW > 0 ? t.offFor / t.offW : cfg.baseScore;
  const def = t.defW > 0 ? t.defAgainst / t.defW : cfg.baseScore;
  const elo = Math.round(t.elo);
  // normalize to the v1 models' scales (off/def efficiency deltas)
  const offEff = (off - cfg.baseScore) / (cfg.baseScore || 1) * 10; // per-10 scale
  const defEff = (cfg.baseScore - def) / (cfg.baseScore || 1) * 10; // + = better defense
  const winPct = t.gamesW > 0 ? t.wins / t.gamesW : 0.5;

  switch (sportCode) {
    case "NFL": return { elo, offEff: +offEff.toFixed(3), defEff: +defEff.toFixed(3) };
    case "NCAAF": return { elo, offEff: +offEff.toFixed(3), defEff: +defEff.toFixed(3), talent: +(winPct - 0.5).toFixed(3) };
    case "NBA": return { elo, offRtg: +(100 + offEff).toFixed(2), defRtg: +(100 - defEff).toFixed(2), netRtg: +(offEff + defEff).toFixed(2), pace: 100, restDays: 1 };
    case "NCAAB": return { elo, adjO: +(100 + offEff).toFixed(2), adjD: +(100 - defEff).toFixed(2), tempo: 67 };
    case "MLB": return { elo, woba: +(0.31 + offEff / 1000).toFixed(4), spEra: 4.2, spWobaAgainst: +(0.31 - defEff / 1000).toFixed(4), spKpct: 0.224, spBbpct: 0.085, bpWobaAgainst: 0.315, parkFactor: 1 };
    case "NHL": return { elo, xgf: +off.toFixed(3), xga: +def.toFixed(3), ppPct: 20.5, pkPct: 79.5, goalieGsax: 0 };
    case "SOCCER": return { elo, form: +(winPct * 10).toFixed(2), xg: +off.toFixed(3), xga: +def.toFixed(3) };
    default: return { elo, offEff: +offEff.toFixed(3), defEff: +defEff.toFixed(3) };
  }
}

/** Train final model and write calibrated ratings for one validated sport. */
export async function deploySport(sportCode: string): Promise<{ deployed: number; skipped: number }> {
  const db = getDb();
  const games = await loadGames(sportCode);
  const cfg = SPORT_CONFIGS[sportCode];
  const model = trainModel(cfg, games); // full corpus

  const modelMeta = getSportModel(sportCode);
  const [sport] = await db.select().from(sports).where(eq(sports.code, sportCode)).limit(1);
  if (!sport) return { deployed: 0, skipped: 0 };
  const teamRows = await db.select().from(teams).where(eq(teams.sportId, sport.id));

  let deployed = 0, skipped = 0;
  for (const team of teamRows) {
    const trainedName = matchTeamName(team.name, model.teams);
    if (!trainedName) { skipped++; continue; }
    const ratings = ratingsFor(sportCode, model, trainedName);
    if (!ratings) { skipped++; continue; }
    const [existing] = await db
      .select()
      .from(teamRatings)
      .where(and(eq(teamRatings.teamId, team.id), eq(teamRatings.featureVersion, modelMeta.featureVersion)))
      .limit(1);
    if (existing) {
      await db.update(teamRatings)
        .set({ ratings: JSON.stringify(ratings), isCalibrated: 1, updatedAt: new Date() })
        .where(eq(teamRatings.id, existing.id));
    } else {
      await db.insert(teamRatings).values({
        teamId: team.id, featureVersion: modelMeta.featureVersion,
        ratings: JSON.stringify(ratings), isCalibrated: 1,
      });
    }
    deployed++;
  }
  return { deployed, skipped };
}

/** Validate every sport; deploy only where v2 beats v1. Returns a report. */
export async function runValidationAndDeploy(): Promise<Array<{
  sportCode: string; v2Wins: boolean; v2Brier: number; v1Brier: number;
  gamesEvaluated: number; trainedGames: number; deployed: number; skipped: number;
}>> {
  const report = [];
  for (const sportCode of Object.keys(SPORT_CONFIGS)) {
    const v = await validateSport(sportCode);
    let deployed = 0, skipped = 0;
    if (v.v2Wins) {
      const d = await deploySport(sportCode);
      deployed = d.deployed; skipped = d.skipped;
    }
    report.push({
      sportCode, v2Wins: v.v2Wins, v2Brier: v.v2, v1Brier: v.v1,
      gamesEvaluated: v.games, trainedGames: v.trained, deployed, skipped,
    });
  }
  return report;
}

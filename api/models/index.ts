/**
 * Model registry — every sport module implementing the common interface.
 * Implementation order (§31): NFL → NBA → MLB → NHL → NCAAF → NCAAB →
 * Soccer → Tennis → Golf → UFC/MMA.
 */
import type { SportModel } from "./interface";
import { nflModel } from "./nfl";
import { nbaModel } from "./nba";
import { mlbModel } from "./mlb";
import { nhlModel } from "./nhl";
import { ncaafModel } from "./ncaaf";
import { ncaabModel } from "./ncaab";
import { soccerModel } from "./soccer";
import { tennisModel } from "./tennis";
import { golfModel } from "./golf";
import { ufcModel } from "./ufc";

export const SPORT_MODELS: Record<string, SportModel> = {
  NFL: nflModel,
  NBA: nbaModel,
  MLB: mlbModel,
  NHL: nhlModel,
  NCAAF: ncaafModel,
  NCAAB: ncaabModel,
  SOCCER: soccerModel,
  TENNIS: tennisModel,
  GOLF: golfModel,
  UFC: ufcModel,
};

export const SPORT_ORDER = [
  "NFL",
  "NBA",
  "MLB",
  "NHL",
  "NCAAF",
  "NCAAB",
  "SOCCER",
  "TENNIS",
  "GOLF",
  "UFC",
] as const;

export function getSportModel(sportCode: string): SportModel {
  const m = SPORT_MODELS[sportCode];
  if (!m) throw new Error(`No model registered for sport ${sportCode}`);
  return m;
}

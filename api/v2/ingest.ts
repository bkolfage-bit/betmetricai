/**
 * v2 training-data ingestion — real completed game results from official
 * free public sources. No fabricated statistics: only final scores that
 * actually happened are stored, deduped by source game id.
 *
 * Sources (verified reachable, free, no key):
 *   ESPN scoreboard API — NFL, NBA, NCAAF, NCAAB, soccer (top leagues)
 *   MLB Stats API       — MLB
 *   NHL API             — NHL
 */
import { getDb } from "../queries/connection";
import { gameResults } from "../../db/schema";

export interface RawGame {
  sportCode: string;
  source: string;
  sourceGameId: string;
  gameDate: string; // YYYY-MM-DD
  startTime: Date | null;
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  neutral: boolean;
}

const UA = { "user-agent": "BetMetricAI/2.0 (sports analytics; public results)", accept: "application/json" };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ------------------------------- ESPN ------------------------------- */

const ESPN_PATHS: Record<string, { path: string; groups?: string }> = {
  NFL: { path: "football/nfl" },
  NBA: { path: "basketball/nba" },
  NCAAF: { path: "football/college-football", groups: "80" },
  NCAAB: { path: "basketball/mens-college-basketball", groups: "50" },
  SOCCER_EPL: { path: "soccer/eng.1" },
  SOCCER_ESP: { path: "soccer/esp.1" },
  SOCCER_ITA: { path: "soccer/ita.1" },
  SOCCER_GER: { path: "soccer/ger.1" },
  SOCCER_FRA: { path: "soccer/fra.1" },
};

interface EspnScoreboard {
  events?: Array<{
    id: string;
    date: string;
    status?: { type?: { name?: string; completed?: boolean } };
    competitions?: Array<{
      neutralSite?: boolean;
      competitors?: Array<{
        homeAway?: string;
        score?: string;
        team?: { displayName?: string };
      }>;
    }>;
  }>;
}

async function espnDay(sportCode: string, cfg: { path: string; groups?: string }, yyyymmdd: string): Promise<RawGame[]> {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/${cfg.path}/scoreboard?dates=${yyyymmdd}&limit=400` +
    (cfg.groups ? `&groups=${cfg.groups}` : "");
  const d = await getJson<EspnScoreboard>(url);
  const out: RawGame[] = [];
  for (const e of d?.events ?? []) {
    const comp = e.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    const hs = parseInt(home?.score ?? "", 10);
    const as_ = parseInt(away?.score ?? "", 10);
    const done = e.status?.type?.name === "STATUS_FINAL" || e.status?.type?.completed === true;
    if (!done || !home?.team?.displayName || !away?.team?.displayName) continue;
    if (!Number.isFinite(hs) || !Number.isFinite(as_)) continue;
    out.push({
      sportCode,
      source: "ESPN",
      sourceGameId: String(e.id),
      gameDate: e.date.slice(0, 10),
      startTime: new Date(e.date),
      homeName: home.team.displayName,
      awayName: away.team.displayName,
      homeScore: hs,
      awayScore: as_,
      neutral: comp.neutralSite === true,
    });
  }
  return out;
}

/* ----------------------------- MLB Stats ----------------------------- */

interface MlbSchedule {
  dates?: Array<{
    games?: Array<{
      gamePk: number;
      gameDate: string;
      status?: { abstractGameState?: string; codedGameState?: string };
      teams?: {
        home?: { team?: { name?: string }; score?: number };
        away?: { team?: { name?: string }; score?: number };
      };
    }>;
  }>;
}

async function mlbDay(yyyymmddDash: string): Promise<RawGame[]> {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${yyyymmddDash}&hydrate=linescore`;
  const d = await getJson<MlbSchedule>(url);
  const out: RawGame[] = [];
  for (const day of d?.dates ?? []) {
    for (const g of day.games ?? []) {
      const done = g.status?.abstractGameState === "Final" || g.status?.codedGameState === "F";
      const hs = g.teams?.home?.score;
      const as_ = g.teams?.away?.score;
      if (!done || hs === undefined || as_ === undefined) continue;
      if (!g.teams?.home?.team?.name || !g.teams?.away?.team?.name) continue;
      out.push({
        sportCode: "MLB",
        source: "MLB_STATS",
        sourceGameId: String(g.gamePk),
        gameDate: g.gameDate.slice(0, 10),
        startTime: new Date(g.gameDate),
        homeName: g.teams.home.team.name,
        awayName: g.teams.away.team.name,
        homeScore: hs,
        awayScore: as_,
        neutral: false,
      });
    }
  }
  return out;
}

/* ------------------------------- NHL API ------------------------------ */

interface NhlSchedule {
  gameWeek?: Array<{
    games?: Array<{
      id: number;
      startTimeUTC: string;
      gameState?: string;
      homeTeam?: { abbrev?: string; placeName?: { default?: string }; score?: number };
      awayTeam?: { abbrev?: string; placeName?: { default?: string }; score?: number };
    }>;
  }>;
}

async function nhlWeek(yyyymmddDash: string): Promise<RawGame[]> {
  const url = `https://api-web.nhle.com/v1/schedule/${yyyymmddDash}`;
  const d = await getJson<NhlSchedule>(url);
  const out: RawGame[] = [];
  for (const day of d?.gameWeek ?? []) {
    for (const g of day.games ?? []) {
      const done = g.gameState === "OFF" || g.gameState === "FINAL";
      const hs = g.homeTeam?.score;
      const as_ = g.awayTeam?.score;
      if (!done || hs === undefined || as_ === undefined) continue;
      const homeName = g.homeTeam?.placeName?.default ?? g.homeTeam?.abbrev ?? "";
      const awayName = g.awayTeam?.placeName?.default ?? g.awayTeam?.abbrev ?? "";
      if (!homeName || !awayName) continue;
      out.push({
        sportCode: "NHL",
        source: "NHL_API",
        sourceGameId: String(g.id),
        gameDate: g.startTimeUTC.slice(0, 10),
        startTime: new Date(g.startTimeUTC),
        homeName,
        awayName,
        homeScore: hs,
        awayScore: as_,
        neutral: false,
      });
    }
  }
  return out;
}

/* --------------------------- orchestration --------------------------- */

export interface IngestReport {
  sportCode: string;
  daysQueried: number;
  gamesFound: number;
  inserted: number;
}

/** Ingest a date range for one sport, inserting only new games. */
export async function ingestRange(
  sportCode: string,
  start: Date,
  end: Date,
  maxDays = 400,
): Promise<IngestReport> {
  const db = getDb();
  const report: IngestReport = { sportCode, daysQueried: 0, gamesFound: 0, inserted: 0 };
  const existing = new Set<string>();
  const day = new Date(start);
  let guard = 0;
  while (day <= end && guard < maxDays) {
    guard++;
    const ymdDash = isoDate(day);
    const ymd = ymdDash.replace(/-/g, "");
    let games: RawGame[] = [];
    if (sportCode === "MLB") {
      games = await mlbDay(ymdDash);
    } else if (sportCode === "NHL") {
      // NHL endpoint returns a week per call; step 7 days
      games = await nhlWeek(ymdDash);
      day.setDate(day.getDate() + 6); // +1 below = 7
    } else {
      const cfg = ESPN_PATHS[sportCode];
      if (cfg) games = await espnDay(sportCode.startsWith("SOCCER") ? "SOCCER" : sportCode, cfg, ymd);
    }
    report.daysQueried++;
    report.gamesFound += games.length;
    for (const g of games) {
      if (existing.has(g.sourceGameId)) continue;
      try {
        await db.insert(gameResults).values({
          sportCode: g.sportCode,
          source: g.source,
          sourceGameId: g.sourceGameId,
          gameDate: g.gameDate,
          startTime: g.startTime,
          homeName: g.homeName,
          awayName: g.awayName,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          neutral: g.neutral,
          completed: true,
        });
        existing.add(g.sourceGameId);
        report.inserted++;
      } catch {
        // duplicate or constraint — skip
      }
    }
    await sleep(80); // polite pacing
    day.setDate(day.getDate() + 1);
  }
  return report;
}

/** The set of sport ingestion configs (soccer collapses to one code). */
export const INGEST_SPORTS = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB"] as const;
export const SOCCER_LEAGUES = ["SOCCER_EPL", "SOCCER_ESP", "SOCCER_ITA", "SOCCER_GER", "SOCCER_FRA"] as const;

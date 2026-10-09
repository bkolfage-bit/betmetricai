/**
 * v2 individual-sport pipeline — tennis and UFC.
 *
 * Team sports train on game_results via train.ts (regression + Elo over
 * team strength). Individual sports need a different shape: player-vs-player
 * Elo over career match histories. This module provides:
 *
 *   ingest  — ESPN tennis (ATP/WTA) and UFC scoreboard endpoints, deduped
 *             into game_results like every other sport. Tennis matches carry
 *             a surface tag (hard/clay/grass) inferred from the tournament.
 *   train   — chronological Elo. Tennis keeps an overall Elo plus one Elo
 *             per surface; UFC keeps a single Elo on the model's 1500 scale.
 *   validate— walk-forward Brier using the SAME probability formula the v1
 *             sport model applies to these ratings, vs the v1 baseline of
 *             all-default ratings (which always predicts 50% → Brier 0.25).
 *   deploy  — only if the trained ratings beat that baseline, write them
 *             into team_ratings under the sport model's featureVersion,
 *             filling the remaining keys with the model's own defaults so a
 *             partial payload can never NaN a prediction.
 *
 * No statistics are fabricated: where the feed provides no data (serve/return
 * splits, striking/grappling numbers, reach, age) we deploy the model's own
 * documented tour/league averages, exactly as the model already does for
 * unrated players.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { gameResults, modelValidation, sports, teamRatings, teams } from "../../db/schema";
import { getSportModel } from "../models";
import { logistic } from "../engine/probability";
import { matchTeamName } from "./team-map";
import type { IngestReport } from "./ingest";

const UA = { "user-agent": "BetMetricAI/2.0 (sports analytics; public results)", accept: "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* ------------------------------- ingest ------------------------------- */

interface EspnIndividualEvent {
  id: string;
  name?: string;
  date: string;
  competitions?: EspnIndividualComp[];
  groupings?: Array<{ competitions?: EspnIndividualComp[] }>;
}
interface EspnIndividualComp {
  id: string;
  date: string;
  status?: { type?: { name?: string; completed?: boolean; detail?: string; shortDetail?: string; description?: string } };
  competitors?: Array<{
    order?: number;
    winner?: boolean;
    athlete?: { displayName?: string };
    linescores?: Array<{ winner?: boolean }>;
  }>;
}

const CLAY_ATP = ["roland garros", "french open", "monte-carlo", "monte carlo", "madrid", "rome", "internazionali", "barcelona", "estoril", "munich", "bmw open", "geneva", "lyon", "hamburg", "gstaad", "umag", "bastad", "kitzbuhel", "buenos aires", "rio de janeiro", "santiago", "houston", "marrakech", "bucharest", "belgrade"];
const CLAY_WTA = ["roland garros", "french open", "madrid", "rome", "internazionali", "charleston", "stuttgart", "bogota", "rabat", "rouen", "strasbourg", "paris 125", "lausanne", "budapest", "palermo", "iasi", "hamburg", "prague", "warsaw", "bucharest"];
const GRASS_ATP = ["wimbledon", "queen's", "queens", "halle", "'s-hertogenbosch", "s-hertogenbosch", "libema", "mallorca", "eastbourne", "newport", "stuttgart"];
const GRASS_WTA = ["wimbledon", "queen's", "queens", "'s-hertogenbosch", "s-hertogenbosch", "libema", "eastbourne", "bad homburg", "berlin", "birmingham", "nottingham"];

/** Tournament name → surface. Tour-aware (e.g. Stuttgart: ATP grass, WTA clay). Default hard. */
export function tennisSurface(tour: "atp" | "wta", tournamentName: string): "hard" | "clay" | "grass" {
  const n = tournamentName.toLowerCase();
  const grass = tour === "atp" ? GRASS_ATP : GRASS_WTA;
  const clay = tour === "atp" ? CLAY_ATP : CLAY_WTA;
  if (grass.some((g) => n.includes(g))) return "grass";
  if (clay.some((c) => n.includes(c))) return "clay";
  return "hard";
}

function compsOf(e: EspnIndividualEvent): EspnIndividualComp[] {
  const out: EspnIndividualComp[] = [...(e.competitions ?? [])];
  for (const g of e.groupings ?? []) out.push(...(g.competitions ?? []));
  return out;
}

/**
 * Tennis events from joint tournaments (slams, combined events) carry BOTH
 * tours' matches in groupings — and ESPN serves the same event on both the
 * ATP and WTA endpoints. Filter by grouping slug so each match is ingested
 * exactly once, from its own tour, and doubles never leak in.
 * Events without groupings are single-tour events → take top-level comps.
 */
const TOUR_SLUG: Record<"atp" | "wta", string> = { atp: "mens-singles", wta: "womens-singles" };

function tennisCompsOf(e: EspnIndividualEvent, tour: "atp" | "wta"): EspnIndividualComp[] {
  const groupings = e.groupings ?? [];
  if (groupings.length === 0) return e.competitions ?? [];
  const want = TOUR_SLUG[tour];
  return groupings
    .filter((g) => (g as { grouping?: { slug?: string } }).grouping?.slug === want)
    .flatMap((g) => g.competitions ?? []);
}

const SKIP_DETAIL = /retir|walkover|w\/o|def\.|abandon|not completed/i;

async function insertIndividual(
  rows: Array<{ sportCode: string; source: string; sourceGameId: string; gameDate: string; startTime: Date;
    homeName: string; awayName: string; homeScore: number; awayScore: number; surface?: string }>,
  report: IngestReport,
) {
  const db = getDb();
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.sourceGameId)) continue;
    seen.add(r.sourceGameId);
    report.gamesFound++;
    try {
      await db.insert(gameResults).values({
        sportCode: r.sportCode, source: r.source, sourceGameId: r.sourceGameId,
        gameDate: r.gameDate, startTime: r.startTime,
        homeName: r.homeName, awayName: r.awayName,
        homeScore: r.homeScore, awayScore: r.awayScore,
        neutral: true, completed: true, surface: r.surface ?? null,
      });
      report.inserted++;
    } catch { /* duplicate */ }
  }
}

/** Tennis: tournaments span ~1-2 weeks, so step 7 days and dedupe by match id. */
export async function ingestTennis(start: Date, end: Date): Promise<IngestReport[]> {
  const reports: IngestReport[] = [];
  for (const tour of ["atp", "wta"] as const) {
    const report: IngestReport = { sportCode: "TENNIS", daysQueried: 0, gamesFound: 0, inserted: 0 };
    const day = new Date(start);
    while (day <= end) {
      const ymd = day.toISOString().slice(0, 10).replace(/-/g, "");
      const d = await getJson<{ events?: EspnIndividualEvent[] }>(
        `https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard?dates=${ymd}&limit=400`);
      report.daysQueried++;
      const rows: Parameters<typeof insertIndividual>[0] = [];
      for (const e of d?.events ?? []) {
        const surface = tennisSurface(tour, e.name ?? "");
        for (const c of tennisCompsOf(e, tour)) {
          const st = c.status?.type;
          const done = st?.completed === true || st?.name === "STATUS_FINAL";
          if (!done) continue;
          const detail = `${st?.detail ?? ""} ${st?.shortDetail ?? ""} ${st?.description ?? ""}`;
          if (SKIP_DETAIL.test(detail)) continue; // retirements/walkovers teach nothing about strength
          const comps = (c.competitors ?? []).filter((x) => x.athlete?.displayName);
          if (comps.length !== 2) continue;
          comps.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const [p1, p2] = comps;
          if (p1.winner !== true && p2.winner !== true) continue;
          const sets1 = p1.linescores?.filter((l) => l.winner === true).length;
          const sets2 = p2.linescores?.filter((l) => l.winner === true).length;
          const s1 = sets1 !== undefined && p1.linescores?.length ? sets1 : p1.winner ? 1 : 0;
          const s2 = sets2 !== undefined && p2.linescores?.length ? sets2 : p2.winner ? 1 : 0;
          rows.push({
            sportCode: "TENNIS", source: "ESPN_TENNIS", sourceGameId: `${tour}-${c.id}`,
            gameDate: c.date.slice(0, 10), startTime: new Date(c.date),
            homeName: p1.athlete!.displayName!, awayName: p2.athlete!.displayName!,
            homeScore: s1, awayScore: s2, surface,
          });
        }
      }
      await insertIndividual(rows, report);
      await sleep(80);
      day.setDate(day.getDate() + 7);
    }
    reports.push(report);
  }
  return reports;
}

/** UFC: fight cards are single-day events; step 3 days and dedupe by fight id. */
export async function ingestUfc(start: Date, end: Date): Promise<IngestReport> {
  const report: IngestReport = { sportCode: "UFC", daysQueried: 0, gamesFound: 0, inserted: 0 };
  const day = new Date(start);
  while (day <= end) {
    const ymd = day.toISOString().slice(0, 10).replace(/-/g, "");
    const d = await getJson<{ events?: EspnIndividualEvent[] }>(
      `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${ymd}&limit=200`);
    report.daysQueried++;
    const rows: Parameters<typeof insertIndividual>[0] = [];
    for (const e of d?.events ?? []) {
      for (const c of compsOf(e)) {
        const st = c.status?.type;
        const done = st?.completed === true || st?.name === "STATUS_FINAL";
        if (!done) continue;
        const comps = (c.competitors ?? []).filter((x) => x.athlete?.displayName);
        if (comps.length !== 2) continue;
        comps.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const [f1, f2] = comps;
        if (f1.winner !== true && f2.winner !== true) continue; // draws / no-contests teach nothing
        rows.push({
          sportCode: "UFC", source: "ESPN_UFC", sourceGameId: `ufc-${c.id}`,
          gameDate: c.date.slice(0, 10), startTime: new Date(c.date),
          homeName: f1.athlete!.displayName!, awayName: f2.athlete!.displayName!,
          homeScore: f1.winner === true ? 1 : 0, awayScore: f2.winner === true ? 1 : 0,
        });
      }
    }
    await insertIndividual(rows, report);
    await sleep(80);
    day.setDate(day.getDate() + 3);
  }
  return report;
}

/* ------------------------------- training ------------------------------ */

interface TrainMatch {
  date: string;
  p1: string; p2: string;      // p1 = "home" slot (arbitrary for individuals)
  winner1: boolean;
  surface?: string | null;
}

async function loadMatches(sportCode: string): Promise<TrainMatch[]> {
  const db = getDb();
  const all = await db.select().from(gameResults);
  return all
    .filter((r) => r.sportCode === sportCode && r.completed)
    .map((r) => ({
      date: r.gameDate, p1: r.homeName, p2: r.awayName,
      winner1: r.homeScore > r.awayScore, surface: r.surface,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Standard Elo expectation on a 400-point scale. */
function eloExpect(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, -(a - b) / 400));
}

export interface TennisTrained {
  elo: number;
  hardElo: number; clayElo: number; grassElo: number;
  surfMatches: Record<string, number>;
  matches: number; wins: number;
  last10: boolean[];
}

const TENNIS_BASE = 1800;   // matches the v1 model's defaultRatings.elo
const TENNIS_K = 32;
const TENNIS_K_SURF = 24;

function newTennisPlayer(): TennisTrained {
  return { elo: TENNIS_BASE, hardElo: TENNIS_BASE, clayElo: TENNIS_BASE, grassElo: TENNIS_BASE,
    surfMatches: {}, matches: 0, wins: 0, last10: [] };
}

export function tennisTrain(matches: TrainMatch[]): Map<string, TennisTrained> {
  const players = new Map<string, TennisTrained>();
  const get = (n: string) => {
    let p = players.get(n);
    if (!p) { p = newTennisPlayer(); players.set(n, p); }
    return p;
  };
  for (const m of matches) {
    const a = get(m.p1), b = get(m.p2);
    const exp = eloExpect(a.elo, b.elo);
    const score = m.winner1 ? 1 : 0;
    a.elo += TENNIS_K * (score - exp);
    b.elo += TENNIS_K * ((1 - score) - (1 - exp));
    const surf = (m.surface === "clay" || m.surface === "grass") ? m.surface : "hard";
    const key = `${surf}Elo` as "hardElo" | "clayElo" | "grassElo";
    const expS = eloExpect(a[key], b[key]);
    a[key] += TENNIS_K_SURF * (score - expS);
    b[key] += TENNIS_K_SURF * ((1 - score) - (1 - expS));
    a.surfMatches[surf] = (a.surfMatches[surf] ?? 0) + 1;
    b.surfMatches[surf] = (b.surfMatches[surf] ?? 0) + 1;
    a.matches++; b.matches++;
    if (m.winner1) a.wins++; else b.wins++;
    a.last10 = [...a.last10, m.winner1].slice(-10);
    b.last10 = [...b.last10, !m.winner1].slice(-10);
  }
  return players;
}

/**
 * Walk-forward validation: predict each match BEFORE updating ratings,
 * using the exact formula the v1 tennis model applies to surface Elo
 * (logistic(diff/95)). Baseline = all-default ratings = 50% always
 * (Brier 0.25) — that's what v1 produces for unrated players today.
 */
export function tennisWalkForward(matches: TrainMatch[], burnIn = 3): {
  brier: number; logLoss: number; n: number; baselineBrier: number;
} {
  const players = new Map<string, TennisTrained>();
  const get = (n: string) => {
    let p = players.get(n);
    if (!p) { p = newTennisPlayer(); players.set(n, p); }
    return p;
  };
  let brier = 0, ll = 0, n = 0;
  for (const m of matches) {
    const a = get(m.p1), b = get(m.p2);
    if (a.matches >= burnIn && b.matches >= burnIn) {
      const surf = (m.surface === "clay" || m.surface === "grass") ? m.surface : "hard";
      const key = `${surf}Elo` as "hardElo" | "clayElo" | "grassElo";
      const p = logistic((a[key] - b[key]) / 95); // v1 model formula
      const y = m.winner1 ? 1 : 0;
      brier += (p - y) ** 2;
      ll += -(y * Math.log(Math.max(p, 1e-9)) + (1 - y) * Math.log(Math.max(1 - p, 1e-9)));
      n++;
    }
    // update (same rules as tennisTrain)
    const exp = eloExpect(a.elo, b.elo);
    const score = m.winner1 ? 1 : 0;
    a.elo += TENNIS_K * (score - exp);
    b.elo += TENNIS_K * ((1 - score) - (1 - exp));
    const surf = (m.surface === "clay" || m.surface === "grass") ? m.surface : "hard";
    const key = `${surf}Elo` as "hardElo" | "clayElo" | "grassElo";
    const expS = eloExpect(a[key], b[key]);
    a[key] += TENNIS_K_SURF * (score - expS);
    b[key] += TENNIS_K_SURF * ((1 - score) - (1 - expS));
    a.matches++; b.matches++;
  }
  return { brier: n ? brier / n : NaN, logLoss: n ? ll / n : NaN, n, baselineBrier: 0.25 };
}

export interface UfcTrained { elo: number; fights: number; wins: number }

const UFC_BASE = 1500; // matches the v1 UFC model's defaultRatings.elo
const UFC_K = 32;

export function ufcTrain(fights: TrainMatch[]): Map<string, UfcTrained> {
  const fighters = new Map<string, UfcTrained>();
  const get = (n: string) => {
    let f = fighters.get(n);
    if (!f) { f = { elo: UFC_BASE, fights: 0, wins: 0 }; fighters.set(n, f); }
    return f;
  };
  for (const m of fights) {
    const a = get(m.p1), b = get(m.p2);
    const exp = eloExpect(a.elo, b.elo);
    const score = m.winner1 ? 1 : 0;
    a.elo += UFC_K * (score - exp);
    b.elo += UFC_K * ((1 - score) - (1 - exp));
    a.fights++; b.fights++;
    if (m.winner1) a.wins++; else b.wins++;
  }
  return fighters;
}

/** Walk-forward with the v1 UFC model's Elo logit term (diff/320). */
export function ufcWalkForward(fights: TrainMatch[], burnIn = 2): {
  brier: number; logLoss: number; n: number; baselineBrier: number;
} {
  const fighters = new Map<string, UfcTrained>();
  const get = (n: string) => {
    let f = fighters.get(n);
    if (!f) { f = { elo: UFC_BASE, fights: 0, wins: 0 }; fighters.set(n, f); }
    return f;
  };
  let brier = 0, ll = 0, n = 0;
  for (const m of fights) {
    const a = get(m.p1), b = get(m.p2);
    if (a.fights >= burnIn && b.fights >= burnIn) {
      const p = logistic((a.elo - b.elo) / 320); // v1 model formula
      const y = m.winner1 ? 1 : 0;
      brier += (p - y) ** 2;
      ll += -(y * Math.log(Math.max(p, 1e-9)) + (1 - y) * Math.log(Math.max(1 - p, 1e-9)));
      n++;
    }
    const exp = eloExpect(a.elo, b.elo);
    const score = m.winner1 ? 1 : 0;
    a.elo += UFC_K * (score - exp);
    b.elo += UFC_K * ((1 - score) - (1 - exp));
    a.fights++; b.fights++;
  }
  return { brier: n ? brier / n : NaN, logLoss: n ? ll / n : NaN, n, baselineBrier: 0.25 };
}

/* ------------------------------ deployment ----------------------------- */

export interface IndividualDeployReport {
  sportCode: string;
  validated: boolean;
  brier: number;
  baselineBrier: number;
  matchesEvaluated: number;
  trainedPlayers: number;
  deployed: number;
  skipped: number;
}

async function recordValidation(sportCode: string, modelVersion: string, n: number, brier: number, logLoss: number, trained: number) {
  const db = getDb();
  await db.insert(modelValidation).values({
    sportCode, modelVersion, gamesEvaluated: n,
    brier: brier.toFixed(6), logLoss: logLoss.toFixed(6),
    maeMargin: null, maeTotal: null, trainedGames: trained,
  });
}

async function deployRatings(
  sportCode: string,
  trainedNames: Map<string, unknown>,
  ratingsFor: (trainedName: string) => Record<string, number> | null,
): Promise<{ deployed: number; skipped: number }> {
  const db = getDb();
  const modelMeta = getSportModel(sportCode);
  const [sport] = await db.select().from(sports).where(eq(sports.code, sportCode)).limit(1);
  if (!sport) return { deployed: 0, skipped: 0 };
  const teamRows = await db.select().from(teams).where(eq(teams.sportId, sport.id));
  let deployed = 0, skipped = 0;
  for (const team of teamRows) {
    const trainedName = matchTeamName(team.name, trainedNames);
    if (!trainedName) { skipped++; continue; }
    const ratings = ratingsFor(trainedName);
    if (!ratings) { skipped++; continue; }
    const [existing] = await db.select().from(teamRatings)
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

/** Tennis: validate, then deploy only if trained Elo beats the 50/50 baseline. */
export async function validateAndDeployTennis(minMatches = 8): Promise<IndividualDeployReport> {
  const matches = await loadMatches("TENNIS");
  const wf = tennisWalkForward(matches);
  await recordValidation("TENNIS", "v2-elo", wf.n, wf.brier, wf.logLoss, matches.length);
  await recordValidation("TENNIS", "v1-default", wf.n, wf.baselineBrier, Math.log(2), 0);
  const validated = wf.n >= 300 && wf.brier < wf.baselineBrier;
  let deployed = 0, skipped = 0, trainedPlayers = 0;
  if (validated) {
    const trained = tennisTrain(matches);
    trainedPlayers = trained.size;
    const d = await deployRatings("TENNIS", trained, (name) => {
      const p = trained.get(name);
      if (!p || p.matches < minMatches) return null;
      const surfElo = (surf: string, key: "hardElo" | "clayElo" | "grassElo") =>
        (p.surfMatches[surf] ?? 0) >= 3 ? Math.round(p[key]) : Math.round(p.elo); // thin surface history → overall
      const form = p.last10.length > 0
        ? Math.round(p.last10.filter(Boolean).length / p.last10.length * 100) / 10
        : 5;
      return {
        elo: Math.round(p.elo),
        hardElo: surfElo("hard", "hardElo"),
        clayElo: surfElo("clay", "clayElo"),
        grassElo: surfElo("grass", "grassElo"),
        servePct: 0.635,   // tour average — the feed has no serve stats; model default
        returnPct: 0.325,  // tour average — model default
        form,
      };
    });
    deployed = d.deployed; skipped = d.skipped;
  }
  return { sportCode: "TENNIS", validated, brier: wf.brier, baselineBrier: wf.baselineBrier,
    matchesEvaluated: wf.n, trainedPlayers, deployed, skipped };
}

/** UFC: validate, then deploy only if trained Elo beats the 50/50 baseline. */
export async function validateAndDeployUfc(minFights = 3): Promise<IndividualDeployReport> {
  const fights = await loadMatches("UFC");
  const wf = ufcWalkForward(fights);
  await recordValidation("UFC", "v2-elo", wf.n, wf.brier, wf.logLoss, fights.length);
  await recordValidation("UFC", "v1-default", wf.n, wf.baselineBrier, Math.log(2), 0);
  const validated = wf.n >= 200 && wf.brier < wf.baselineBrier;
  let deployed = 0, skipped = 0, trainedPlayers = 0;
  if (validated) {
    const trained = ufcTrain(fights);
    trainedPlayers = trained.size;
    const d = await deployRatings("UFC", trained, (name) => {
      const f = trained.get(name);
      if (!f || f.fights < minFights) return null;
      return {
        elo: Math.round(f.elo),
        // no striking/grappling/reach/age data in the feed — model defaults
        slpm: 4.5, strAcc: 0.45, strDef: 0.55, tdAcc: 0.4, tdDef: 0.6,
        subRate: 0.15, finishRate: 0.5, koRate: 0.25, reach: 72, age: 30,
      };
    });
    deployed = d.deployed; skipped = d.skipped;
  }
  return { sportCode: "UFC", validated, brier: wf.brier, baselineBrier: wf.baselineBrier,
    matchesEvaluated: wf.n, trainedPlayers, deployed, skipped };
}

/**
 * Player-prop engine (NHL first). Projections come ONLY from real boxscore
 * stats in player_game_logs — rolling recency-weighted rates, regressed
 * toward the league mean. If a player has too few games, we return no
 * projection (never a fabricated number).
 *
 * Markets and their models:
 *   player_shots_on_goal        — Poisson(shots rate)
 *   player_points               — Poisson(points rate)
 *   player_goal_scorer_anytime  — 1 - exp(-goal rate)
 *
 * Discipline (same as everything else): prop rows publish as analysis with
 * edgeScore 0 (no bet recommendation) until prop_history proves the
 * projections against real outcomes.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  events, playerGameLogs, playerProps, propHistory, sports, teams,
} from "@db/schema";
import { alias } from "drizzle-orm/mysql-core";
import { americanPayout } from "../lib/edge";
import { syncEventProps } from "../feed/service";
import { noVigN } from "./probability";

const UA = { "user-agent": "BetMetricAI/2.0 (sports analytics; public results)", accept: "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, retries = 2): Promise<T | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return (await res.json()) as T;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

/* --------------------------- boxscore ingest ---------------------------- */

interface NhlBoxPlayer {
  playerId: number;
  name?: { default?: string };
  position?: string;
  goals?: number; assists?: number; points?: number; sog?: number; toi?: string;
}

function toiMinutes(toi?: string): number {
  if (!toi) return 0;
  const [m, s] = toi.split(":").map((x) => parseInt(x, 10));
  return (m || 0) + (s || 0) / 60;
}

/** Ingest player boxscores for one NHL game id. Returns rows inserted. */
export async function ingestNhlBoxscore(gameId: number): Promise<number> {
  const d = await getJson<{
    gameDate?: string;
    awayTeam?: { abbrev?: string };
    homeTeam?: { abbrev?: string };
    playerByGameStats?: Record<string, Record<string, NhlBoxPlayer[]>>;
  }>(`https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`);
  if (!d?.playerByGameStats) return 0;
  const gameDate = (d.gameDate ?? "").slice(0, 10);
  if (!gameDate) return 0;
  const sideAbbr: Record<string, string> = {
    awayTeam: d.awayTeam?.abbrev ?? "",
    homeTeam: d.homeTeam?.abbrev ?? "",
  };
  const db = getDb();
  let inserted = 0;
  for (const [side, teamStats] of Object.entries(d.playerByGameStats)) {
    for (const group of ["forwards", "defense"] as const) {
      for (const p of teamStats[group] ?? []) {
        const name = p.name?.default;
        if (!name || !p.playerId) continue;
        const stats = {
          goals: p.goals ?? 0,
          assists: p.assists ?? 0,
          points: p.points ?? (p.goals ?? 0) + (p.assists ?? 0),
          shots: p.sog ?? 0,
          toiMinutes: Math.round(toiMinutes(p.toi) * 10) / 10,
        };
        try {
          await db.insert(playerGameLogs).values({
            sportCode: "NHL",
            playerId: String(p.playerId),
            player: name,
            teamAbbr: sideAbbr[side] ?? "",
            gameDate,
            stats: JSON.stringify(stats),
          });
          inserted++;
        } catch { /* duplicate */ }
      }
    }
  }
  return inserted;
}

/** NHL schedule for one date → completed game ids (endpoint returns a week). */
async function nhlFinalGameIds(yyyymmddDash: string): Promise<Array<{ id: number; home: string; away: string }>> {
  const d = await getJson<{
    gameWeek?: Array<{ games?: Array<{ id: number; gameState?: string; homeTeam?: { abbrev?: string }; awayTeam?: { abbrev?: string } }> }>;
  }>(`https://api-web.nhle.com/v1/schedule/${yyyymmddDash}`);
  const out: Array<{ id: number; home: string; away: string }> = [];
  for (const day of d?.gameWeek ?? []) {
    for (const g of day.games ?? []) {
      if (g.gameState !== "OFF" && g.gameState !== "FINAL") continue;
      out.push({ id: g.id, home: g.homeTeam?.abbrev ?? "", away: g.awayTeam?.abbrev ?? "" });
    }
  }
  return out;
}

/** Backfill player logs for completed NHL games in [startDate, endDate]. */
export async function ingestNhlPlayerRange(startDate: Date, endDate: Date): Promise<{ games: number; rows: number }> {
  const day = new Date(startDate);
  const seenGames = new Set<number>();
  const all: Array<{ id: number; home: string; away: string }> = [];
  while (day <= endDate) {
    const finals = await nhlFinalGameIds(day.toISOString().slice(0, 10));
    for (const g of finals) {
      if (seenGames.has(g.id)) continue;
      seenGames.add(g.id);
      all.push(g);
    }
    day.setDate(day.getDate() + 7);
  }
  let games = 0, rows = 0, idx = 0;
  const workers = Array.from({ length: 5 }, async () => {
    while (idx < all.length) {
      const g = all[idx++];
      const n = await ingestNhlBoxscore(g.id);
      if (n > 0) { games++; rows += n; }
      await sleep(40);
    }
  });
  await Promise.all(workers);
  return { games, rows };
}

/* --------------------------- rate projections --------------------------- */

const HALF_LIFE_DAYS = 180;
const MIN_GAMES = 5;
const PRIOR_GAMES = 6; // shrinkage strength toward the league mean

interface PlayerRates {
  playerId: string;
  player: string;
  teamAbbr: string; // most recent team with a known abbrev ("" until a new ingest)
  games: number;
  goalsPer: number;
  pointsPer: number;
  shotsPer: number;
}

/** Recency-weighted, regressed per-game rates for every NHL skater. */
export async function nhlPlayerRates(): Promise<Map<string, PlayerRates>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(playerGameLogs)
    .where(eq(playerGameLogs.sportCode, "NHL"))
    .orderBy(desc(playerGameLogs.gameDate));

  interface Acc { player: string; teamAbbr: string; w: number; g: number; p: number; s: number; n: number }
  const acc = new Map<string, Acc>();
  const now = Date.now();
  let lgW = 0, lgG = 0, lgP = 0, lgS = 0;

  for (const r of rows) { // rows arrive newest-first
    const age = Math.max(0, (now - new Date(r.gameDate).getTime()) / 86_400_000);
    const w = Math.pow(0.5, age / HALF_LIFE_DAYS);
    let st: { goals?: number; points?: number; shots?: number };
    try { st = JSON.parse(r.stats); } catch { continue; }
    const goals = st.goals ?? 0, points = st.points ?? 0, shots = st.shots ?? 0;
    lgW += w; lgG += w * goals; lgP += w * points; lgS += w * shots;
    const a = acc.get(r.playerId) ?? { player: r.player, teamAbbr: r.teamAbbr, w: 0, g: 0, p: 0, s: 0, n: 0 };
    if (!a.teamAbbr && r.teamAbbr) a.teamAbbr = r.teamAbbr;
    a.w += w; a.g += w * goals; a.p += w * points; a.s += w * shots; a.n++;
    acc.set(r.playerId, a);
  }

  const lgGoals = lgW > 0 ? lgG / lgW : 0.25;
  const lgPoints = lgW > 0 ? lgP / lgW : 0.55;
  const lgShots = lgW > 0 ? lgS / lgW : 1.8;

  const out = new Map<string, PlayerRates>();
  for (const [playerId, a] of acc) {
    const shrink = a.w / (a.w + PRIOR_GAMES);
    out.set(playerId, {
      playerId,
      player: a.player,
      teamAbbr: a.teamAbbr,
      games: a.n,
      goalsPer: shrink * (a.g / a.w) + (1 - shrink) * lgGoals,
      pointsPer: shrink * (a.p / a.w) + (1 - shrink) * lgPoints,
      shotsPer: shrink * (a.s / a.w) + (1 - shrink) * lgShots,
    });
  }
  return out;
}

/** P(X > line) for Poisson(lambda), line a half-line like 2.5. */
function poissonOver(lambda: number, line: number): number {
  const k = Math.ceil(line); // smallest integer strictly greater than the line
  let p = 0, term = Math.exp(-lambda);
  for (let i = 0; i < k; i++) {
    if (i > 0) term *= lambda / i;
    p += term;
  }
  return 1 - p;
}

/** Normalize for name matching: "A. Ovechkin" and "Alex Ovechkin" must meet. */
export function normalizePlayerName(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

/** Boxscore names are abbreviated ("A. Ovechkin"); prop descriptions are full
 *  ("Alex Ovechkin"). Match on surname + first initial, positionally.
 *  Two NHL players can share an abbreviated name (e.g. Vancouver's two
 *  "E. Pettersson") — an ambiguous match returns null and the prop is
 *  skipped entirely. A skipped prop is honest; a misattributed one is not. */
function rateFor(byName: Map<string, PlayerRates[]>, player: string): PlayerRates | null {
  const exact = byName.get(normalizePlayerName(player));
  if (exact) return exact.length === 1 ? exact[0] : null;
  const parts = normalizePlayerName(player).split(" ");
  const last = parts[parts.length - 1];
  const firstInitial = parts[0]?.[0];
  if (!last || !firstInitial) return null;
  let hit: PlayerRates | null = null;
  for (const arr of byName.values()) {
    for (const r of arr) {
      const rp = normalizePlayerName(r.player).split(" ");
      const rLast = rp[rp.length - 1];
      const rFirst = rp[0]?.[0];
      if (rLast === last && rFirst === firstInitial) {
        if (hit && hit.playerId !== r.playerId) return null; // ambiguous
        hit = r;
      }
    }
  }
  return hit;
}

/* ------------------------- sync + analyze props ------------------------- */

const NHL_PROP_MARKETS = ["player_points", "player_shots_on_goal", "player_goal_scorer_anytime"];

/** Minimum anchored EV to publish a prop edge at all. */
const PROP_MIN_EV = 0.03;

/**
 * Pull props for NHL events starting within `hoursAhead`, project them, and
 * upsert into player_props. Costs real credits (measured and returned).
 */
export async function syncNhlProps(hoursAhead = 36): Promise<{
  eventsTried: number; eventsWithProps: number; rowsWritten: number; credits: number; errors: string[];
}> {
  const db = getDb();
  const out = { eventsTried: 0, eventsWithProps: 0, rowsWritten: 0, credits: 0, errors: [] as string[] };

  const nhlEvents = await db
    .select({ id: events.id, providerEventId: events.providerEventId })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(and(
      eq(sports.code, "NHL"),
      eq(events.status, "scheduled"),
      gte(events.startTime, new Date()),
      sql`${events.startTime} < DATE_ADD(NOW(), INTERVAL ${hoursAhead} HOUR)`,
    ));

  const rates = await nhlPlayerRates();
  if (rates.size === 0) {
    out.errors.push("no NHL player game logs yet — run ingestNhlPlayerRange first");
    return out;
  }
  const byName = new Map<string, PlayerRates[]>();
  for (const r of rates.values()) {
    const k = normalizePlayerName(r.player);
    const arr = byName.get(k) ?? [];
    arr.push(r);
    byName.set(k, arr);
  }

  for (const ev of nhlEvents) {
    if (!ev.providerEventId) continue;
    out.eventsTried++;
    const res = await syncEventProps("NHL", ev.providerEventId, NHL_PROP_MARKETS);
    out.credits += res.cost;
    if (res.error) { out.errors.push(`event ${ev.id}: ${res.error}`); continue; }
    out.eventsWithProps++;
    out.rowsWritten += await analyzeEventProps(ev.id, byName);
  }
  return out;
}

/* ---------------------- per-event analysis + write ---------------------- */

const homeT = alias(teams, "home_teams");
const awayT = alias(teams, "away_teams");

/** Project every prop row stored for an event and upsert into player_props. */
export async function analyzeEventProps(
  eventId: number,
  byName: Map<string, PlayerRates[]>,
): Promise<number> {
  const db = getDb();
  const { currentOdds } = await import("@db/schema");
  const rows = await db
    .select()
    .from(currentOdds)
    .where(and(eq(currentOdds.eventId, eventId), eq(currentOdds.market, "prop")));
  if (rows.length === 0) return 0;

  interface SideOffer { bookId: number; line: number | null; odds: number }
  interface LineGroup { player: string; marketKey: string; line: number; over: SideOffer[]; under: SideOffer[] }
  // Group by player + provider market key + LINE. Books hang alternate lines
  // (shots 1.5/2.5/3.5 …) in the same market — pairing an over at one line
  // with an under at another fabricates fake arbitrage EV. Never mix lines.
  const grouped = new Map<string, LineGroup>();
  for (const r of rows) {
    const [player, side, marketKey] = r.outcome.split("|");
    if (!player || (side !== "over" && side !== "under") || !marketKey) continue;
    if (!NHL_PROP_MARKETS.includes(marketKey)) continue;
    const lineVal = r.line === null ? 0.5 : parseFloat(r.line);
    const key = `${player}|${marketKey}|${lineVal}`;
    const g = grouped.get(key) ?? { player, marketKey, line: lineVal, over: [], under: [] };
    const offer: SideOffer = { bookId: r.sportsbookId, line: lineVal, odds: r.americanOdds };
    if (side === "over") g.over.push(offer); else g.under.push(offer);
    grouped.set(key, g);
  }

  // one card per player+market: the PRIMARY line = most balanced no-vig
  // prices (the book's main line), never an alternate.
  const primary = new Map<string, LineGroup>();
  for (const g of grouped.values()) {
    if (g.over.length === 0 || g.under.length === 0) continue;
    const pmKey = `${g.player}|${g.marketKey}`;
    const cur = primary.get(pmKey);
    if (!cur) { primary.set(pmKey, g); continue; }
    const balance = (x: LineGroup) => {
      const bo = Math.max(...x.over.map((o) => o.odds));
      const bu = Math.max(...x.under.map((o) => o.odds));
      const [fo] = noVigN([bo, bu]);
      return Math.abs(fo - 0.5);
    };
    if (balance(g) < balance(cur)) primary.set(pmKey, g);
  }

  let written = 0;
  for (const g of primary.values()) {
    const rate = rateFor(byName, g.player);
    if (!rate || rate.games < MIN_GAMES) continue; // no honest projection — skip
    const bestOver = [...g.over].sort((a, b) => b.odds - a.odds)[0];
    const bestUnder = [...g.under].sort((a, b) => b.odds - a.odds)[0];

    let lambda: number;
    let probOver: number;
    const line = g.line;
    if (g.marketKey === "player_goal_scorer_anytime") {
      lambda = rate.goalsPer;
      probOver = 1 - Math.exp(-lambda);
    } else if (g.marketKey === "player_points") {
      lambda = rate.pointsPer;
      probOver = poissonOver(lambda, line);
    } else { // player_shots_on_goal
      lambda = rate.shotsPer;
      probOver = poissonOver(lambda, line);
    }

    const [fairOver] = noVigN([bestOver.odds, bestUnder.odds]);
    // market anchor: props are thinner than sides/totals — model keeps 65%.
    // probOver / evOver are ALWAYS the true "over" side; lean/evLean carry
    // which side (if either) holds value. Never store lean-side numbers in
    // over-labelled columns — the UI and grader both read them literally.
    const anchoredOver = 0.65 * probOver + 0.35 * fairOver;
    const anchoredUnder = 1 - anchoredOver;
    const evOver = anchoredOver * (1 + americanPayout(bestOver.odds)) - 1;
    const evUnder = anchoredUnder * (1 + americanPayout(bestUnder.odds)) - 1;
    const leanOver = evOver >= evUnder;
    const leanEv = Math.max(evOver, evUnder);
    const bestBook = leanOver ? bestOver.bookId : bestUnder.bookId;

    if (leanEv < PROP_MIN_EV) continue;

    const payload = {
      sportsbookId: bestBook,
      line: String(line),
      overOdds: bestOver.odds,
      underOdds: bestUnder.odds,
      projValue: String(Math.round(lambda * 100) / 100),
      probOver: String(anchoredOver.toFixed(4)),
      evOver: String(evOver.toFixed(4)),
      lean: leanOver ? "over" : "under",
      evLean: String(leanEv.toFixed(4)),
      edgeScore: 0, // unproven until prop_history proves the model
      updatedAt: new Date(),
    };
    const existing = await db
      .select()
      .from(playerProps)
      .where(and(eq(playerProps.eventId, eventId), eq(playerProps.player, g.player), eq(playerProps.market, g.marketKey)))
      .limit(1);
    if (existing.length > 0) {
      await db.update(playerProps).set(payload).where(eq(playerProps.id, existing[0].id));
    } else {
      await db.insert(playerProps).values({
        eventId, player: g.player, teamAbbr: rate.teamAbbr, market: g.marketKey,
        line: payload.line, overOdds: payload.overOdds, underOdds: payload.underOdds,
        projValue: payload.projValue, probOver: payload.probOver, evOver: payload.evOver,
        lean: payload.lean, evLean: payload.evLean,
        edgeScore: 0, sportsbookId: bestBook,
      });
    }
    written++;
  }
  return written;
}

/* ------------------------------ grading -------------------------------- */

/** Grade settled NHL props from real boxscores into prop_history.
 *  Append-only: a prop with a history row is never re-graded. */
export async function gradeNhlProps(): Promise<number> {
  const db = getDb();
  const finalEvents = await db
    .select({ event: events, home: homeT, away: awayT })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .innerJoin(homeT, eq(events.homeTeamId, homeT.id))
    .innerJoin(awayT, eq(events.awayTeamId, awayT.id))
    .where(and(eq(sports.code, "NHL"), eq(events.status, "final")));

  let graded = 0;
  for (const { event, home, away } of finalEvents) {
    const props = await db.select().from(playerProps).where(eq(playerProps.eventId, event.id));
    if (props.length === 0) continue;

    const ymd = event.startTime.toISOString().slice(0, 10);
    const finals = await nhlFinalGameIds(ymd);
    const match = finals.find((g) => g.home === home.abbr && g.away === away.abbr);
    if (!match) continue;

    await ingestNhlBoxscore(match.id); // idempotent
    const logs = await db
      .select()
      .from(playerGameLogs)
      .where(and(eq(playerGameLogs.sportCode, "NHL"), eq(playerGameLogs.gameDate, ymd)));
    const actualByName = new Map<string, { goals: number; points: number; shots: number }>();
    for (const l of logs) {
      try { actualByName.set(normalizePlayerName(l.player), JSON.parse(l.stats)); } catch { /* skip */ }
    }

    for (const prop of props) {
      const [already] = await db.select({ id: propHistory.id }).from(propHistory).where(eq(propHistory.pickId, prop.id)).limit(1);
      if (already) continue;
      const actual = actualByName.get(normalizePlayerName(prop.player));
      if (!actual) continue; // player not in the boxscore — skip honestly
      const line = parseFloat(prop.line);
      const stat =
        prop.market === "player_goal_scorer_anytime" ? actual.goals
        : prop.market === "player_points" ? actual.points
        : actual.shots;
      const leanOver = prop.lean ? prop.lean === "over" : parseFloat(prop.evOver) >= 0;
      const result: "won" | "lost" | "push" =
        stat === line ? "push" : (stat > line) === leanOver ? "won" : "lost";
      const odds = leanOver ? prop.overOdds : prop.underOdds;
      const units = result === "won" ? americanPayout(odds) : result === "lost" ? -1 : 0;
      const pOver = parseFloat(prop.probOver);

      await db.insert(propHistory).values({
        sportCode: "NHL",
        market: prop.market,
        eventLabel: `${away.abbr} @ ${home.abbr}`,
        player: prop.player,
        selection: `${leanOver ? "Over" : "Under"} ${prop.line}`,
        odds,
        line: prop.line,
        modelProb: String((leanOver ? pOver : 1 - pOver).toFixed(4)),
        result,
        units: units.toFixed(2),
        placedAt: prop.updatedAt,
        completedAt: new Date(event.startTime.getTime() + 150 * 60_000), // NHL ≈ 150 min
        pickId: prop.id,
      });
      graded++;
    }
  }
  return graded;
}

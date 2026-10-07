/**
 * BetMetricAi market simulator (DEMO DATA mode).
 *
 * In production this layer is replaced by the licensed odds/data feeds.
 * While `data_mode = DEMO`, it drives the same pipeline the real feeds
 * would drive: new odds snapshots → model recompute → new pick versions
 * → alerts. Nothing is overwritten; every change is versioned.
 *
 * Multi-sport: every live event progresses on its own sport's clock,
 * scoring rhythm, and live model (each sport module's `live` config). Soccer is
 * priced 3-way (home/draw/away); totals/spreads evaluate against the
 * sport's live distribution (Poisson or normal).
 */
import { getDb } from "../queries/connection";
import {
  adminConfig,
  alerts,
  apiLogs,
  events,
  oddsSnapshots,
  predictions,
  sports,
  sportsbooks,
} from "@db/schema";
import { and, eq, lt } from "drizzle-orm";
import { normCdf, probToAmerican } from "../engine/probability";
import { poissonPmf } from "../engine/probability";
import { recomputeEventPicks } from "../engine/recompute";
import { SPORT_MODELS } from "../models";
import type { LiveConfig } from "../models/interface";

const TICK_MS = 40_000;
/** Game-time acceleration for live demos (game minutes per real minute). */
const GAME_SPEED = 2.0;
/** game minutes advanced per tick */
const TICK_GAME_MIN = (TICK_MS / 60000) * GAME_SPEED;

let started = false;

function log(service: string, level: "info" | "warn" | "error", message: string) {
  getDb()
    .insert(apiLogs)
    .values({ service, level, message })
    .catch(() => {});
}

async function heartbeat() {
  const db = getDb();
  await db
    .insert(adminConfig)
    .values({ key: "sim_last_tick", value: new Date().toISOString() })
    .onDuplicateKeyUpdate({ set: { value: new Date().toISOString() } });
}

/** Deterministic per-event jitter in [-1, 1]. */
function jitter(seed: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/* ---------------- sport-specific live presentation ---------------- */

function periodLabel(code: string, idx: number): string {
  switch (code) {
    case "NFL":
    case "NCAAF":
    case "NBA":
      return `Q${idx}`;
    case "NCAAB":
      return `H${idx}`;
    case "MLB":
      return `T${idx}`;
    case "NHL":
      return `P${idx}`;
    case "SOCCER":
      return idx === 1 ? "1H" : "2H";
    case "TENNIS":
      return `S${idx}`;
    case "GOLF":
    case "UFC":
      return `R${idx}`;
    default:
      return "LIVE";
  }
}

/** Clock display for the current position in the game. */
function clockLabel(code: string, cfg: LiveConfig, gameMin: number): string | null {
  if (code === "SOCCER") return `${Math.min(90, Math.floor(gameMin))}'`;
  if (code === "TENNIS" || code === "GOLF" || code === "MOTORSPORTS" || code === "MLB")
    return null;
  const per = cfg.gameMinutes / cfg.periods;
  const idx = Math.min(cfg.periods, Math.floor(gameMin / per) + 1);
  const clockSec = Math.max(0, Math.round((per * idx - gameMin) * 60));
  return `${Math.floor(clockSec / 60)}:${String(clockSec % 60).padStart(2, "0")}`;
}

/** Points added by one scoring event. */
function scoreStep(code: string): number {
  switch (code) {
    case "NFL":
    case "NCAAF":
      return Math.random() < 0.62 ? 7 : 3;
    case "NBA":
    case "NCAAB":
      return Math.random() < 0.7 ? 2 : 3;
    case "MLB":
      return Math.random() < 0.85 ? 1 : 2;
    default:
      return 1; // NHL/soccer goals, tennis games, golf strokes, UFC rounds, laps
  }
}

/** Average points per scoring event (drives per-tick scoring probability). */
function avgStep(code: string): number {
  switch (code) {
    case "NFL":
      return 5.5;
    case "NCAAF":
      return 5.6;
    case "NBA":
    case "NCAAB":
      return 2.2;
    case "MLB":
      return 1.15;
    default:
      return 1;
  }
}

/** Advance one side's score with probability matched to the sport's scoring rate. */
function maybeScore(current: number, ratePerGame: number, cfg: LiveConfig, code: string): number {
  const expectedPts = (ratePerGame * TICK_GAME_MIN) / cfg.gameMinutes;
  const p = Math.min(1, expectedPts / avgStep(code));
  return Math.random() < p ? current + scoreStep(code) : current;
}

/* ---------------- live model ---------------- */

interface PreDetails {
  drawProb?: number;
  agreementFrac?: number;
  agreement?: string;
  dist?:
    | { kind: "normal"; marginMean: number; marginSd: number; totalMean: number; totalSd: number }
    | { kind: "poisson"; lambdaHome: number; lambdaAway: number; tie: "draw" | "fifty" };
}

function parseDetails(raw: string | null): PreDetails {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PreDetails;
  } catch {
    return {};
  }
}

/** P(final home score > final away score) etc. from remaining Poisson lambdas. */
function poissonLiveOutcome(
  home: number,
  away: number,
  lamHRem: number,
  lamARem: number,
): { homeWin: number; draw: number } {
  let homeWin = 0;
  let draw = 0;
  const maxRem = Math.max(10, Math.ceil(Math.max(lamHRem, lamARem) + 8));
  const hP: number[] = [];
  for (let i = 0; i <= maxRem; i++) {
    hP.push(poissonPmf(i, Math.max(0.05, lamHRem)));
  }
  for (let h = 0; h <= maxRem; h++) {
    for (let a = 0; a <= maxRem; a++) {
      const p = hP[h] * poissonPmf(a, Math.max(0.05, lamARem));
      const fh = home + h;
      const fa = away + a;
      if (fh > fa) homeWin += p;
      else if (fh === fa) draw += p;
    }
  }
  return { homeWin, draw };
}

/* ---------------- event lifecycle ---------------- */

/** Promote scheduled events whose start time has passed to LIVE. */
async function promoteEvents() {
  const db = getDb();
  const due = await db
    .select({ ev: events, code: sports.code })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(and(eq(events.status, "scheduled"), lt(events.startTime, new Date())));
  for (const { ev, code } of due) {
    const model = SPORT_MODELS[code];
    const cfg = model?.live;
    await db
      .update(events)
      .set({
        status: "live",
        startTime: new Date(),
        homeScore: 0,
        awayScore: 0,
        period: periodLabel(code, 1),
        clock: cfg ? clockLabel(code, cfg, 0) : null,
      })
      .where(eq(events.id, ev.id));
    await db.insert(alerts).values({
      type: "system",
      title: "Game went live",
      message: `Event #${ev.id} (${code}) is now LIVE — switched to the live prediction model.`,
    });
    log("simulator", "info", `event ${ev.id} (${code}) promoted to live`);
  }
}

/** Advance live games: clock, score, live model, live odds, pick recompute. */
async function advanceLiveGames() {
  const db = getDb();
  const live = await db
    .select({ ev: events, code: sports.code })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(eq(events.status, "live"));

  for (const { ev, code } of live) {
    const model = SPORT_MODELS[code];
    if (!model) continue;
    const cfg = model.live;

    const elapsedMin = (Date.now() - ev.startTime.getTime()) / 60000;
    const gameMin = Math.min(cfg.gameMinutes, elapsedMin * GAME_SPEED);
    const progress = gameMin / cfg.gameMinutes;
    const finished = gameMin >= cfg.gameMinutes;

    // scoring
    let home = ev.homeScore ?? 0;
    let away = ev.awayScore ?? 0;
    if (!finished) {
      home = maybeScore(home, cfg.homeScoreRate, cfg, code);
      away = maybeScore(away, cfg.awayScoreRate, cfg, code);
    }

    const periodIdx = Math.min(cfg.periods, Math.floor((gameMin / cfg.gameMinutes) * cfg.periods) + 1);
    await db
      .update(events)
      .set({
        homeScore: home,
        awayScore: away,
        period: finished ? "FT" : periodLabel(code, periodIdx),
        clock: finished ? null : clockLabel(code, cfg, gameMin),
        status: finished ? "final" : "live",
      })
      .where(eq(events.id, ev.id));

    // pregame projection as the live model's prior
    const pre = await db
      .select()
      .from(predictions)
      .where(and(eq(predictions.eventId, ev.id), eq(predictions.isLive, false)))
      .orderBy(predictions.id)
      .limit(1);
    if (pre.length === 0) continue;
    const preSpread = parseFloat(pre[0].projSpread);
    const preTotal = parseFloat(pre[0].projTotal);
    const preDetails = parseDetails(pre[0].details);

    const margin = home - away;
    const scored = home + away;
    let homeWinProb: number;
    let drawProb = 0;
    let liveDist: NonNullable<PreDetails["dist"]>;

    if (preDetails.dist?.kind === "poisson") {
      // remaining-time-scaled Poisson (soccer / NHL / MLB)
      const rem = 1 - progress;
      const lamHRem = preDetails.dist.lambdaHome * rem;
      const lamARem = preDetails.dist.lambdaAway * rem;
      const out = poissonLiveOutcome(home, away, lamHRem, lamARem);
      drawProb = preDetails.dist.tie === "draw" ? out.draw : 0;
      homeWinProb =
        preDetails.dist.tie === "draw"
          ? out.homeWin
          : out.homeWin + out.draw * 0.5; // OT/SO coin flip (NHL)
      liveDist = {
        kind: "poisson",
        lambdaHome: home + lamHRem,
        lambdaAway: away + lamARem,
        tie: preDetails.dist.tie,
      };
    } else {
      // normal margin/total sports
      const liveSpread = margin + preSpread * (1 - progress) * 0.85;
      const liveTotal = scored + preTotal * (1 - progress) * 0.9;
      const sdRemain = Math.max(cfg.marginSd * 0.2, cfg.marginSd * Math.sqrt(1 - progress));
      const totSdRemain = Math.max(cfg.totalSd * 0.25, cfg.totalSd * Math.sqrt(1 - progress));
      homeWinProb = normCdf(liveSpread / sdRemain);
      liveDist = {
        kind: "normal",
        marginMean: liveSpread,
        marginSd: sdRemain,
        totalMean: liveTotal,
        totalSd: totSdRemain,
      };
    }

    const liveSpreadOut =
      liveDist.kind === "normal" ? liveDist.marginMean : liveDist.lambdaHome - liveDist.lambdaAway;
    const liveTotalOut =
      liveDist.kind === "normal" ? liveDist.totalMean : liveDist.lambdaHome + liveDist.lambdaAway;
    const projHome =
      liveDist.kind === "poisson" ? liveDist.lambdaHome : (liveTotalOut + liveSpreadOut) / 2;
    const projAway =
      liveDist.kind === "poisson" ? liveDist.lambdaAway : (liveTotalOut - liveSpreadOut) / 2;

    await db.insert(predictions).values({
      eventId: ev.id,
      modelId: model.modelId,
      modelVersion: `${model.modelVersion}-live`,
      projHomeScore: String(Math.max(home, projHome).toFixed(1)),
      projAwayScore: String(Math.max(away, projAway).toFixed(1)),
      projSpread: liveSpreadOut.toFixed(1),
      projTotal: liveTotalOut.toFixed(1),
      homeWinProb: homeWinProb.toFixed(4),
      confidence: (0.62 + 0.2 * progress).toFixed(3),
      isLive: true,
      details: JSON.stringify({
        drawProb,
        agreement: preDetails.agreement ?? null,
        agreementFrac: preDetails.agreementFrac ?? 0.75,
        dist: liveDist,
      }),
    });

    if (finished) {
      await db.insert(alerts).values({
        type: "system",
        title: "Game final",
        message: `Event #${ev.id} (${code}) finished ${away}–${home}. Grading queued.`,
      });
      continue;
    }

    // live market prices (with book noise → live +EV windows)
    const books = await db.select().from(sportsbooks).where(eq(sportsbooks.active, true));
    const marketSpread = roundHalf(-liveSpreadOut + jitter(ev.id, Math.floor(gameMin)) * 1.5);
    const marketTotal = roundHalf(liveTotalOut + jitter(ev.id, Math.floor(gameMin) + 7) * 2);
    const mlFromProb = (p: number) => {
      const adj = Math.min(0.985, Math.max(0.015, p * 1.04)); // bookmaker margin
      return Math.round(probToAmerican(adj) / 5) * 5;
    };
    const homeMlLive = mlFromProb(homeWinProb);
    const awayProb = 1 - homeWinProb - drawProb;
    const awayMlLive = mlFromProb(awayProb);
    const drawMlLive = drawProb > 0 ? mlFromProb(drawProb) : null;
    const now = new Date();

    for (const b of books) {
      const j = jitter(b.id, Math.floor(gameMin * 2));
      const rows: Array<typeof oddsSnapshots.$inferInsert> = [];
      if (model.pickMarkets.includes("spread")) {
        rows.push(
          { eventId: ev.id, sportsbookId: b.id, market: "spread", selection: "home", line: String(marketSpread), odds: -110 + Math.round(j * 8), isLive: true, capturedAt: now },
          { eventId: ev.id, sportsbookId: b.id, market: "spread", selection: "away", line: String(-marketSpread), odds: -110 - Math.round(j * 8), isLive: true, capturedAt: now },
        );
      }
      if (model.pickMarkets.includes("total")) {
        rows.push(
          { eventId: ev.id, sportsbookId: b.id, market: "total", selection: "over", line: String(marketTotal), odds: -110 + Math.round(j * 6), isLive: true, capturedAt: now },
          { eventId: ev.id, sportsbookId: b.id, market: "total", selection: "under", line: String(marketTotal), odds: -110 - Math.round(j * 6), isLive: true, capturedAt: now },
        );
      }
      if (model.pickMarkets.includes("moneyline")) {
        rows.push(
          { eventId: ev.id, sportsbookId: b.id, market: "moneyline", selection: "home", line: null, odds: homeMlLive + Math.round(j * 10), isLive: true, capturedAt: now },
          { eventId: ev.id, sportsbookId: b.id, market: "moneyline", selection: "away", line: null, odds: awayMlLive - Math.round(j * 8), isLive: true, capturedAt: now },
        );
        if (drawMlLive !== null) {
          rows.push({ eventId: ev.id, sportsbookId: b.id, market: "moneyline", selection: "draw", line: null, odds: drawMlLive + Math.round(j * 6), isLive: true, capturedAt: now });
        }
      }
      if (rows.length > 0) await db.insert(oddsSnapshots).values(rows);
    }
    await recomputeEventPicks(ev.id);
  }
}

/** Pregame market movement: nudge one event's market and recompute. */
async function movePregameMarket() {
  const db = getDb();
  const scheduled = await db
    .select({ ev: events, code: sports.code })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(eq(events.status, "scheduled"));
  if (scheduled.length === 0) return;
  const { ev, code } = scheduled[Math.floor(Math.random() * scheduled.length)];
  const model = SPORT_MODELS[code];
  const markets = (model?.pickMarkets ?? ["spread", "total", "moneyline"]) as Array<
    "spread" | "total" | "moneyline"
  >;
  const market = markets[Math.floor(Math.random() * markets.length)];

  const books = await db.select().from(sportsbooks).where(eq(sportsbooks.active, true));

  // latest consensus line for the market
  const latest = await db
    .select()
    .from(oddsSnapshots)
    .where(and(eq(oddsSnapshots.eventId, ev.id), eq(oddsSnapshots.market, market)))
    .orderBy(oddsSnapshots.id);
  if (latest.length === 0) return;
  const base = latest[latest.length - 1];
  const baseLine = base.line === null ? 0 : parseFloat(base.line);

  // mean-reverting drift: keep the market within a plausible band of the model
  const pre = await db
    .select()
    .from(predictions)
    .where(and(eq(predictions.eventId, ev.id), eq(predictions.isLive, false)))
    .orderBy(predictions.id)
    .limit(1);
  let anchor: number | null = null;
  if (pre.length > 0) {
    anchor =
      market === "spread"
        ? -parseFloat(pre[0].projSpread) // home spread is negative when home is favored
        : market === "total"
          ? parseFloat(pre[0].projTotal)
          : null;
  }
  let step = Math.random() < 0.5 ? 0.5 : -0.5;
  if (anchor !== null) {
    const gap = baseLine - anchor;
    if (Math.abs(gap) > 2.5) {
      step = gap > 0 ? -0.5 : 0.5; // snap back toward the model
    } else if (Math.abs(gap) > 1.5 && Math.random() < 0.65) {
      step = gap > 0 ? -0.5 : 0.5;
    }
  }
  const oddsStep = Math.random() < 0.5 ? 5 : -5;
  const newLine = market === "moneyline" ? 0 : roundHalf(baseLine + step);
  const now = new Date();

  for (const b of books) {
    const j = jitter(b.id, Date.now() % 100000);
    const bookLine = market === "moneyline" ? null : String(roundHalf(newLine + (j > 0.6 ? 0.5 : j < -0.6 ? -0.5 : 0)));
    if (market === "spread") {
      const homeOdds = -110 + Math.round(j * 10) + oddsStep;
      await db.insert(oddsSnapshots).values([
        { eventId: ev.id, sportsbookId: b.id, market, selection: "home", line: bookLine, odds: homeOdds, isLive: false, capturedAt: now },
        { eventId: ev.id, sportsbookId: b.id, market, selection: "away", line: bookLine === null ? null : String(-parseFloat(bookLine)), odds: -110 - Math.round(j * 10), isLive: false, capturedAt: now },
      ]);
    } else if (market === "total") {
      await db.insert(oddsSnapshots).values([
        { eventId: ev.id, sportsbookId: b.id, market, selection: "over", line: bookLine, odds: -110 + Math.round(j * 8) + oddsStep, isLive: false, capturedAt: now },
        { eventId: ev.id, sportsbookId: b.id, market, selection: "under", line: bookLine, odds: -110 - Math.round(j * 8), isLive: false, capturedAt: now },
      ]);
    } else {
      const prevHome = latest.filter((r) => r.selection === "home" && r.sportsbookId === b.id).pop();
      const prevAway = latest.filter((r) => r.selection === "away" && r.sportsbookId === b.id).pop();
      if (!prevHome || !prevAway) continue;
      // mean-revert moneylines toward the model's fair price
      let mlStep = oddsStep;
      if (pre.length > 0) {
        const hwp = parseFloat(pre[0].homeWinProb);
        const fair = Math.round(probToAmerican(Math.min(0.985, Math.max(0.015, hwp))) / 5) * 5;
        const gap = prevHome.odds - fair; // vig pushes favorites more negative
        if (prevHome.odds < 0 && gap < -45) mlStep = 10;
        else if (prevHome.odds < 0 && gap > 25) mlStep = -10;
        else if (prevHome.odds > 0 && gap > 45) mlStep = -10;
        else if (prevHome.odds > 0 && gap < 10) mlStep = 10;
      }
      const rows: Array<typeof oddsSnapshots.$inferInsert> = [
        { eventId: ev.id, sportsbookId: b.id, market, selection: "home", line: null, odds: prevHome.odds + mlStep + Math.round(j * 5), isLive: false, capturedAt: now },
        { eventId: ev.id, sportsbookId: b.id, market, selection: "away", line: null, odds: prevAway.odds - mlStep - Math.round(j * 5), isLive: false, capturedAt: now },
      ];
      // soccer 3-way: move the draw price in sympathy
      const prevDraw = latest.filter((r) => r.selection === "draw" && r.sportsbookId === b.id).pop();
      if (prevDraw) {
        rows.push({ eventId: ev.id, sportsbookId: b.id, market, selection: "draw", line: null, odds: prevDraw.odds + Math.round(j * 5) - Math.round(mlStep / 2), isLive: false, capturedAt: now });
      }
      await db.insert(oddsSnapshots).values(rows);
    }
  }

  await recomputeEventPicks(ev.id);
}

export function startSimulator() {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await heartbeat();
      await promoteEvents();
      await advanceLiveGames();
      if (Math.random() < 0.75) await movePregameMarket();
    } catch (e) {
      log("simulator", "error", `tick failed: ${(e as Error).message}`);
    }
  };
  setInterval(tick, TICK_MS);
  log("simulator", "info", "market simulator started (DEMO DATA mode, multi-sport)");
}

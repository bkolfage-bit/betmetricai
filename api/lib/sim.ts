/**
 * BetMetricAi market simulator (DEMO DATA mode).
 *
 * In production this layer is replaced by the licensed odds/data feeds.
 * While `data_mode = DEMO`, it drives the same pipeline the real feeds
 * would drive: new odds snapshots → model recompute → new pick versions
 * → alerts. Nothing is overwritten; every change is versioned.
 */
import { getDb } from "../queries/connection";
import {
  adminConfig,
  alerts,
  apiLogs,
  events,
  oddsSnapshots,
  predictions,
  sportsbooks,
} from "@db/schema";
import { and, eq, lt } from "drizzle-orm";
import { normCdf } from "./edge";
import { recomputeEventPicks } from "../engine/recompute";

const TICK_MS = 40_000;
/** Game-time acceleration for live demos (game minutes per real minute). */
const GAME_SPEED = 2.0;
const NFL_MARGIN_SD = 13.5;

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

/** Promote scheduled events whose start time has passed to LIVE. */
async function promoteEvents() {
  const db = getDb();
  const due = await db
    .select()
    .from(events)
    .where(and(eq(events.status, "scheduled"), lt(events.startTime, new Date())));
  for (const ev of due) {
    await db
      .update(events)
      .set({
        status: "live",
        startTime: new Date(),
        homeScore: 0,
        awayScore: 0,
        period: "Q1",
        clock: "15:00",
      })
      .where(eq(events.id, ev.id));
    await db.insert(alerts).values({
      type: "system",
      title: "Game went live",
      message: `Event #${ev.id} is now LIVE — switched to the live prediction model.`,
    });
    log("simulator", "info", `event ${ev.id} promoted to live`);
  }
}

/** Advance live games: clock, score, live model, live odds, pick recompute. */
async function advanceLiveGames() {
  const db = getDb();
  const live = await db.select().from(events).where(eq(events.status, "live"));
  for (const ev of live) {
    const elapsedMin = (Date.now() - ev.startTime.getTime()) / 60000;
    const gameMin = Math.min(60, elapsedMin * GAME_SPEED);
    const progress = gameMin / 60;

    // scoring: chance per tick scales with remaining time
    let home = ev.homeScore ?? 0;
    let away = ev.awayScore ?? 0;
    const r = Math.random();
    if (r < 0.16) home += Math.random() < 0.62 ? 7 : 3;
    else if (r < 0.32) away += Math.random() < 0.62 ? 7 : 3;

    const quarter = Math.min(4, Math.floor(gameMin / 15) + 1);
    const clockSec = Math.max(0, Math.round((15 - (gameMin % 15)) * 60));
    const clock = `${Math.floor(clockSec / 60)}:${String(clockSec % 60).padStart(2, "0")}`;
    const finished = gameMin >= 60;

    await db
      .update(events)
      .set({
        homeScore: home,
        awayScore: away,
        period: finished ? "FT" : `Q${quarter}`,
        clock: finished ? "0:00" : clock,
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

    const margin = home - away;
    const scored = home + away;
    // live final-margin projection: current margin + remaining pregame edge
    const liveSpread = margin + preSpread * (1 - progress) * 0.85;
    // live total projection: points scored + expected remaining scoring
    const liveTotal = scored + preTotal * (1 - progress) * 0.9;
    const sdRemain = Math.max(2.5, NFL_MARGIN_SD * Math.sqrt(1 - progress));
    const homeWinProb = normCdf(liveSpread / sdRemain);

    await db.insert(predictions).values({
      eventId: ev.id,
      modelVersion: "nfl-ensemble-v1.3-live",
      projHomeScore: String(Math.max(home, (home + liveSpread / 2)).toFixed(1)),
      projAwayScore: String(Math.max(away, (away - liveSpread / 2)).toFixed(1)),
      projSpread: liveSpread.toFixed(1),
      projTotal: liveTotal.toFixed(1),
      homeWinProb: homeWinProb.toFixed(4),
      confidence: (0.62 + 0.2 * progress).toFixed(3),
      isLive: true,
    });

    if (finished) {
      await db.insert(alerts).values({
        type: "system",
        title: "Game final",
        message: `Event #${ev.id} finished ${away}–${home}. Grading queued.`,
      });
      continue;
    }

    // live market prices (with book noise → live +EV windows)
    const books = await db
      .select()
      .from(sportsbooks)
      .where(eq(sportsbooks.active, true));
    const marketSpread = roundHalf(-liveSpread + jitter(ev.id, Math.floor(gameMin)) * 1.5);
    const marketTotal = roundHalf(liveTotal + jitter(ev.id, Math.floor(gameMin) + 7) * 2);
    const homeMlLive =
      homeWinProb > 0.5
        ? Math.round((-100 * homeWinProb) / (1 - homeWinProb) / 5) * 5
        : Math.round((100 * (1 - homeWinProb)) / homeWinProb / 5) * 5;
    const now = new Date();
    for (const b of books) {
      const j = jitter(b.id, Math.floor(gameMin * 2));
      await db.insert(oddsSnapshots).values([
        {
          eventId: ev.id,
          sportsbookId: b.id,
          market: "spread",
          selection: "home",
          line: String(marketSpread),
          odds: -110 + Math.round(j * 8),
          isLive: true,
          capturedAt: now,
        },
        {
          eventId: ev.id,
          sportsbookId: b.id,
          market: "spread",
          selection: "away",
          line: String(-marketSpread),
          odds: -110 - Math.round(j * 8),
          isLive: true,
          capturedAt: now,
        },
        {
          eventId: ev.id,
          sportsbookId: b.id,
          market: "total",
          selection: "over",
          line: String(marketTotal),
          odds: -110 + Math.round(j * 6),
          isLive: true,
          capturedAt: now,
        },
        {
          eventId: ev.id,
          sportsbookId: b.id,
          market: "total",
          selection: "under",
          line: String(marketTotal),
          odds: -110 - Math.round(j * 6),
          isLive: true,
          capturedAt: now,
        },
        {
          eventId: ev.id,
          sportsbookId: b.id,
          market: "moneyline",
          selection: "home",
          line: null,
          odds: homeMlLive + Math.round(j * 10),
          isLive: true,
          capturedAt: now,
        },
        {
          eventId: ev.id,
          sportsbookId: b.id,
          market: "moneyline",
          selection: "away",
          line: null,
          odds:
            homeMlLive < 0
              ? Math.round((-homeMlLive * 0.85) / 5) * 5 - Math.round(j * 8)
              : -Math.round((homeMlLive * 1.15) / 5) * 5 - Math.round(j * 8),
          isLive: true,
          capturedAt: now,
        },
      ]);
    }
    await recomputeEventPicks(ev.id);
  }
}

/** Pregame market movement: nudge one event's market and recompute. */
async function movePregameMarket() {
  const db = getDb();
  const scheduled = await db
    .select()
    .from(events)
    .where(eq(events.status, "scheduled"));
  if (scheduled.length === 0) return;
  const ev = scheduled[Math.floor(Math.random() * scheduled.length)];

  const books = await db
    .select()
    .from(sportsbooks)
    .where(eq(sportsbooks.active, true));
  const markets = ["spread", "total", "moneyline"] as const;
  const market = markets[Math.floor(Math.random() * markets.length)];

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
        const fair =
          hwp >= 0.5
            ? Math.round((-100 * hwp) / (1 - hwp) / 5) * 5
            : Math.round((100 * (1 - hwp)) / hwp / 5) * 5;
        const gap = prevHome.odds - fair; // vig pushes favorites more negative
        if (prevHome.odds < 0 && gap < -45) mlStep = 10;
        else if (prevHome.odds < 0 && gap > 25) mlStep = -10;
        else if (prevHome.odds > 0 && gap > 45) mlStep = -10;
        else if (prevHome.odds > 0 && gap < 10) mlStep = 10;
      }
      await db.insert(oddsSnapshots).values([
        { eventId: ev.id, sportsbookId: b.id, market, selection: "home", line: null, odds: prevHome.odds + mlStep + Math.round(j * 5), isLive: false, capturedAt: now },
        { eventId: ev.id, sportsbookId: b.id, market, selection: "away", line: null, odds: prevAway.odds - mlStep - Math.round(j * 5), isLive: false, capturedAt: now },
      ]);
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
  log("simulator", "info", "market simulator started (DEMO DATA mode)");
}

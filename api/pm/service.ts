/**
 * Prediction-market sync orchestrator (read-only intelligence feed).
 *
 * Pulls PUBLIC sports markets from Kalshi and Polymarket, normalizes prices
 * to 0..1 implied probabilities, matches events to the sportsbook feed, and
 * appends price snapshots for the trend charts.
 *
 * Guarantees:
 *  - free public endpoints only; no credentials exist to leak
 *  - sequential, spaced requests (rate-limit polite); per-venue failure
 *    isolation — one venue down never blocks the other
 *  - every call outcome is logged to api_logs; failures are surfaced, never
 *    papered over with fabricated prices
 *  - snapshots are append-only and deduped on meaningful change
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { apiLogs, pmEvents, pmMarkets, pmPriceSnapshots } from "../../db/schema";
import { KALSHI_SERIES_MAP, kalshiActiveSeries, kalshiSeriesEvents, type KalshiEventNorm } from "./kalshi";
import { POLY_SPORT_MAP, polyActiveSports, polyPriceHistory, polySeriesEvents, type PolyEventNorm } from "./polymarket";
import { matchPmEvent, resolveTeam, type TeamRef } from "./match";
import { sports, teams } from "../../db/schema";

const POLITE_DELAY_MS = 150;
const SNAP_MIN_DELTA = 0.005; // 0.5pp move
const SNAP_MIN_AGE_MS = 30 * 60_000;
const HISTORY_BACKFILL_PER_RUN = 5;

function log(service: string, level: "info" | "warn" | "error", message: string) {
  getDb()
    .insert(apiLogs)
    .values({ service, level, message: message.slice(0, 500) })
    .catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function teamPool(sportCode: string): Promise<TeamRef[]> {
  const db = getDb();
  const [sport] = await db.select().from(sports).where(eq(sports.code, sportCode)).limit(1);
  if (!sport) return [];
  return db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.sportId, sport.id));
}

async function ensurePmEvent(input: {
  venue: "KALSHI" | "POLYMARKET";
  sportCode: string;
  venueEventId: string;
  title: string;
  startTime: Date | null;
  url: string | null;
}): Promise<number> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(pmEvents)
    .where(and(eq(pmEvents.venue, input.venue), eq(pmEvents.venueEventId, input.venueEventId)))
    .limit(1);
  if (existing) {
    await db
      .update(pmEvents)
      .set({ title: input.title, startTime: input.startTime ?? existing.startTime, url: input.url ?? existing.url, updatedAt: new Date() })
      .where(eq(pmEvents.id, existing.id));
    return existing.id;
  }
  const ins = await db.insert(pmEvents).values({
    venue: input.venue,
    sportCode: input.sportCode,
    venueEventId: input.venueEventId,
    title: input.title.slice(0, 250),
    startTime: input.startTime,
    url: input.url,
  });
  return Number(ins[0].insertId);
}

async function upsertPmMarket(input: {
  pmEventId: number;
  venueMarketId: string;
  market: "moneyline" | "spread" | "total";
  selection: string;
  line: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  lastPrice: number | null;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  tokenId: string | null;
}): Promise<{ id: number; changed: boolean } | null> {
  if (input.mid === null && input.lastPrice === null && input.bid === null) return null;
  const db = getDb();
  const [existing] = await db
    .select()
    .from(pmMarkets)
    .where(
      and(
        eq(pmMarkets.pmEventId, input.pmEventId),
        eq(pmMarkets.market, input.market),
        eq(pmMarkets.selection, input.selection),
      ),
    )
    .limit(1);

  const mid = input.mid ?? input.lastPrice ?? (input.bid !== null && input.ask !== null ? (input.bid + input.ask) / 2 : null);

  let id: number;
  let changed = true;
  if (existing) {
    id = existing.id;
    const prevMid = existing.mid === null ? null : parseFloat(existing.mid);
    changed = mid !== null && (prevMid === null || Math.abs(mid - prevMid) >= SNAP_MIN_DELTA);
    await db
      .update(pmMarkets)
      .set({
        venueMarketId: input.venueMarketId,
        line: input.line === null ? null : String(input.line),
        bid: input.bid === null ? null : String(input.bid),
        ask: input.ask === null ? null : String(input.ask),
        mid: mid === null ? null : String(mid),
        lastPrice: input.lastPrice === null ? null : String(input.lastPrice),
        volume: input.volume === null ? null : String(input.volume),
        volume24h: input.volume24h === null ? null : String(input.volume24h),
        liquidity: input.liquidity === null ? null : String(input.liquidity),
        tokenId: input.tokenId ?? existing.tokenId,
        updatedAt: new Date(),
      })
      .where(eq(pmMarkets.id, id));
  } else {
    const ins = await db.insert(pmMarkets).values({
      pmEventId: input.pmEventId,
      venueMarketId: input.venueMarketId,
      market: input.market,
      selection: input.selection,
      line: input.line === null ? null : String(input.line),
      bid: input.bid === null ? null : String(input.bid),
      ask: input.ask === null ? null : String(input.ask),
      mid: mid === null ? null : String(mid),
      lastPrice: input.lastPrice === null ? null : String(input.lastPrice),
      volume: input.volume === null ? null : String(input.volume),
      volume24h: input.volume24h === null ? null : String(input.volume24h),
      liquidity: input.liquidity === null ? null : String(input.liquidity),
      tokenId: input.tokenId,
    });
    id = Number(ins[0].insertId);
  }

  // append-only snapshot on meaningful change (or first sight)
  if (mid !== null) {
    const [lastSnap] = await db
      .select()
      .from(pmPriceSnapshots)
      .where(eq(pmPriceSnapshots.pmMarketId, id))
      .orderBy(desc(pmPriceSnapshots.capturedAt))
      .limit(1);
    const age = lastSnap ? Date.now() - lastSnap.capturedAt.getTime() : Infinity;
    const prevMid = lastSnap ? parseFloat(lastSnap.mid) : null;
    if (!lastSnap || (changed && age >= 60_000) || age >= SNAP_MIN_AGE_MS) {
      if (prevMid === null || Math.abs(mid - prevMid) >= SNAP_MIN_DELTA || age >= SNAP_MIN_AGE_MS) {
        await db.insert(pmPriceSnapshots).values({
          pmMarketId: id,
          mid: String(mid),
          bid: input.bid === null ? null : String(input.bid),
          ask: input.ask === null ? null : String(input.ask),
          volume: input.volume === null ? null : String(input.volume),
        });
      }
    }
  }
  return { id, changed };
}

/* ------------------------------- Kalshi ------------------------------- */

async function syncKalshi(): Promise<{ events: number; markets: number; matched: number; errors: string[] }> {
  const out = { events: 0, markets: 0, matched: 0, errors: [] as string[] };
  const db = getDb();

  let active: Awaited<ReturnType<typeof kalshiActiveSeries>>;
  try {
    active = await kalshiActiveSeries();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(msg);
    log("kalshi", "error", `series discovery failed: ${msg}`);
    return out;
  }
  if (active.series.length === 0) {
    log("kalshi", "warn", "no mapped sports series found in discovery");
    return out;
  }

  const pools = new Map<string, TeamRef[]>();
  for (const s of active.series) {
    const sportCode = KALSHI_SERIES_MAP[s.ticker];
    if (!sportCode) continue;
    if (!pools.has(sportCode)) pools.set(sportCode, await teamPool(sportCode));

    let evs: KalshiEventNorm[];
    try {
      await sleep(POLITE_DELAY_MS);
      evs = (await kalshiSeriesEvents(s.ticker)).events;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(`${s.ticker}: ${msg}`);
      log("kalshi", "error", `events fetch failed for ${s.ticker}: ${msg}`);
      continue;
    }

    for (const ev of evs) {
      if (ev.markets.length === 0) continue;
      const m = ev.markets[0]; // game-winner series carry one market per game
      const close = m.closeTime;
      // skip markets already closed by venue clock
      if (close && close.getTime() < Date.now()) continue;

      const pmEventId = await ensurePmEvent({
        venue: "KALSHI",
        sportCode,
        venueEventId: ev.venueEventId,
        title: ev.title,
        startTime: close,
        url: `https://kalshi.com/markets/${s.ticker.toLowerCase()}/${ev.venueEventId.toLowerCase()}`,
      });
      out.events++;

      const pool = pools.get(sportCode) ?? [];
      const yesTeam = resolveTeam(m.yesTeam, pool);
      const noTeam = resolveTeam(m.noTeam, pool);

      // match to the sportsbook feed (only when both sides resolve)
      let homeIsYes: boolean | null = null;
      const [pmEv] = await db.select().from(pmEvents).where(eq(pmEvents.id, pmEventId)).limit(1);
      if (pmEv && !pmEv.eventId && m.yesTeam && m.noTeam) {
        const match = await matchPmEvent({ sportCode, teamA: m.yesTeam, teamB: m.noTeam, startTime: close }).catch(() => null);
        if (match) {
          await db.update(pmEvents).set({ eventId: match.eventId, homeTeam: match.homeTeam, awayTeam: match.awayTeam }).where(eq(pmEvents.id, pmEventId));
          pmEv.eventId = match.eventId;
          pmEv.homeTeam = match.homeTeam;
          pmEv.awayTeam = match.awayTeam;
          out.matched++;
        }
      }
      if (pmEv?.homeTeam && yesTeam && noTeam) {
        homeIsYes = yesTeam.name === pmEv.homeTeam ? true : noTeam.name === pmEv.homeTeam ? false : null;
      }

      // write normalized sides (YES dual: NO bid = 1 − YES ask)
      const mid = m.yesBid !== null && m.yesAsk !== null ? (m.yesBid + m.yesAsk) / 2 : m.lastPrice;
      const sides: Array<{ selection: "home" | "away"; bid: number | null; ask: number | null; mid: number | null }> = [];
      if (homeIsYes === true) {
        sides.push({ selection: "home", bid: m.yesBid, ask: m.yesAsk, mid });
        sides.push({ selection: "away", bid: m.yesAsk !== null ? 1 - m.yesAsk : null, ask: m.yesBid !== null ? 1 - m.yesBid : null, mid: mid !== null ? 1 - mid : null });
      } else if (homeIsYes === false) {
        sides.push({ selection: "home", bid: m.yesAsk !== null ? 1 - m.yesAsk : null, ask: m.yesBid !== null ? 1 - m.yesBid : null, mid: mid !== null ? 1 - mid : null });
        sides.push({ selection: "away", bid: m.yesBid, ask: m.yesAsk, mid });
      } else {
        // unmatched: store under the raw YES/NO orientation as home/away
        // placeholders ONLY when team names are known but event unmatched —
        // orientation unknown, so keep a single neutral row per side label
        sides.push({ selection: "home", bid: m.yesBid, ask: m.yesAsk, mid });
      }
      for (const side of sides) {
        const r = await upsertPmMarket({
          pmEventId,
          venueMarketId: m.venueMarketId,
          market: "moneyline",
          selection: side.selection,
          line: null,
          bid: side.bid,
          ask: side.ask,
          mid: side.mid,
          lastPrice: side.selection === "home" ? m.lastPrice : m.lastPrice !== null ? 1 - m.lastPrice : null,
          volume: m.volume,
          volume24h: m.volume24h,
          liquidity: m.liquidity,
          tokenId: null,
        });
        if (r) out.markets++;
      }
    }
  }
  log("kalshi", "info", `sync: ${out.events} events, ${out.markets} market sides, ${out.matched} matched` + (out.errors.length ? `, errors: ${out.errors.join("; ").slice(0, 200)}` : ""));
  return out;
}

/* ----------------------------- Polymarket ----------------------------- */

async function syncPolymarket(): Promise<{ events: number; markets: number; matched: number; errors: string[] }> {
  const out = { events: 0, markets: 0, matched: 0, errors: [] as string[] };
  const db = getDb();

  let active: Awaited<ReturnType<typeof polyActiveSports>>;
  try {
    active = await polyActiveSports();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(msg);
    log("polymarket", "error", `sports discovery failed: ${msg}`);
    return out;
  }
  if (active.sports.length === 0) {
    log("polymarket", "warn", "no mapped sports found in gamma /sports");
    return out;
  }

  const pools = new Map<string, TeamRef[]>();
  for (const s of active.sports) {
    const sportCode = POLY_SPORT_MAP[s.slug];
    if (!sportCode) continue;
    if (!pools.has(sportCode)) pools.set(sportCode, await teamPool(sportCode));

    let evs: PolyEventNorm[];
    try {
      await sleep(POLITE_DELAY_MS);
      evs = (await polySeriesEvents(s.seriesId)).events;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(`${s.slug}: ${msg}`);
      log("polymarket", "error", `events fetch failed for ${s.slug} (series ${s.seriesId}): ${msg}`);
      continue;
    }

    for (const ev of evs) {
      const start = ev.startTime ?? ev.markets.find((m) => m.gameStartTime)?.gameStartTime ?? null;
      const pmEventId = await ensurePmEvent({
        venue: "POLYMARKET",
        sportCode,
        venueEventId: ev.venueEventId,
        title: ev.title,
        startTime: start,
        url: `https://polymarket.com/event/${ev.venueEventId}`,
      });
      out.events++;

      const pool = pools.get(sportCode) ?? [];
      const ml = ev.markets.find((m) => m.sportsMarketType === "moneyline");
      const teamA = ml?.outcomes[0] ?? null;
      const teamB = ml?.outcomes[1] ?? null;

      const [pmEv] = await db.select().from(pmEvents).where(eq(pmEvents.id, pmEventId)).limit(1);
      if (pmEv && !pmEv.eventId && teamA && teamB) {
        const match = await matchPmEvent({ sportCode, teamA, teamB, startTime: start }).catch(() => null);
        if (match) {
          await db.update(pmEvents).set({ eventId: match.eventId, homeTeam: match.homeTeam, awayTeam: match.awayTeam }).where(eq(pmEvents.id, pmEventId));
          pmEv.eventId = match.eventId;
          pmEv.homeTeam = match.homeTeam;
          pmEv.awayTeam = match.awayTeam;
          out.matched++;
        }
      }

      for (const m of ev.markets) {
        if (m.sportsMarketType === "moneyline") {
          for (let i = 0; i < m.outcomes.length; i++) {
            const name = m.outcomes[i];
            const price = m.outcomePrices[i] ?? null;
            let selection: string;
            if (/^draw$/i.test(name)) {
              selection = "draw";
            } else {
              const team = resolveTeam(name, pool);
              if (pmEv?.homeTeam && team) {
                selection = team.name === pmEv.homeTeam ? "home" : team.name === pmEv.awayTeam ? "away" : "home";
              } else {
                selection = i === 0 ? "home" : "away"; // orientation refined on match
              }
            }
            // Gamma best bid/ask describe the first outcome token
            const isFirst = i === 0;
            const bid = isFirst ? m.bestBid : m.bestAsk !== null ? 1 - m.bestAsk : null;
            const ask = isFirst ? m.bestAsk : m.bestBid !== null ? 1 - m.bestBid : null;
            const r = await upsertPmMarket({
              pmEventId,
              venueMarketId: m.venueMarketId,
              market: "moneyline",
              selection,
              line: null,
              bid,
              ask,
              mid: price,
              lastPrice: isFirst ? m.lastTradePrice : m.lastTradePrice !== null ? 1 - m.lastTradePrice : null,
              volume: m.volume,
              volume24h: m.volume24h,
              liquidity: m.liquidity,
              tokenId: m.clobTokenIds[i] ?? null,
            });
            if (r) out.markets++;
          }
        } else if (m.sportsMarketType === "totals") {
          for (let i = 0; i < m.outcomes.length; i++) {
            const sel = /^over/i.test(m.outcomes[i]) ? "over" : /^under/i.test(m.outcomes[i]) ? "under" : null;
            if (!sel) continue;
            const price = m.outcomePrices[i] ?? null;
            const isFirst = i === 0;
            const r = await upsertPmMarket({
              pmEventId,
              venueMarketId: m.venueMarketId,
              market: "total",
              selection: sel,
              line: m.line,
              bid: isFirst ? m.bestBid : m.bestAsk !== null ? 1 - m.bestAsk : null,
              ask: isFirst ? m.bestAsk : m.bestBid !== null ? 1 - m.bestBid : null,
              mid: price,
              lastPrice: isFirst ? m.lastTradePrice : m.lastTradePrice !== null ? 1 - m.lastTradePrice : null,
              volume: m.volume,
              volume24h: m.volume24h,
              liquidity: m.liquidity,
              tokenId: m.clobTokenIds[i] ?? null,
            });
            if (r) out.markets++;
          }
        }
      }
    }
  }
  log("polymarket", "info", `sync: ${out.events} events, ${out.markets} market sides, ${out.matched} matched` + (out.errors.length ? `, errors: ${out.errors.join("; ").slice(0, 200)}` : ""));
  return out;
}

/* ------------------------- history backfill + GC ------------------------- */

/** Seed trend charts for fresh Polymarket markets from public CLOB history.
 *  A market qualifies while it has at most one snapshot (the one written at
 *  first sight) — after backfill its count is high, so it never re-seeds. */
async function backfillPolyHistory(): Promise<number> {
  const db = getDb();
  const fresh = await db
    .select({ id: pmMarkets.id, tokenId: pmMarkets.tokenId })
    .from(pmMarkets)
    .where(
      and(
        eq(pmMarkets.market, "moneyline"),
        sql`${pmMarkets.tokenId} IS NOT NULL`,
        sql`(SELECT COUNT(*) FROM pm_price_snapshots s WHERE s.pmMarketId = ${pmMarkets.id}) <= 1`,
      ),
    )
    .limit(HISTORY_BACKFILL_PER_RUN);
  let seeded = 0;
  for (const m of fresh) {
    if (!m.tokenId) continue;
    try {
      await sleep(POLITE_DELAY_MS);
      const { points } = await polyPriceHistory(m.tokenId, "1w", 60);
      if (points.length === 0) continue;
      await db.insert(pmPriceSnapshots).values(
        points.map((p) => ({ pmMarketId: m.id, mid: String(p.p), capturedAt: new Date(p.t * 1000) })),
      );
      seeded++;
    } catch (e) {
      log("polymarket", "warn", `price-history backfill failed for token ${m.tokenId.slice(0, 12)}…: ${e instanceof Error ? e.message : e}`);
    }
  }
  return seeded;
}

/** Mark events closed once their start time is well past. */
async function closeStale(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 6 * 3600_000);
  const stale = await db
    .select({ id: pmEvents.id })
    .from(pmEvents)
    .where(and(eq(pmEvents.status, "open"), lt(pmEvents.startTime, cutoff)))
    .limit(200);
  for (const s of stale) {
    await db.update(pmEvents).set({ status: "closed" }).where(eq(pmEvents.id, s.id));
  }
  return stale.length;
}

export interface PmSyncResult {
  kalshi: { events: number; markets: number; matched: number; errors: string[] };
  polymarket: { events: number; markets: number; matched: number; errors: string[] };
  historySeeded: number;
  closed: number;
}

export async function syncPredictionMarkets(): Promise<PmSyncResult> {
  const kalshi = await syncKalshi();
  const polymarket = await syncPolymarket();
  const historySeeded = await backfillPolyHistory();
  const closed = await closeStale();
  return { kalshi, polymarket, historySeeded, closed };
}

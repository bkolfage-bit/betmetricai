/**
 * Phase 1 — Market-intelligence feature extractor.
 *
 * For each matched event+market+selection, compute the full Phase-1 feature
 * set from the raw prediction-market tables (pmEvents / pmMarkets /
 * pmPriceSnapshots) plus the sportsbook consensus for disagreement:
 *
 *   1. market-implied probability (per venue + combined)
 *   2. historical probability movement (deltas over multiple intervals)
 *   3. trading volume + 24h volume change
 *   4. unusual trading activity / volume spikes (vs its own baseline)
 *   5. bid/ask spread (absolute + relative)
 *   6. order-book imbalance (bid vs ask depth where the venue exposes it)
 *   7. market depth / liquidity
 *   8. cross-platform price disagreement (Kalshi vs Polymarket)
 *   9. sportsbook vs prediction-market disagreement
 *  10. time until game start
 *  11. data freshness & reliability
 *
 * Behavior classification (spec §Phase 1):
 *   agreement / disagreement / moving_toward_ai / unusual_activity / uncertain
 *
 * Hard rules:
 *  - pure math over stored rows; the AI layer never touches these numbers;
 *  - volume is NEVER interpreted as "% of bettors on a side" (spec §39);
 *  - every snapshot requires real rows — no fabricated prices, no invented
 *    order-book depth (depth/imbalance are null unless the venue provides it);
 *  - output is appended to pm_intel_snapshots, never overwritten.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  events, pmEvents, pmIntelSnapshots, pmMarkets, pmPriceSnapshots,
} from "@db/schema";
import { consensusFairProb } from "./market-anchor";

export type PmBehavior =
  | "agreement"
  | "disagreement"
  | "moving_toward_ai"
  | "unusual_activity"
  | "uncertain";

export interface IntelFeatures {
  // identity / timing
  sportCode: string;
  eventId: number;
  market: string;
  selection: string;
  hoursToStart: number | null;

  // 1. market-implied probabilities
  kalshiProb: number | null;
  polymarketProb: number | null;
  combinedProb: number | null; // volume-weighted across venues

  // 2. probability movement (probability-point deltas vs N minutes ago)
  move60m: number | null;
  move360m: number | null;
  move24h: number | null;

  // 3. volume
  volumeTotal: number | null;
  volume24h: number | null;
  volume24hDelta: number | null; // change in 24h-volume vs prior snapshot

  // 4. unusual activity
  volumeSpike: boolean; // 24h volume > spikeMult × its recent baseline
  priceSpike: boolean; // |move360m| above threshold with volume behind it

  // 5. bid/ask spread (relative to mid; wide = uncertain)
  spreadAbs: number | null;
  spreadRel: number | null;

  // 6. order-book imbalance (bid depth vs ask depth) — null unless provided
  bookImbalance: number | null; // -1..+1; + = bid-heavy

  // 7. depth / liquidity
  liquidity: number | null; // venue-reported liquidity
  depthScore: number; // 0..1 composite of liquidity + spread tightness

  // 8. cross-platform disagreement (|kalshi - polymarket|)
  crossVenueDivergence: number | null;

  // 9. sportsbook vs PM disagreement (combined PM prob − book no-vig)
  bookDivergence: number | null;

  // 11. freshness & reliability
  freshnessSec: number | null; // age of newest underlying price row
  dataQuality: number; // 0..1 composite reliability score

  // behavior classification
  behaviors: PmBehavior[];
}

const SPIKE_MULT = 3.0; // 24h volume > 3× baseline = spike
const PRICE_SPIKE_PP = 0.05; // 5pp move in 6h with volume = price spike
const WIDE_SPREAD_REL = 0.08; // relative spread > 8% = thin/uncertain
const DIVERGENCE_PP = 0.04; // 4pp = meaningful disagreement
const STALE_SEC = 15 * 60; // price older than 15 min = stale

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}

interface VenueSide {
  venue: "KALSHI" | "POLYMARKET";
  mid: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  pmMarketId: number;
  updatedAt: Date;
}

/**
 * Compute the full feature set for one event+market+selection.
 * Returns null when there is no matched, priced PM market at all.
 */
export async function extractIntelFeatures(
  eventId: number,
  market: "moneyline" | "spread" | "total",
  selection: string,
  sportCode: string,
): Promise<IntelFeatures | null> {
  const db = getDb();

  // matched, open PM events for this sportsbook event
  const evs = await db
    .select()
    .from(pmEvents)
    .where(and(eq(pmEvents.eventId, eventId), eq(pmEvents.status, "open")));
  if (evs.length === 0) return null;
  const evById = new Map(evs.map((e) => [e.id, e] as const));
  const evIds = evs.map((e) => e.id);

  // the underlying PM market rows for this selection
  const mrows = await db
    .select()
    .from(pmMarkets)
    .where(
      and(
        inArray(pmMarkets.pmEventId, evIds),
        eq(pmMarkets.market, market),
        eq(pmMarkets.selection, selection),
      ),
    );
  if (mrows.length === 0) return null;

  const now = Date.now();
  const sides: VenueSide[] = mrows.map((m) => {
    const pe = evById.get(m.pmEventId)!;
    return {
      venue: pe.venue,
      mid: num(m.mid),
      bid: num(m.bid),
      ask: num(m.ask),
      volume: num(m.volume),
      volume24h: num(m.volume24h),
      liquidity: num(m.liquidity),
      pmMarketId: m.id,
      updatedAt: m.updatedAt,
    };
  });

  const kalshi = sides.find((s) => s.venue === "KALSHI" && s.mid !== null) ?? null;
  const poly = sides.find((s) => s.venue === "POLYMARKET" && s.mid !== null) ?? null;

  // 1. combined prob: volume-weighted across venues (fall back to plain mean)
  let combinedProb: number | null = null;
  {
    const priced = sides.filter((s) => s.mid !== null);
    const wsum = priced.reduce((s, x) => s + Math.max(0, x.volume24h ?? 0), 0);
    if (priced.length > 0) {
      combinedProb =
        wsum > 0
          ? priced.reduce((s, x) => s + (x.mid! * Math.max(0, x.volume24h ?? 0)), 0) / wsum
          : priced.reduce((s, x) => s + x.mid!, 0) / priced.length;
    }
  }

  // 2/3/4. movement + volume change from append-only price history
  async function moveSince(ms: number): Promise<number | null> {
    if (combinedProb === null) return null;
    const cutoff = new Date(now - ms);
    const ids = sides.map((s) => s.pmMarketId);
    const rows = await db
      .select({ mid: pmPriceSnapshots.mid, capturedAt: pmPriceSnapshots.capturedAt })
      .from(pmPriceSnapshots)
      .where(
        and(
          inArray(pmPriceSnapshots.pmMarketId, ids),
          sql`${pmPriceSnapshots.capturedAt} <= ${cutoff}`,
        ),
      )
      .orderBy(desc(pmPriceSnapshots.capturedAt))
      .limit(1);
    if (rows.length === 0) return null;
    const past = num(rows[0].mid);
    return past === null ? null : combinedProb - past;
  }
  const move60m = await moveSince(60 * 60_000);
  const move360m = await moveSince(360 * 60_000);
  const move24h = await moveSince(24 * 3600_000);

  const volumeTotal = sides.reduce((s, x) => s + (x.volume ?? 0), 0);
  const volume24h = sides.reduce((s, x) => s + (x.volume24h ?? 0), 0);

  // volume baseline: mean of prior snapshots' volume for these markets
  let volume24hDelta: number | null = null;
  let volumeSpike = false;
  {
    const ids = sides.map((s) => s.pmMarketId);
    const hist = await db
      .select({ volume: pmPriceSnapshots.volume })
      .from(pmPriceSnapshots)
      .where(inArray(pmPriceSnapshots.pmMarketId, ids))
      .orderBy(desc(pmPriceSnapshots.capturedAt))
      .limit(50);
    const vols = hist.map((h) => num(h.volume)).filter((v): v is number => v !== null);
    if (vols.length >= 3) {
      const baseline = vols.reduce((s, v) => s + v, 0) / vols.length;
      const latest = vols[0];
      volume24hDelta = latest - baseline;
      if (baseline > 0 && latest > baseline * SPIKE_MULT) volumeSpike = true;
    }
  }

  // 5. spread (use the tightest available across venues)
  let spreadAbs: number | null = null;
  for (const s of sides) {
    if (s.bid !== null && s.ask !== null) {
      const sp = s.ask - s.bid;
      if (spreadAbs === null || sp < spreadAbs) spreadAbs = sp;
    }
  }
  const spreadRel =
    spreadAbs !== null && combinedProb
      ? spreadAbs / Math.max(0.01, Math.min(combinedProb, 1 - combinedProb))
      : null;

  // 6. order-book imbalance — only if a venue exposes bid/ask DEPTH.
  //    Kalshi/Poly public price rows carry bid/ask price, not depth, so this
  //    is null unless a depth field is actually present. Never fabricated.
  const bookImbalance: number | null = null;

  // 7. liquidity + depth score
  const liquidity = sides.reduce((s, x) => s + (x.liquidity ?? 0), 0) || null;
  const liqScore = liquidity === null ? 0 : Math.min(1, liquidity / 50_000);
  const spreadScore =
    spreadRel === null ? 0.3 : Math.max(0, 1 - spreadRel / WIDE_SPREAD_REL);
  const depthScore = Math.round(((liqScore * 0.6) + (spreadScore * 0.4)) * 1000) / 1000;

  // 8. cross-platform divergence
  const crossVenueDivergence =
    kalshi && poly && kalshi.mid !== null && poly.mid !== null
      ? Math.abs(kalshi.mid - poly.mid)
      : null;

  // 9. sportsbook vs PM disagreement (book no-vig consensus for this selection)
  let bookDivergence: number | null = null;
  try {
    const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
    const threeWay = market === "moneyline" && sportCode === "SOCCER";
    const cons = await consensusFairProb(eventId, market, selection, threeWay);
    if (cons && combinedProb !== null) bookDivergence = combinedProb - cons.prob;
  } catch {
    bookDivergence = null;
  }

  // 10. hours to start
  let hoursToStart: number | null = null;
  {
    const startTimes = evs.map((e) => e.startTime).filter((d): d is Date => d !== null);
    if (startTimes.length > 0) {
      const soonest = Math.min(...startTimes.map((d) => d.getTime()));
      hoursToStart = Math.round(((soonest - now) / 3600_000) * 100) / 100;
    }
  }

  // 11. freshness + reliability
  const newest = Math.max(...sides.map((s) => s.updatedAt.getTime()));
  const freshnessSec = Math.round((now - newest) / 1000);
  const freshScore = Math.max(0, 1 - freshnessSec / STALE_SEC);
  const venuesPresent = (kalshi ? 1 : 0) + (poly ? 1 : 0);
  const venueScore = venuesPresent / 2;
  const dataQuality =
    Math.round((freshScore * 0.45 + depthScore * 0.35 + venueScore * 0.2) * 1000) / 1000;

  // ---- behavior classification ----
  const behaviors: PmBehavior[] = [];
  const absBookDiv = bookDivergence === null ? null : Math.abs(bookDivergence);
  if (absBookDiv !== null && absBookDiv <= DIVERGENCE_PP) behaviors.push("agreement");
  if (absBookDiv !== null && absBookDiv >= DIVERGENCE_PP) behaviors.push("disagreement");
  if (move360m !== null && bookDivergence !== null) {
    // moving toward AI: the PM price moved in the direction of closing the
    // book-PM gap (movement opposes the current divergence sign)
    if (Math.sign(move360m) === -Math.sign(bookDivergence) && Math.abs(move360m) >= 0.01) {
      behaviors.push("moving_toward_ai");
    }
  }
  const priceSpike =
    move360m !== null && Math.abs(move360m) >= PRICE_SPIKE_PP && volume24h >= 1000;
  if (volumeSpike || priceSpike) behaviors.push("unusual_activity");
  const thinLiquidity = liquidity !== null && liquidity < 1000;
  const wideSpread = spreadRel !== null && spreadRel > WIDE_SPREAD_REL;
  const conflicting =
    crossVenueDivergence !== null && crossVenueDivergence >= DIVERGENCE_PP;
  const unstable = priceSpike && !volumeSpike;
  if (thinLiquidity || wideSpread || conflicting || unstable || dataQuality < 0.4) {
    behaviors.push("uncertain");
  }
  if (behaviors.length === 0) behaviors.push("agreement");

  return {
    sportCode, eventId, market, selection,
    hoursToStart,
    kalshiProb: kalshi?.mid ?? null,
    polymarketProb: poly?.mid ?? null,
    combinedProb,
    move60m, move360m, move24h,
    volumeTotal, volume24h, volume24hDelta,
    volumeSpike, priceSpike,
    spreadAbs, spreadRel,
    bookImbalance,
    liquidity, depthScore,
    crossVenueDivergence,
    bookDivergence,
    freshnessSec, dataQuality,
    behaviors,
  };
}

/**
 * Persist one intel snapshot (append-only). Duplicate (event, market,
 * selection, capturedAt) rows are ignored — never overwritten.
 */
export async function recordIntelSnapshot(f: IntelFeatures): Promise<void> {
  const db = getDb();
  try {
    await db.insert(pmIntelSnapshots).values({
      eventId: f.eventId,
      sportCode: f.sportCode,
      market: f.market,
      selection: f.selection,
      features: JSON.stringify(f),
    });
  } catch {
    /* duplicate snapshot at the same instant — append-only, skip */
  }
}

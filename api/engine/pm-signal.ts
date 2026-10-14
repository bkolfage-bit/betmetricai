/**
 * Prediction-market signal — Kalshi + Polymarket real-money prices as an
 * independent probability input to the pick engine.
 *
 * Why this is NOT just "another book": the sportsbook consensus we already
 * anchor to and the prediction-market price both embed the market's opinion,
 * but they are priced by different money — books by bettors against a vig,
 * prediction markets by traders against each other. When they AGREE, that's
 * confirmation worth more confidence. When they DISAGREE beyond the spread,
 * informed money is pricing the game differently than the books — a genuine
 * signal, not noise.
 *
 * Hard rules (same discipline as the rest of the platform):
 *  - the AI layer never touches these numbers — pure math over stored prices;
 *  - a PM market only counts if real money is behind it: MIN_LIQUIDITY on
 *    24h volume. An empty or stale contract carries no information and is
 *    ignored, never blended;
 *  - the two venues are combined volume-weighted, so a deep Kalshi market
 *    outweighs a thin Polymarket one on the same game;
 *  - PM influence is CAPPED (PM_MAX_WEIGHT of the final probability) so it
 *    can sharpen the estimate but can never hijack it — the sport's own
 *    model stays the primary driver;
 *  - when no matched, liquid PM market exists for a game, the signal is
 *    simply absent — we never fabricate a probability.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { pmEvents, pmMarkets } from "@db/schema";

/** Minimum 24h volume (in the venue's native units) for a PM market to
 *  carry any signal. Below this, a price is one trader's opinion. */
const MIN_LIQUIDITY = 500;

/** Maximum fraction of the blended probability the PM signal may claim.
 *  Even a deep market never gets more than this say over the sport model. */
const PM_MAX_WEIGHT = 0.30;

/** Reference volume at which the PM signal earns its full allowed weight.
 *  Scales linearly below this, so a $600 market barely moves the number. */
const FULL_WEIGHT_VOLUME = 20_000;

export interface PmSignal {
  /** volume-weighted combined PM probability of the selection (0..1) */
  prob: number;
  /** combined 24h volume across venues that contributed */
  volume: number;
  /** 0..1 — how much real money backs this price (drives the blend weight) */
  liquidityScore: number;
  /** signed divergence vs the sportsbook consensus, in probability points.
   *  Positive = PM prices the selection HIGHER than the books. */
  divergence: number | null;
  /** 0..1 agreement score for the confidence multiplier: 1 = PM and books
   *  agree tightly, 0 = they disagree sharply. */
  agreementScore: number;
}

/**
 * Combined Kalshi + Polymarket probability for one selection of a market on
 * an event. Returns null when no matched, liquid PM market prices it.
 */
export async function predictionMarketSignal(
  eventId: number,
  market: "moneyline" | "spread" | "total",
  selection: string,
  bookConsensusProb: number | null,
): Promise<PmSignal | null> {
  const db = getDb();
  // every matched PM event for this sportsbook event
  const evs = await db
    .select()
    .from(pmEvents)
    .where(and(eq(pmEvents.eventId, eventId), eq(pmEvents.status, "open")));
  if (evs.length === 0) return null;

  const evIds = evs.map((e) => e.id);
  const rows = await db
    .select()
    .from(pmMarkets)
    .where(and(eq(pmMarkets.market, market), eq(pmMarkets.selection, selection)));

  let wSum = 0;
  let pSum = 0;
  let volTotal = 0;
  for (const r of rows) {
    if (!evIds.includes(r.pmEventId)) continue;
    if (r.mid === null) continue;
    const mid = parseFloat(r.mid);
    const vol = r.volume24h !== null ? parseFloat(r.volume24h) : 0;
    if (vol < MIN_LIQUIDITY) continue; // no real money — no signal
    if (!(mid > 0.001 && mid < 0.999)) continue;
    wSum += vol;
    pSum += vol * mid;
    volTotal += vol;
  }
  if (wSum === 0) return null;

  const prob = pSum / wSum;
  const liquidityScore = Math.min(1, volTotal / FULL_WEIGHT_VOLUME);

  const divergence =
    bookConsensusProb !== null ? prob - bookConsensusProb : null;
  // agreement: tight when within ~2pp, collapsing to 0 by ~12pp of divergence
  const agreementScore =
    divergence === null
      ? 0.5 // unknown — neutral, neither confirming nor contradicting
      : Math.max(0, Math.min(1, 1 - Math.abs(divergence) / 0.12));

  return { prob, volume: volTotal, liquidityScore, divergence, agreementScore };
}

/**
 * Blend the PM signal into a working probability. The PM share is
 * liquidity-scaled and hard-capped at PM_MAX_WEIGHT, so it sharpens the
 * estimate proportionally to the money behind it without ever overwhelming
 * the sport model. `base` is the model+market-anchored probability.
 */
export function blendPmIntoProbability(
  base: number,
  signal: PmSignal | null,
  /** governance cap from the forward-tested fusion learner (V2 §98) —
   *  PM influence may never exceed the weight Model C has PROVEN. */
  maxWeight: number = PM_MAX_WEIGHT,
): number {
  if (!signal || maxWeight <= 0) return base;
  const wPm = Math.min(PM_MAX_WEIGHT, maxWeight) * signal.liquidityScore;
  const p = (1 - wPm) * base + wPm * signal.prob;
  return Math.min(0.999, Math.max(0.001, p));
}

/**
 * PM-driven confidence adjustment. Agreement between PM money and the books
 * lifts confidence; sharp divergence lowers it. Returns a multiplier in
 * [0.85, 1.10] — a nudge, never an override.
 */
export function pmConfidenceFactor(signal: PmSignal | null): number {
  if (!signal) return 1;
  // center 0.5 agreement -> 1.0; full agreement -> 1.10; full divergence -> 0.85
  return 0.85 + 0.25 * signal.agreementScore * Math.min(1, signal.liquidityScore * 2);
}

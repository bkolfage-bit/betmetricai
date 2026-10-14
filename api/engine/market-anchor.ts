/**
 * Engine / market anchor — the sharpest known benchmark for a betting
 * market is the market itself. This module:
 *
 *  1. removes the vig from every book that prices a full market, then
 *     blends those no-vig probabilities into a consensus FAIR probability,
 *     weighted toward sharp books (Pinnacle-style market makers and
 *     exchanges get more say than soft recreational books);
 *  2. shrinks raw model probabilities toward that consensus before any
 *     edge/EV/status is computed — a model that disagrees with the entire
 *     market needs proportionally stronger evidence, and pretending
 *     otherwise manufactures phantom edge;
 *  3. computes quarter-Kelly stake guidance from the working probability.
 *
 * Everything here is deterministic math over stored odds snapshots.
 * The AI layer never touches these numbers.
 */
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { adminConfig, oddsSnapshots, sportsbooks } from "@db/schema";
import { noVigN } from "./probability";
import { americanPayout } from "../lib/edge";

/* --------------------------- book sharpness ---------------------------- */

/**
 * Relative weight of each book in the consensus. Market-making sharp books
 * and betting exchanges move on real money and inform price discovery;
 * recreational books shade toward popular sides. Unknown books default to 1.
 */
export function bookSharpWeight(name: string | null | undefined, providerKey: string | null | undefined): number {
  const k = `${providerKey ?? ""} ${name ?? ""}`.toLowerCase();
  if (k.includes("pinnacle")) return 3.0;
  if (k.includes("circa")) return 2.5;
  if (k.includes("bookmaker") || k.includes("betcris") || k.includes("cris")) return 2.5;
  if (k.includes("betonline")) return 2.0;
  // exchanges trade at near-fair prices by construction
  if (k.includes("betfair") || k.includes("matchbook") || k.includes("smarkets")) return 2.5;
  if (k.includes("prophet") || k.includes("novig")) return 2.0;
  return 1.0;
}

/* --------------------------- consensus fair ---------------------------- */

export interface ConsensusFair {
  /** sharpness-weighted no-vig probability of the selection */
  prob: number;
  /** how many books contributed a complete market */
  books: number;
}

/**
 * Consensus fair probability for one selection of a market on an event.
 * For each book with a latest price on EVERY side of the market, the book's
 * own no-vig probability is computed; the consensus is the sharpness-weighted
 * average across books. Returns null when no book prices the full market.
 */
export async function consensusFairProb(
  eventId: number,
  market: "moneyline" | "spread" | "total",
  selection: string,
  threeWay: boolean,
): Promise<ConsensusFair | null> {
  const db = getDb();
  const selections =
    market === "moneyline"
      ? threeWay
        ? ["home", "draw", "away"]
        : ["home", "away"]
      : market === "total"
        ? ["over", "under"]
        : ["home", "away"];

  // latest snapshot per (selection, book)
  const rows = await db
    .select({
      selection: oddsSnapshots.selection,
      sportsbookId: oddsSnapshots.sportsbookId,
      odds: oddsSnapshots.odds,
      capturedAt: oddsSnapshots.capturedAt,
      id: oddsSnapshots.id,
    })
    .from(oddsSnapshots)
    .where(and(eq(oddsSnapshots.eventId, eventId), eq(oddsSnapshots.market, market)))
    .orderBy(desc(oddsSnapshots.capturedAt), desc(oddsSnapshots.id));

  const byBook = new Map<number, Map<string, number>>();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.sportsbookId}:${r.selection}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = byBook.get(r.sportsbookId) ?? new Map<string, number>();
    m.set(r.selection, r.odds);
    byBook.set(r.sportsbookId, m);
  }

  const bookIds = [...byBook.keys()];
  if (bookIds.length === 0) return null;
  const bookRows = await db.select().from(sportsbooks);
  const meta = new Map(bookRows.map((b) => [b.id, b]));

  let wSum = 0;
  let pSum = 0;
  let books = 0;
  for (const [bookId, prices] of byBook) {
    if (!selections.every((s) => prices.has(s))) continue; // full market only
    const probs = noVigN(selections.map((s) => prices.get(s)!));
    const idx = selections.indexOf(selection);
    if (idx < 0) continue;
    const b = meta.get(bookId);
    const w = bookSharpWeight(b?.name, b?.providerKey);
    pSum += w * probs[idx];
    wSum += w;
    books++;
  }
  if (books === 0 || wSum === 0) return null;
  return { prob: pSum / wSum, books };
}

/* --------------------------- anchor config ----------------------------- */

export interface AnchorConfig {
  enabled: boolean;
  /** model weight per market; (1 - w) goes to the market consensus */
  modelWeight: { moneyline: number; spread: number; total: number };
  /** per-sport overrides, multiplied onto the base weights. Newly-deployed
   *  rating pools (college sports) carry training-sample bias a mature model
   *  wouldn't, so the market gets more say until a graded record proves the
   *  disagreement is real. */
  sportWeight?: Record<string, number>;
}

export const DEFAULT_ANCHOR: AnchorConfig = {
  enabled: true,
  // totals are the softest market (model keeps most say); moneylines in big
  // sports are the sharpest (market gets the most say)
  modelWeight: { moneyline: 0.6, spread: 0.65, total: 0.7 },
  // NCAAF: ratings were calibrated in a single deployment from ~3 seasons of
  // scores, and a fresh Elo overshoots worst on lopsided matchups (it kept
  // claiming +40% EV on -110 spreads vs 18-book markets). 0.35 puts the
  // sport near the trust given to sharp moneylines: effective moneyline
  // weight 0.21, spread 0.23, total 0.25. Raise toward 1.0 only after the
  // sport posts a positive no-vig CLV record under these ratings.
  sportWeight: { NCAAF: 0.35 },
};

const ANCHOR_KEY = "market_anchor";

export async function getAnchorConfig(): Promise<AnchorConfig> {
  const db = getDb();
  const rows = await db.select().from(adminConfig).where(eq(adminConfig.key, ANCHOR_KEY));
  if (rows.length === 0) return DEFAULT_ANCHOR;
  try {
    const j = JSON.parse(rows[0].value) as Partial<AnchorConfig>;
    return {
      enabled: j.enabled ?? true,
      modelWeight: { ...DEFAULT_ANCHOR.modelWeight, ...(j.modelWeight ?? {}) },
      sportWeight: { ...DEFAULT_ANCHOR.sportWeight, ...(j.sportWeight ?? {}) },
    };
  } catch {
    return DEFAULT_ANCHOR;
  }
}

/**
 * Shrink a raw model probability toward the market consensus.
 * A single contributing book halves the shrink (the "consensus" is then just
 * one book's opinion de-vigged); no consensus leaves the model untouched.
 */
export function shrinkTowardMarket(
  modelProb: number,
  consensus: ConsensusFair | null,
  market: "moneyline" | "spread" | "total",
  cfg: AnchorConfig,
  sportCode?: string,
): number {
  if (!cfg.enabled || !consensus) return modelProb;
  let wModel = cfg.modelWeight[market];
  if (sportCode && cfg.sportWeight?.[sportCode] !== undefined) {
    wModel *= cfg.sportWeight[sportCode];
  }
  if (consensus.books < 2) wModel = (1 + wModel) / 2; // half-strength anchor
  const p = wModel * modelProb + (1 - wModel) * consensus.prob;
  return Math.min(0.999, Math.max(0.001, p));
}

/* ------------------------------ staking -------------------------------- */

/**
 * Quarter-Kelly stake as a fraction of bankroll, from the WORKING
 * probability (post-calibration, post-anchor). Full Kelly on a miscalibrated
 * edge overbets; the quarter fraction is the standard professional
 * compromise. Clamped to [0, 5%] — nothing here ever suggests more than
 * 5% of bankroll on a single position.
 */
export function quarterKelly(prob: number, odds: number): number {
  const b = americanPayout(odds);
  if (b <= 0) return 0;
  const q = 1 - prob;
  const full = (b * prob - q) / b;
  if (!Number.isFinite(full) || full <= 0) return 0;
  return Math.min(0.05, Math.max(0, full / 4));
}

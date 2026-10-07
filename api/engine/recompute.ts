import { getDb } from "../queries/connection";
import {
  aiPicks,
  aiPickVersions,
  alerts,
  events,
  oddsSnapshots,
  predictions,
  sportsbooks,
} from "@db/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  aiEdgeScore,
  americanToImplied,
  betUpToLine,
  expectedValue,
  fmtLine,
  fmtOdds,
  modelProbability,
  noVig,
  statusForScore,
  type Market,
  type PickStatus,
} from "../lib/edge";
import { getThresholds } from "../lib/config";

export interface ComputedVersion {
  line: number | null;
  odds: number;
  sportsbookId: number;
  modelProb: number;
  impliedProb: number;
  probEdge: number;
  ev: number;
  edgeScore: number;
  status: PickStatus;
  betUpTo: number | null;
}

/** Latest prediction for an event (prefers live rows for live events). */
export async function latestPrediction(eventId: number, live = false) {
  const db = getDb();
  const rows = await db
    .select()
    .from(predictions)
    .where(and(eq(predictions.eventId, eventId), eq(predictions.isLive, live)))
    .orderBy(desc(predictions.createdAt), desc(predictions.id))
    .limit(1);
  if (rows.length === 0 && live) {
    const pre = await db
      .select()
      .from(predictions)
      .where(and(eq(predictions.eventId, eventId), eq(predictions.isLive, false)))
      .orderBy(desc(predictions.createdAt), desc(predictions.id))
      .limit(1);
    return pre[0] ?? null;
  }
  return rows[0] ?? null;
}

/** Latest snapshot per sportsbook for a market+selection. */
export async function latestOddsByBook(
  eventId: number,
  market: Market,
  selection: string,
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(oddsSnapshots)
    .where(
      and(
        eq(oddsSnapshots.eventId, eventId),
        eq(oddsSnapshots.market, market),
        eq(oddsSnapshots.selection, selection),
      ),
    )
    .orderBy(desc(oddsSnapshots.capturedAt), desc(oddsSnapshots.id));
  const byBook = new Map<number, (typeof rows)[number]>();
  for (const r of rows) {
    if (!byBook.has(r.sportsbookId)) byBook.set(r.sportsbookId, r);
  }
  return [...byBook.values()];
}

function betterPrice(
  a: { odds: number; line: string | null },
  b: { odds: number; line: string | null },
): boolean {
  const la = a.line === null ? 0 : parseFloat(a.line);
  const lb = b.line === null ? 0 : parseFloat(b.line);
  // For a spread bettor, a higher line number is better (-3 > -3.5; +3.5 > +3)
  if (la !== lb) return la > lb;
  return a.odds > b.odds;
}

/**
 * Compute the current version for a pick from verified backend data.
 * Returns null when there is no usable market price (never fabricate).
 */
export async function computePickVersion(
  pick: typeof aiPicks.$inferSelect,
): Promise<ComputedVersion | null> {
  const db = getDb();
  const ev = await db.select().from(events).where(eq(events.id, pick.eventId));
  if (ev.length === 0) return null;
  const event = ev[0];
  const isLive = event.status === "live";
  const pred = await latestPrediction(pick.eventId, isLive);
  if (!pred) return null;

  const market = pick.market as Market;
  const offers = await latestOddsByBook(pick.eventId, market, pick.selection);
  if (offers.length === 0) return null;

  const best = offers.reduce((a, b) => (betterPrice(a, b) ? a : b));
  const line = best.line === null ? null : parseFloat(best.line);

  // two-way no-vig at the best book
  const otherSide =
    market === "total"
      ? pick.selection === "over"
        ? "under"
        : "over"
      : pick.selection === "home"
        ? "away"
        : "home";
  const otherOffers = await latestOddsByBook(pick.eventId, market, otherSide);
  const otherAtBook = otherOffers.find(
    (o) => o.sportsbookId === best.sportsbookId,
  );

  const projSpread = parseFloat(pred.projSpread);
  const projTotal = parseFloat(pred.projTotal);
  const homeWinProb = parseFloat(pred.homeWinProb);
  const confidence = parseFloat(pred.confidence);

  const modelProb = modelProbability(
    market,
    pick.selection,
    line,
    projSpread,
    projTotal,
    homeWinProb,
  );

  let impliedProb: number;
  if (otherAtBook) {
    // noVig returns probabilities aligned to argument order; take ours
    impliedProb = noVig(best.odds, otherAtBook.odds)[0];
  } else {
    impliedProb = americanToImplied(best.odds);
  }

  const probEdge = modelProb - impliedProb;
  const evPerUnit = expectedValue(modelProb, best.odds);

  // line stability from recent snapshots at the best book
  const dbRows = await db
    .select()
    .from(oddsSnapshots)
    .where(
      and(
        eq(oddsSnapshots.eventId, pick.eventId),
        eq(oddsSnapshots.market, market),
        eq(oddsSnapshots.selection, pick.selection),
        eq(oddsSnapshots.sportsbookId, best.sportsbookId),
      ),
    )
    .orderBy(desc(oddsSnapshots.capturedAt))
    .limit(8);
  const lines = dbRows
    .map((r) => (r.line === null ? null : parseFloat(r.line)))
    .filter((x): x is number => x !== null);
  let stability = 1;
  if (lines.length > 1) {
    const mean = lines.reduce((s, x) => s + x, 0) / lines.length;
    const sd = Math.sqrt(
      lines.reduce((s, x) => s + (x - mean) ** 2, 0) / lines.length,
    );
    stability = Math.max(0, Math.min(1, 1 - sd * 0.5));
  }

  const edgeScore = aiEdgeScore({
    probEdge,
    ev: evPerUnit,
    confidence,
    lineStability: stability,
    dataQuality: 0.9,
  });
  const thresholds = await getThresholds();

  return {
    line,
    odds: best.odds,
    sportsbookId: best.sportsbookId,
    modelProb,
    impliedProb,
    probEdge,
    ev: evPerUnit,
    edgeScore,
    status: statusForScore(edgeScore, thresholds),
    betUpTo: betUpToLine(
      market,
      pick.selection,
      projSpread,
      projTotal,
      homeWinProb,
      best.odds,
    ),
  };
}

function describeChange(
  prev: typeof aiPickVersions.$inferSelect,
  next: ComputedVersion,
  market: Market,
): string {
  const parts: string[] = [];
  const prevLine = prev.line === null ? null : parseFloat(prev.line);
  if (prevLine !== null && next.line !== null && prevLine !== next.line) {
    parts.push(
      `The sportsbook line moved from ${fmtLine(prevLine)} to ${fmtLine(next.line)}`,
    );
  }
  if (prev.odds !== next.odds) {
    parts.push(`the price moved from ${fmtOdds(prev.odds)} to ${fmtOdds(next.odds)}`);
  }
  const dEdge = next.probEdge - parseFloat(prev.probEdge);
  if (parts.length === 0) {
    parts.push("Market data refreshed");
  }
  const evTxt =
    next.ev > 0
      ? `Remaining expected value: ${(next.ev * 100).toFixed(1)}% per unit`
      : "Expected value has turned negative at the current price";
  const dir =
    dEdge < -0.005
      ? "reducing the probability edge"
      : dEdge > 0.005
        ? "improving the probability edge"
        : "with the model edge roughly unchanged";
  void market;
  return `${parts.join(" and ")}, ${dir}. ${evTxt}. Status: ${prev.status} → ${next.status}.`;
}

/**
 * Recompute a pick. If the picture changed materially, persist a NEW
 * version (history is never overwritten) and raise an alert on
 * status changes.
 */
export async function applyPickVersion(
  pickId: number,
  opts: { force?: boolean; createdAt?: Date } = {},
): Promise<{ changed: boolean; version?: ComputedVersion }> {
  const db = getDb();
  const picks = await db.select().from(aiPicks).where(eq(aiPicks.id, pickId));
  if (picks.length === 0) return { changed: false };
  const pick = picks[0];

  const computed = await computePickVersion(pick);
  if (!computed) return { changed: false };

  const prevRows = await db
    .select()
    .from(aiPickVersions)
    .where(eq(aiPickVersions.pickId, pickId))
    .orderBy(desc(aiPickVersions.version))
    .limit(1);
  const prev = prevRows[0];

  const material =
    !prev ||
    opts.force ||
    prev.status !== computed.status ||
    Math.abs(prev.edgeScore - computed.edgeScore) >= 4 ||
    (prev.line === null ? null : parseFloat(prev.line)) !== computed.line;

  if (!material) return { changed: false, version: computed };

  const nextVersion = prev ? prev.version + 1 : 1;
  const reason = prev
    ? describeChange(prev, computed, pick.market as Market)
    : "Initial model evaluation against current market prices.";

  await db.insert(aiPickVersions).values({
    pickId,
    version: nextVersion,
    line: computed.line === null ? null : String(computed.line),
    odds: computed.odds,
    sportsbookId: computed.sportsbookId,
    modelProb: String(computed.modelProb.toFixed(4)),
    impliedProb: String(computed.impliedProb.toFixed(4)),
    probEdge: String(computed.probEdge.toFixed(4)),
    ev: String(computed.ev.toFixed(4)),
    edgeScore: computed.edgeScore,
    status: computed.status,
    betUpTo: computed.betUpTo === null ? null : String(computed.betUpTo),
    changeReason: reason,
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  });

  if (prev && prev.status !== computed.status) {
    const evRows = await db
      .select()
      .from(events)
      .where(eq(events.id, pick.eventId));
    const label = evRows[0] ? `Event #${evRows[0].id}` : `Pick #${pickId}`;
    await db.insert(alerts).values({
      type: "pick_change",
      title: `Pick status changed: ${prev.status} → ${computed.status}`,
      message: `${label} — ${reason}`,
    });
  }

  return { changed: true, version: computed };
}

/** Recompute every pick on an event. */
export async function recomputeEventPicks(eventId: number) {
  const db = getDb();
  const picks = await db
    .select()
    .from(aiPicks)
    .where(eq(aiPicks.eventId, eventId));
  const results = [];
  for (const p of picks) {
    results.push(await applyPickVersion(p.id));
  }
  return results;
}

/** List active sportsbooks ordered by priority. */
export async function activeBooks() {
  const db = getDb();
  return db
    .select()
    .from(sportsbooks)
    .where(eq(sportsbooks.active, true))
    .orderBy(sportsbooks.priority);
}

/** Latest odds board for an event: all markets × selections × books. */
export async function oddsBoard(eventId: number) {
  const markets: Market[] = ["moneyline", "spread", "total"];
  const sels = ["home", "away", "over", "under"];
  const board: Record<string, Awaited<ReturnType<typeof latestOddsByBook>>> =
    {};
  for (const m of markets) {
    for (const s of sels) {
      const offers = await latestOddsByBook(eventId, m, s);
      if (offers.length > 0) board[`${m}:${s}`] = offers;
    }
  }
  return board;
}

import { getDb } from "../queries/connection";
import {
  aiPicks,
  aiPickVersions,
  alerts,
  events,
  oddsSnapshots,
  pickHistory,
  predictions,
  sports,
  sportsbooks,
  teamRatings,
} from "@db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  americanToImplied,
  fmtLine,
  fmtOdds,
  noVigN,
  probToAmerican,
} from "./probability";
import { expectedValue, type Market, type PickStatus } from "../lib/edge";
import { statusForScore } from "../lib/edge";
import { getThresholds } from "../lib/config";
import { marketProbability, type StandardPredictionLike } from "./markets";
import { aiEdgeScoreEx, getEdgeWeights } from "./edge-score";
import { SPORT_MODELS } from "../models";
import {
  consensusFairProb,
  getAnchorConfig,
  quarterKelly,
  shrinkTowardMarket,
} from "./market-anchor";
import { getCalibrationFit, applyCalibrationFit } from "./calibration-fit";
import { sportGuardrail } from "./guardrails";

export interface ComputedVersion {
  line: number | null;
  odds: number;
  sportsbookId: number;
  modelProb: number;
  /** working probability after calibration + market anchoring */
  anchoredProb: number;
  /** quarter-Kelly stake guidance (fraction of bankroll) */
  kelly: number;
  impliedProb: number; // raw implied (with vig)
  noVigProb: number; // vig-free market probability
  probEdge: number;
  ev: number;
  edgeScore: number;
  status: PickStatus;
  betUpTo: number | null;
  confidence: number;
  modelAgreement: string | null;
  modelVersion: string;
  featureVersion: string;
}

/** Latest prediction for an event (prefers live rows for live events). */
/**
 * Provisional trust for freshly deployed rating pools. A fresh Elo overshoots
 * most on lopsided matchups, so while a sport has few graded picks under its
 * current ratings, a HUGE claimed edge against a deep market reads as model
 * error, not opportunity: beyond the cap, bet grades are withheld (the pick
 * still publishes as PASS — never hidden, never deleted). Lifts automatically
 * once the sport has PROVISIONAL_MIN_GRADED settled rows.
 */
const PROVISIONAL_MIN_GRADED = 30;
const PROVISIONAL_EV_CAP = 0.25;

const gradedCountCache = new Map<string, { n: number; at: number }>();
export async function gradedCountForSport(sportCode: string): Promise<number> {
  const hit = gradedCountCache.get(sportCode);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.n;
  const db = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(pickHistory)
    .where(eq(pickHistory.sportCode, sportCode));
  const n = Number(rows[0]?.n ?? 0);
  gradedCountCache.set(sportCode, { n, at: Date.now() });
  return n;
}

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

/** Rebuild the standardized prediction view from a stored prediction row. */
function predLikeFromRow(pred: typeof predictions.$inferSelect): {
  like: StandardPredictionLike;
  agreementFrac: number;
  agreement: string | null;
} {
  let details: {
    dist?: StandardPredictionLike["dist"];
    drawProb?: number;
    agreementFrac?: number;
  } = {};
  try {
    details = pred.details ? JSON.parse(pred.details) : {};
  } catch {
    details = {};
  }
  const projSpread = parseFloat(pred.projSpread);
  const projTotal = parseFloat(pred.projTotal);
  return {
    like: {
      homeWinProb: parseFloat(pred.homeWinProb),
      drawProb: details.drawProb ?? 0,
      dist: details.dist ?? {
        kind: "normal",
        marginMean: projSpread,
        marginSd: 13.5,
        totalMean: projTotal,
        totalSd: 10.5,
      },
    },
    agreementFrac: details.agreementFrac ?? 0.75,
    agreement: pred.agreement ?? null,
  };
}

/** Solve the line/price where EV ≈ 0 → the maximum acceptable "bet up to". */
export function betUpTo(
  like: StandardPredictionLike,
  market: Market,
  selection: string,
  odds = -110,
): number | null {
  if (market === "moneyline") {
    const p = marketProbability(like, "moneyline", selection, null);
    if (p <= 0.01 || p >= 0.99) return null;
    return probToAmerican(p);
  }
  if (market === "spread") {
    const mean = like.dist.marginMean ?? (like.dist.lambdaHome ?? 1) - (like.dist.lambdaAway ?? 1);
    const fair = selection === "home" ? -mean : mean;
    let best: number | null = null;
    for (let d = -30; d <= 30; d += 0.5) {
      const candidate = Math.round((fair + d) * 2) / 2;
      const p = marketProbability(like, "spread", selection, candidate);
      if (expectedValue(p, odds) > 0.005) {
        if (best === null || candidate < best) best = candidate;
      }
    }
    return best;
  }
  // total
  const mean = like.dist.totalMean ?? (like.dist.lambdaHome ?? 1) + (like.dist.lambdaAway ?? 1);
  let best: number | null = null;
  for (let d = -20; d <= 20; d += 0.5) {
    const candidate = Math.round((mean + d) * 2) / 2;
    const p = marketProbability(like, "total", selection, candidate);
    if (expectedValue(p, odds) > 0.005) {
      if (selection === "over") {
        if (best === null || candidate > best) best = candidate;
      } else if (best === null || candidate < best) best = candidate;
    }
  }
  return best;
}

/**
 * Compute the current version for a pick from verified backend data.
 * Returns null when there is no usable market price (never fabricate).
 */
export async function computePickVersion(
  pick: typeof aiPicks.$inferSelect,
): Promise<ComputedVersion | null> {
  const db = getDb();
  const evRows = await db
    .select({ event: events, sport: sports })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(eq(events.id, pick.eventId));
  if (evRows.length === 0) return null;
  const { event, sport } = evRows[0];
  const isLive = event.status === "live";
  const pred = await latestPrediction(pick.eventId, isLive);
  if (!pred) return null;

  const market = pick.market as Market;
  const offers = await latestOddsByBook(pick.eventId, market, pick.selection);
  if (offers.length === 0) return null;

  const best = offers.reduce((a, b) => (betterPrice(a, b) ? a : b));
  const line = best.line === null ? null : parseFloat(best.line);

  const { like, agreementFrac, agreement } = predLikeFromRow(pred);
  const confidence = parseFloat(pred.confidence);
  const modelProb = marketProbability(like, market, pick.selection, line);

  // Calibration gate (mirrors ensureEventPicks): if EITHER competitor lacks
  // a hand-calibrated rating for this model version, the prediction is
  // built on a league-average prior and any "edge" over a lopsided market
  // is phantom — manufactured from ignorance, not information. The pick row
  // itself may predate the creation-time gate, so enforce it at pricing
  // time too: cap the score at PASS no matter what the numbers say.
  const modelForGate = SPORT_MODELS[sport.code];
  let ratingsCalibrated = true;
  if (modelForGate) {
    const calSides = await db
      .selectDistinct({ teamId: teamRatings.teamId })
      .from(teamRatings)
      .where(
        and(
          inArray(teamRatings.teamId, [event.homeTeamId, event.awayTeamId]),
          eq(teamRatings.featureVersion, modelForGate.featureVersion),
          eq(teamRatings.isCalibrated, 1),
        ),
      );
    ratingsCalibrated = calSides.length >= 2;
  }

  // N-way no-vig at the best book (2-way spreads/totals, 3-way soccer ML)
  const allSelections =
    market === "moneyline"
      ? like.drawProb
        ? ["home", "draw", "away"]
        : ["home", "away"]
      : market === "total"
        ? ["over", "under"]
        : ["home", "away"];
  const oddsAtBook: number[] = [];
  for (const sel of allSelections) {
    if (sel === pick.selection) {
      oddsAtBook.push(best.odds);
      continue;
    }
    const other = await latestOddsByBook(pick.eventId, market, sel);
    const atBook = other.find((o) => o.sportsbookId === best.sportsbookId);
    if (!atBook) {
      oddsAtBook.length = 0;
      break;
    }
    oddsAtBook.push(atBook.odds);
  }
  const rawImplied = americanToImplied(best.odds);
  const ourIdx = allSelections.indexOf(pick.selection);
  const noVigProb =
    oddsAtBook.length === allSelections.length && ourIdx >= 0
      ? noVigN(oddsAtBook)[ourIdx]
      : rawImplied;

  // 1. calibration: correct the raw model probability, but only with a
  //    holdout-validated fit (n ≥ 100 graded picks) — otherwise the raw
  //    probability is used untouched
  const calibFit = await getCalibrationFit(sport.code);
  const calibratedProb = calibFit ? applyCalibrationFit(calibFit, modelProb) : modelProb;

  // 2. market anchor: shrink the (calibrated) model probability toward the
  //    sharpness-weighted no-vig consensus. A model disagreeing with the
  //    whole market needs stronger evidence than one agreeing with it.
  const anchorCfg = await getAnchorConfig();
  const consensus = await consensusFairProb(
    pick.eventId,
    market,
    pick.selection,
    !!like.drawProb,
  );
  const anchoredProb = shrinkTowardMarket(calibratedProb, consensus, market, anchorCfg, sport.code);

  // edge/EV are computed from the WORKING probability, not the raw model
  const probEdge = anchoredProb - noVigProb;
  const evPerUnit = expectedValue(anchoredProb, best.odds);
  const kelly = quarterKelly(anchoredProb, best.odds);

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

  const weights = await getEdgeWeights(sport.code);
  const rawScore = aiEdgeScoreEx({
    probEdge,
    ev: evPerUnit,
    confidence,
    agreementFrac,
    lineStability: stability,
    dataQuality: 0.9,
    weights,
  });
  let edgeScore = ratingsCalibrated ? rawScore : Math.min(rawScore, 50);
  const thresholds = await getThresholds();
  const model = SPORT_MODELS[sport.code];

  // EV floor: the global minimum EV plus any sport guardrail boost. The
  // guardrail reads the sport's realized CLV — when our prices keep losing
  // to the close in a sport, the floor rises automatically until the model
  // proves itself against the market again. Picks below the floor are
  // published as PASS (never hidden, never deleted).
  const guard = await sportGuardrail(sport.code);
  const minEv = thresholds.minEv + guard.minEvBoost;
  let status = statusForScore(edgeScore, thresholds);
  if (evPerUnit < minEv && status !== "PASS") status = "PASS";
  // provisional EV cap for unproven sports (see constants above)
  const graded = await gradedCountForSport(sport.code);
  if (graded < PROVISIONAL_MIN_GRADED && evPerUnit > PROVISIONAL_EV_CAP && status !== "PASS") {
    status = "PASS";
  }
  // score/status coherence: when a gate (EV floor, guardrail, provisional
  // cap) distrusts the claimed edge enough to force PASS, the displayed
  // score must not contradict it. Cap at HOLD's ceiling so a distrusted
  // pick never shows "100 PASS".
  if (status === "PASS") edgeScore = Math.min(edgeScore, thresholds.hold - 1);

  // moneyline "value cutoff" is priced off the working probability too
  const betUpToValue =
    market === "moneyline"
      ? anchoredProb <= 0.01 || anchoredProb >= 0.99
        ? null
        : probToAmerican(anchoredProb)
      : betUpTo(like, market, pick.selection, best.odds);

  return {
    line,
    odds: best.odds,
    sportsbookId: best.sportsbookId,
    modelProb,
    anchoredProb,
    kelly,
    impliedProb: rawImplied,
    noVigProb,
    probEdge,
    ev: evPerUnit,
    edgeScore,
    status,
    betUpTo: betUpToValue,
    confidence,
    modelAgreement: agreement,
    modelVersion: pred.modelVersion,
    featureVersion: model?.featureVersion ?? "feat-v1",
  };
}

function describeChange(
  prev: typeof aiPickVersions.$inferSelect,
  next: ComputedVersion,
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
    ? describeChange(prev, computed)
    : "Initial model evaluation against current market prices.";

  await db.insert(aiPickVersions).values({
    pickId,
    version: nextVersion,
    line: computed.line === null ? null : String(computed.line),
    odds: computed.odds,
    sportsbookId: computed.sportsbookId,
    modelProb: String(computed.modelProb.toFixed(4)),
    anchoredProb: String(computed.anchoredProb.toFixed(4)),
    kelly: String(computed.kelly.toFixed(4)),
    impliedProb: String(computed.impliedProb.toFixed(4)),
    noVigProb: String(computed.noVigProb.toFixed(4)),
    probEdge: String(computed.probEdge.toFixed(4)),
    ev: String(computed.ev.toFixed(4)),
    edgeScore: computed.edgeScore,
    confidence: String(computed.confidence.toFixed(3)),
    modelAgreement: computed.modelAgreement,
    modelVersion: computed.modelVersion,
    featureVersion: computed.featureVersion,
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
  const sels = ["home", "draw", "away", "over", "under"];
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

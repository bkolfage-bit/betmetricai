/**
 * Automatic pick grading — settles published AI picks when an event goes
 * final and appends immutable rows to pick_history (the Performance page
 * data source).
 *
 * Integrity rules (from the platform spec):
 *  - history is append-only: grading never edits or deletes a settled row,
 *    winning or losing
 *  - re-running for the same event is a no-op (pickId idempotency key)
 *  - picks are graded at the price they were FIRST PUBLISHED at (version 1)
 *    — later repricing never rewrites the record, and in-game (live) prices
 *    are never used for the pregame track record
 *  - CLV is measured against the last real market snapshot at or before the
 *    scheduled start (the closing line). If no closing price exists, CLV is
 *    recorded as 0 — never estimated
 *  - a pick that cannot be settled honestly (missing line) is skipped, not
 *    force-graded
 */
import { and, asc, desc, eq, gt, lte } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  aiPicks,
  aiPickVersions,
  closingLines,
  events,
  oddsSnapshots,
  pickHistory,
  predictions,
  sports,
  teams,
} from "../../db/schema";
import { americanPayout, americanToImplied, fmtLine } from "../lib/edge";
import { noVigN } from "../engine/probability";

const EPS = 1e-9;

/**
 * No-vig fair probability of a selection at one book, from the latest
 * snapshots of EVERY side of the market at or before `before` (or after
 * `after` for live windows). Returns null when any side is missing — a
 * fair probability is never estimated from half a market.
 */
async function fairProbAt(
  eventId: number,
  market: "moneyline" | "spread" | "total",
  selection: string,
  sportsbookId: number,
  opts: { before?: Date; after?: Date },
  threeWay: boolean,
): Promise<number | null> {
  const db = getDb();
  const selections =
    market === "moneyline"
      ? threeWay
        ? ["home", "draw", "away"]
        : ["home", "away"]
      : market === "total"
        ? ["over", "under"]
        : ["home", "away"];
  const odds: number[] = [];
  for (const sel of selections) {
    const where = and(
      eq(oddsSnapshots.eventId, eventId),
      eq(oddsSnapshots.market, market),
      eq(oddsSnapshots.selection, sel),
      eq(oddsSnapshots.sportsbookId, sportsbookId),
      opts.before ? lte(oddsSnapshots.capturedAt, opts.before) : undefined,
      opts.after ? gt(oddsSnapshots.capturedAt, opts.after) : undefined,
    );
    const [snap] = await db
      .select({ odds: oddsSnapshots.odds })
      .from(oddsSnapshots)
      .where(where)
      .orderBy(desc(oddsSnapshots.capturedAt), desc(oddsSnapshots.id))
      .limit(1);
    if (!snap) return null;
    odds.push(snap.odds);
  }
  const idx = selections.indexOf(selection);
  return idx >= 0 ? noVigN(odds)[idx] : null;
}

/** Typical wall-clock duration per sport (minutes), mirroring the live-sync
 *  estimates — used to record when a game actually finished. */
const EST_GAME_MINUTES: Record<string, number> = {
  MLB: 200, SOCCER: 115, NHL: 150, NBA: 145, NFL: 200, NCAAF: 200,
  NCAAB: 130, TENNIS: 140, UFC: 60, GOLF: 300,
};
const estGameMinutes = (code: string) => EST_GAME_MINUTES[code] ?? 150;

type GradeResult = "won" | "lost" | "push";

function gradePick(
  market: "moneyline" | "spread" | "total",
  selection: string,
  line: number | null,
  homeScore: number,
  awayScore: number,
  threeWay: boolean,
): GradeResult | null {
  if (market === "moneyline") {
    if (homeScore === awayScore) {
      // 3-way market (soccer): the draw was a priced outcome, so home/away
      // tickets lose. 2-way market: stakes refund.
      return threeWay ? "lost" : "push";
    }
    const homeWon = homeScore > awayScore;
    return (selection === "home") === homeWon ? "won" : "lost";
  }
  // spread and total both require the published line to settle
  if (line === null) return null;
  if (market === "spread") {
    const margin =
      selection === "home" ? homeScore - awayScore : awayScore - homeScore;
    const diff = margin + line; // line is stored from the selection's side
    if (Math.abs(diff) < EPS) return "push";
    return diff > 0 ? "won" : "lost";
  }
  const total = homeScore + awayScore;
  const diff = selection === "over" ? total - line : line - total;
  if (Math.abs(diff) < EPS) return "push";
  return diff > 0 ? "won" : "lost";
}

/**
 * Closing price for a pick, at the sportsbook it was published at:
 *  - pick published BEFORE the scheduled start → the last real snapshot at
 *    or before the start (the classic closing line)
 *  - pick published IN-GAME (live pick) → the final traded price after
 *    publication (pregame close is meaningless for a live bet)
 * Persisted to closing_lines on first use. Returns null when no usable
 * snapshot exists (CLV then records as 0 — never fabricated).
 */
async function closingLineFor(
  pickId: number,
  eventId: number,
  market: "moneyline" | "spread" | "total",
  selection: string,
  sportsbookId: number,
  startTime: Date,
  publishedAt: Date,
): Promise<{ odds: number; line: number | null } | null> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(closingLines)
    .where(eq(closingLines.pickId, pickId))
    .limit(1);
  if (existing) {
    return {
      odds: existing.odds,
      line: existing.line === null ? null : parseFloat(existing.line),
    };
  }
  const pregame = publishedAt.getTime() <= startTime.getTime();
  const where = and(
    eq(oddsSnapshots.eventId, eventId),
    eq(oddsSnapshots.market, market),
    eq(oddsSnapshots.selection, selection),
    eq(oddsSnapshots.sportsbookId, sportsbookId),
    pregame
      ? lte(oddsSnapshots.capturedAt, startTime)
      : gt(oddsSnapshots.capturedAt, publishedAt),
  );
  // both regimes want the LAST traded price in the window (order desc)
  const [snap] = await db
    .select()
    .from(oddsSnapshots)
    .where(where)
    .orderBy(desc(oddsSnapshots.capturedAt), desc(oddsSnapshots.id))
    .limit(1);
  if (!snap) return null;
  const line = snap.line === null ? null : parseFloat(snap.line);
  await db
    .insert(closingLines)
    .values({ pickId, line: line === null ? null : String(line), odds: snap.odds });
  return { odds: snap.odds, line };
}

/**
 * Grade every published pick for a FINAL event into pick_history.
 * Returns the number of picks graded (0 when already graded or the event
 * is not final with real scores).
 */
export async function gradeEventPicks(eventId: number): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ event: events, sport: sports })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) return 0;
  const { event, sport } = row;
  if (
    event.status !== "final" ||
    event.homeScore === null ||
    event.awayScore === null
  ) {
    return 0;
  }

  const [home] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, event.homeTeamId))
    .limit(1);
  const [away] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, event.awayTeamId))
    .limit(1);
  if (!home || !away) return 0;

  // 3-way moneyline (soccer) is signalled by a priced draw in the model view
  const [pred] = await db
    .select({ details: predictions.details })
    .from(predictions)
    .where(eq(predictions.eventId, eventId))
    .orderBy(desc(predictions.id))
    .limit(1);
  let threeWay = false;
  try {
    threeWay = pred?.details
      ? (JSON.parse(pred.details) as { drawProb?: number }).drawProb != null
      : false;
  } catch {
    threeWay = false;
  }

  const picks = await db
    .select()
    .from(aiPicks)
    .where(eq(aiPicks.eventId, eventId));
  let graded = 0;

  for (const pick of picks) {
    // idempotency: a settled pick is never re-graded or altered
    const [already] = await db
      .select({ id: pickHistory.id })
      .from(pickHistory)
      .where(eq(pickHistory.pickId, pick.id))
      .limit(1);
    if (already) continue;

    // grade at the FIRST PUBLISHED evaluation (version 1)
    const [v1] = await db
      .select()
      .from(aiPickVersions)
      .where(eq(aiPickVersions.pickId, pick.id))
      .orderBy(asc(aiPickVersions.version))
      .limit(1);
    if (!v1) continue;

    const line = v1.line === null ? null : parseFloat(v1.line);
    const result = gradePick(
      pick.market,
      pick.selection,
      line,
      event.homeScore,
      event.awayScore,
      threeWay,
    );
    if (!result) continue; // cannot settle honestly — skip, don't invent

    const units =
      result === "won" ? americanPayout(v1.odds) : result === "lost" ? -1 : 0;

    const closing = await closingLineFor(
      pick.id,
      eventId,
      pick.market,
      pick.selection,
      v1.sportsbookId,
      event.startTime,
      v1.createdAt,
    );
    // CLV in percentage points of implied probability: positive = the price
    // we published beat the closing price
    const clv = closing
      ? (americanToImplied(closing.odds) - americanToImplied(v1.odds)) * 100
      : 0;

    // No-vig CLV (the honest version): compare the FAIR probability of the
    // selection at publication vs at the close, both de-vigged against the
    // full market at the same book. The vig contaminates the raw measure —
    // a price can look like it beat the close while the fair value moved
    // against it. Null when either side can't be de-vigged (never estimated).
    const pregame = v1.createdAt.getTime() <= event.startTime.getTime();
    const fairTaken = await fairProbAt(
      eventId,
      pick.market,
      pick.selection,
      v1.sportsbookId,
      { before: v1.createdAt },
      threeWay,
    );
    const fairClose = await fairProbAt(
      eventId,
      pick.market,
      pick.selection,
      v1.sportsbookId,
      pregame ? { before: event.startTime } : { after: v1.createdAt },
      threeWay,
    );
    const clvNoVig =
      fairTaken !== null && fairClose !== null
        ? (fairClose - fairTaken) * 100
        : null;

    const sideAbbr = pick.selection === "home" ? home.abbr : away.abbr;
    const selectionLabel =
      pick.market === "moneyline"
        ? sideAbbr
        : pick.market === "spread"
          ? `${sideAbbr} ${fmtLine(line)}`
          : `${pick.selection === "over" ? "Over" : "Under"} ${line}`;

    // real-world completion time: kickoff + the sport's typical wall-clock
    // duration (the score feed doesn't carry an end timestamp). Never the
    // import time — a late score sync must not look like a late finish.
    const completedAt = new Date(
      event.startTime.getTime() + estGameMinutes(sport.code) * 60_000,
    );

    await db.insert(pickHistory).values({
      sportCode: sport.code,
      market: pick.market,
      eventLabel: `${away.abbr} @ ${home.abbr}`,
      selection: selectionLabel,
      odds: v1.odds,
      edgeScore: v1.edgeScore,
      modelProb: v1.modelProb,
      result,
      units: units.toFixed(2),
      clv: clv.toFixed(3),
      clvNoVig: clvNoVig === null ? null : clvNoVig.toFixed(3),
      closeFairProb: fairClose === null ? null : fairClose.toFixed(4),
      placedAt: v1.createdAt, // original publication time — never backdated
      completedAt,
      pickId: pick.id,
    });
    graded++;
  }
  return graded;
}

import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  aiPicks,
  aiPickVersions,
  events,
  predictions,
  sports,
  sportsbooks,
  teams,
} from "@db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { latestOddsByBook, oddsBoard } from "../engine/recompute";
import type { Market } from "../lib/edge";
import { FORECAST_HORIZON_DAYS, getFeedMode } from "../feed/service";

const homeTeams = alias(teams, "home_teams");
const awayTeams = alias(teams, "away_teams");

/* --------------------------- free-tier gating --------------------------- */
/**
 * FREE plan: at most FREE_PER_SPORT picks per sport, and no pick with an AI
 * Edge rating above FREE_MAX_EDGE — the highest-rated analysis is PRO-only.
 * PRO plan and admins see everything. Gating happens server-side; locked
 * picks are never sent to free clients.
 */
const FREE_PER_SPORT = 2;
const FREE_MAX_EDGE = 90;

type GatedUser = { plan: string; role: string } | undefined;
const isPro = (u: GatedUser) => !!u && (u.plan === "pro" || u.role === "admin");

interface Gateable {
  sportCode: string;
  version: { edgeScore: number } | null;
}

function gateForFree<T extends Gateable>(rows: T[], user: GatedUser) {
  if (isPro(user)) return { visible: rows, lockedCount: 0 };
  const visible: T[] = [];
  const perSport = new Map<string, number>();
  let lockedCount = 0;
  // rows arrive sorted best-first (status, then edgeScore desc)
  for (const r of rows) {
    const edge = r.version?.edgeScore ?? 0;
    const count = perSport.get(r.sportCode) ?? 0;
    if (edge > FREE_MAX_EDGE || count >= FREE_PER_SPORT) {
      lockedCount++;
      continue;
    }
    perSport.set(r.sportCode, count + 1);
    visible.push(r);
  }
  return { visible, lockedCount };
}

async function eventWithTeams(eventId: number) {
  const db = getDb();
  const rows = await db
    .select({
      event: events,
      home: homeTeams,
      away: awayTeams,
    })
    .from(events)
    .innerJoin(homeTeams, eq(events.homeTeamId, homeTeams.id))
    .innerJoin(awayTeams, eq(events.awayTeamId, awayTeams.id))
    .where(eq(events.id, eventId));
  return rows[0] ?? null;
}

/** Full enriched pick board, sorted best-first, pre-gating. Shared by list/detail/bestNow. */
async function buildPickBoard(sport?: string) {
  const db = getDb();
  const picks = await db.select().from(aiPicks);
  if (picks.length === 0) return [];

  const versions = await db
    .select()
    .from(aiPickVersions)
    .orderBy(desc(aiPickVersions.version));
  const latestByPick = new Map<number, (typeof versions)[number]>();
  const countByPick = new Map<number, number>();
  for (const v of versions) {
    if (!latestByPick.has(v.pickId)) latestByPick.set(v.pickId, v);
    countByPick.set(v.pickId, (countByPick.get(v.pickId) ?? 0) + 1);
  }

  const eventIds = [...new Set(picks.map((p) => p.eventId))];
  const evRows = await db
    .select()
    .from(events)
    .where(inArray(events.id, eventIds));
  const teamRows = await db.select().from(teams);
  const teamMap = new Map(teamRows.map((t) => [t.id, t]));
  const bookRows = await db.select().from(sportsbooks);
  const bookMap = new Map(bookRows.map((b) => [b.id, b]));
  const sportRows = await db.select().from(sports);
  const sportMap = new Map(sportRows.map((s) => [s.id, s.code]));

  const live = (await getFeedMode()) === "live";
  const horizonCutoff = Date.now() + FORECAST_HORIZON_DAYS * 24 * 3_600_000;
  const out = picks
    .map((p) => {
      const ev = evRows.find((e) => e.id === p.eventId)!;
      const v = latestByPick.get(p.id) ?? null;
      return {
        pick: p,
        version: v,
        versionCount: countByPick.get(p.id) ?? 0,
        event: ev,
        sportCode: sportMap.get(ev.sportId) ?? "",
        home: teamMap.get(ev.homeTeamId)!,
        away: teamMap.get(ev.awayTeamId)!,
        book: v ? bookMap.get(v.sportsbookId) ?? null : null,
      };
    })
    // LIVE mode: only real-odds events — demo picks never mix in —
    // and nothing beyond the 8-day forecast horizon is analyzed.
    // FINAL events are excluded — the moment a game ends its picks are
    // graded into pick_history (AI Performance) and clear off the board.
    .filter((r) => r.event.status !== "final")
    .filter((r) => !live || r.event.isDemo === false)
    .filter((r) => !live || r.event.startTime.getTime() <= horizonCutoff)
    .filter((r) => !sport || r.sportCode === sport);

  const order = { STRONG_BET: 0, BET: 1, WATCH: 2, HOLD: 3, PASS: 4 };
  out.sort((a, b) => {
    const sa = a.version ? order[a.version.status] : 9;
    const sb = b.version ? order[b.version.status] : 9;
    if (sa !== sb) return sa - sb;
    return (b.version?.edgeScore ?? 0) - (a.version?.edgeScore ?? 0);
  });
  return out;
}

/** Is this pick visible to this user under the free-tier rules? */
async function pickVisibleTo(pickId: number, user: GatedUser) {
  if (isPro(user)) return true;
  const board = await buildPickBoard();
  const { visible } = gateForFree(board, user);
  return visible.some((r) => r.pick.id === pickId);
}

export const picksRouter = createRouter({
  /**
   * All picks with their latest version, event and team context.
   * Free tier: max 2 picks per sport, none rated above 90 — PRO sees all.
   */
  list: publicQuery
    .input(z.object({ sport: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const board = await buildPickBoard(input?.sport);
      const { visible, lockedCount } = gateForFree(board, ctx.user);
      return { picks: visible, lockedCount };
    }),

  /** Single pick: full version timeline + market context. Never fabricated. */
  detail: publicQuery
    .input(z.object({ pickId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const picks = await db
        .select()
        .from(aiPicks)
        .where(eq(aiPicks.id, input.pickId));
      if (picks.length === 0) return null;
      const pick = picks[0];

      // free tier: locked picks are never served, even by direct id
      if (!(await pickVisibleTo(pick.id, ctx.user))) {
        return { locked: true as const };
      }

      const versions = await db
        .select()
        .from(aiPickVersions)
        .where(eq(aiPickVersions.pickId, pick.id))
        .orderBy(desc(aiPickVersions.version));

      const teams_ = await eventWithTeams(pick.eventId);
      const books = await db.select().from(sportsbooks);
      const bookMap = new Map(books.map((b) => [b.id, b]));

      // price comparison across books for this selection
      const offers = await latestOddsByBook(
        pick.eventId,
        pick.market as Market,
        pick.selection,
      );

      // latest model projection
      const evRow = await db
        .select()
        .from(events)
        .where(eq(events.id, pick.eventId));
      const isLive = evRow[0]?.status === "live";
      const preds = await db
        .select()
        .from(predictions)
        .where(
          and(
            eq(predictions.eventId, pick.eventId),
            eq(predictions.isLive, isLive),
          ),
        )
        .orderBy(desc(predictions.createdAt), desc(predictions.id))
        .limit(1);

      const board = await oddsBoard(pick.eventId);

      return {
        pick,
        versions,
        event: evRow[0] ?? null,
        home: teams_?.home ?? null,
        away: teams_?.away ?? null,
        prediction: preds[0] ?? null,
        offers: offers.map((o) => ({
          ...o,
          book: bookMap.get(o.sportsbookId) ?? null,
        })),
        board,
        books,
      };
    }),

  /** The single best bet right now (highest non-PASS edge). Free tier: gated like list. */
  bestNow: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const board = await buildPickBoard();
    const { visible } = gateForFree(board, ctx.user);
    const bestRow = visible.find((r) => r.version && r.version.status !== "PASS");
    if (!bestRow || !bestRow.version) return null;
    const books = await db
      .select()
      .from(sportsbooks)
      .where(eq(sportsbooks.id, bestRow.version.sportsbookId));
    return {
      pick: bestRow.pick,
      version: bestRow.version,
      event: bestRow.event,
      home: bestRow.home,
      away: bestRow.away,
      book: books[0] ?? null,
    };
  }),
});

import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  aiPicks,
  aiPickVersions,
  events,
  predictions,
  sportsbooks,
  teams,
} from "@db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { latestOddsByBook, oddsBoard } from "../engine/recompute";
import type { Market } from "../lib/edge";

const homeTeams = alias(teams, "home_teams");
const awayTeams = alias(teams, "away_teams");

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

export const picksRouter = createRouter({
  /** All picks with their latest version, event and team context. */
  list: publicQuery.query(async () => {
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

    const out = picks.map((p) => {
      const ev = evRows.find((e) => e.id === p.eventId)!;
      const v = latestByPick.get(p.id) ?? null;
      return {
        pick: p,
        version: v,
        versionCount: countByPick.get(p.id) ?? 0,
        event: ev,
        home: teamMap.get(ev.homeTeamId)!,
        away: teamMap.get(ev.awayTeamId)!,
        book: v ? bookMap.get(v.sportsbookId) ?? null : null,
      };
    });

    const order = { STRONG_BET: 0, BET: 1, WATCH: 2, HOLD: 3, PASS: 4 };
    out.sort((a, b) => {
      const sa = a.version ? order[a.version.status] : 9;
      const sb = b.version ? order[b.version.status] : 9;
      if (sa !== sb) return sa - sb;
      return (b.version?.edgeScore ?? 0) - (a.version?.edgeScore ?? 0);
    });
    return out;
  }),

  /** Single pick: full version timeline + market context. Never fabricated. */
  detail: publicQuery
    .input(z.object({ pickId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const picks = await db
        .select()
        .from(aiPicks)
        .where(eq(aiPicks.id, input.pickId));
      if (picks.length === 0) return null;
      const pick = picks[0];

      const versions = await db
        .select()
        .from(aiPickVersions)
        .where(eq(aiPickVersions.pickId, pick.id))
        .orderBy(desc(aiPickVersions.version));

      const ctx = await eventWithTeams(pick.eventId);
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
        home: ctx?.home ?? null,
        away: ctx?.away ?? null,
        prediction: preds[0] ?? null,
        offers: offers.map((o) => ({
          ...o,
          book: bookMap.get(o.sportsbookId) ?? null,
        })),
        board,
        books,
      };
    }),

  /** The single best bet right now (highest non-PASS edge). */
  bestNow: publicQuery.query(async () => {
    const db = getDb();
    const versions = await db
      .select()
      .from(aiPickVersions)
      .orderBy(desc(aiPickVersions.version));
    const latestByPick = new Map<number, (typeof versions)[number]>();
    for (const v of versions) {
      if (!latestByPick.has(v.pickId)) latestByPick.set(v.pickId, v);
    }
    const candidates = [...latestByPick.values()]
      .filter((v) => v.status !== "PASS")
      .sort((a, b) => b.edgeScore - a.edgeScore);
    if (candidates.length === 0) return null;
    const best = candidates[0];
    const picks = await db
      .select()
      .from(aiPicks)
      .where(eq(aiPicks.id, best.pickId));
    if (picks.length === 0) return null;
    const ctx = await eventWithTeams(picks[0].eventId);
    const books = await db
      .select()
      .from(sportsbooks)
      .where(eq(sportsbooks.id, best.sportsbookId));
    return {
      pick: picks[0],
      version: best,
      event: ctx?.event ?? null,
      home: ctx?.home ?? null,
      away: ctx?.away ?? null,
      book: books[0] ?? null,
    };
  }),
});

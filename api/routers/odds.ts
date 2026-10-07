import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  adminConfig,
  events,
  oddsSnapshots,
  sports,
  sportsbooks,
  teams,
} from "@db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { oddsBoard } from "../engine/recompute";
import type { Market } from "../lib/edge";

const homeTeams = alias(teams, "home_teams");
const awayTeams = alias(teams, "away_teams");

export const oddsRouter = createRouter({
  /** All events with team context, ordered by status then start time. */
  events: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({ event: events, home: homeTeams, away: awayTeams, sport: sports })
      .from(events)
      .innerJoin(homeTeams, eq(events.homeTeamId, homeTeams.id))
      .innerJoin(awayTeams, eq(events.awayTeamId, awayTeams.id))
      .innerJoin(sports, eq(events.sportId, sports.id))
      .orderBy(asc(events.startTime));
    const rank = { live: 0, scheduled: 1, final: 2 };
    rows.sort((a, b) => rank[a.event.status] - rank[b.event.status]);
    return rows;
  }),

  /** Full odds board for one event: all markets × selections × books. */
  board: publicQuery
    .input(z.object({ eventId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const board = await oddsBoard(input.eventId);
      const books = await db.select().from(sportsbooks);
      return { board, books };
    }),

  /** Consensus line history for line-movement charts (never overwritten). */
  lineHistory: publicQuery
    .input(
      z.object({
        eventId: z.number(),
        market: z.enum(["moneyline", "spread", "total"]),
        selection: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(oddsSnapshots)
        .where(
          and(
            eq(oddsSnapshots.eventId, input.eventId),
            eq(oddsSnapshots.market, input.market as Market),
            eq(oddsSnapshots.selection, input.selection),
          ),
        )
        .orderBy(asc(oddsSnapshots.capturedAt), asc(oddsSnapshots.id));

      // group into time buckets (per batch), average across books
      const buckets = new Map<number, { lines: number[]; odds: number[]; at: Date }>();
      for (const r of rows) {
        const key = Math.floor(r.capturedAt.getTime() / 60000);
        const b = buckets.get(key) ?? { lines: [], odds: [], at: r.capturedAt };
        if (r.line !== null) b.lines.push(parseFloat(r.line));
        b.odds.push(r.odds);
        buckets.set(key, b);
      }
      return [...buckets.values()].map((b) => ({
        at: b.at,
        line:
          b.lines.length > 0
            ? Math.round((b.lines.reduce((s, x) => s + x, 0) / b.lines.length) * 10) / 10
            : null,
        odds: Math.round(b.odds.reduce((s, x) => s + x, 0) / b.odds.length),
      }));
    }),

  /** Feed freshness — every live display must show its data age. */
  freshness: publicQuery.query(async () => {
    const db = getDb();
    const tick = await db
      .select()
      .from(adminConfig)
      .where(eq(adminConfig.key, "sim_last_tick"));
    const latest = await db
      .select()
      .from(oddsSnapshots)
      .orderBy(desc(oddsSnapshots.capturedAt), desc(oddsSnapshots.id))
      .limit(1);
    const mode = await db
      .select()
      .from(adminConfig)
      .where(eq(adminConfig.key, "data_mode"));
    return {
      dataMode: mode[0]?.value ?? "DEMO",
      lastTick: tick[0]?.value ?? null,
      lastOddsAt: latest[0]?.capturedAt ?? null,
      serverTime: new Date(),
    };
  }),
});

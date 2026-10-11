/**
 * Odds feed router.
 *  - public status: feed mode + per-sport staleness/health (never the key,
 *    never raw quota internals beyond credits remaining)
 *  - admin: discovery, manual sync, mode switch (DEMO <-> LIVE), quota detail
 */
import { z } from "zod";
import { asc } from "drizzle-orm";
import { adminQuery, createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { oddsOutrights, sportsbooks } from "@db/schema";
import {
  allowedPropMarkets,
  discoverSports,
  estimatePropsCost,
  getFeedMode,
  getFeedStatus,
  setFeedMode,
  syncEventProps,
  syncOutrights,
  syncSportOdds,
} from "../feed/service";
import { hasOddsProvider } from "../providers";

export const feedRouter = createRouter({
  /** Public: what the UI needs to label data freshness honestly. */
  status: publicQuery.query(async () => {
    const s = await getFeedStatus();
    return {
      mode: s.mode,
      providerConfigured: s.providerConfigured,
      health: s.health.map((h) => ({
        sportCode: h.sportCode,
        status: h.status,
        lastSuccessAt: h.lastSuccessAt,
        message: h.message,
      })),
    };
  }),

  /**
   * Public: championship / futures boards (the horizon exception).
   * Grouped per provider key (e.g. Super Bowl winner, World Series winner),
   * each participant with its best price across books.
   */
  outrights: publicQuery
    .input(z.object({ sportCode: z.string().min(2).max(16).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(oddsOutrights)
        .orderBy(asc(oddsOutrights.sportCode), asc(oddsOutrights.providerSportKey), asc(oddsOutrights.participant));
      const filtered = input?.sportCode
        ? rows.filter((r) => r.sportCode === input!.sportCode!.toUpperCase())
        : rows;
      const books = await db.select().from(sportsbooks);
      const bookName = new Map(books.map((b) => [b.id, b.name]));

      const boards = new Map<string, {
        sportCode: string;
        providerSportKey: string;
        lastUpdate: Date | null;
        participants: Map<string, { participant: string; bestOdds: number; bestBook: string; books: number }>;
      }>();
      for (const r of filtered) {
        const key = `${r.sportCode}:${r.providerSportKey}`;
        const b = boards.get(key) ?? {
          sportCode: r.sportCode,
          providerSportKey: r.providerSportKey,
          lastUpdate: null,
          participants: new Map(),
        };
        const p = b.participants.get(r.participant) ?? {
          participant: r.participant, bestOdds: -Infinity, bestBook: "", books: 0,
        };
        p.books++;
        if (r.americanOdds > p.bestOdds) {
          p.bestOdds = r.americanOdds;
          p.bestBook = bookName.get(r.sportsbookId) ?? "";
        }
        b.participants.set(r.participant, p);
        if (!b.lastUpdate || r.providerLastUpdate > b.lastUpdate) b.lastUpdate = r.providerLastUpdate;
        boards.set(key, b);
      }
      return [...boards.values()].map((b) => ({
        ...b,
        participants: [...b.participants.values()].sort((x, y) => y.bestOdds - x.bestOdds)
          .sort((x, y) => Math.abs(y.bestOdds) - Math.abs(x.bestOdds)),
      }));
    }),

  /** Admin: full feed dashboard payload (quota, map, health, recent calls). */
  dashboard: adminQuery.query(async () => {
    const s = await getFeedStatus();
    return {
      mode: s.mode,
      providerConfigured: s.providerConfigured,
      quota: s.quota,
      health: s.health,
      sportMap: s.map,
      lastCalls: s.lastCalls,
    };
  }),

  /** Admin: run /v4/sports discovery and persist the sport map. Free call. */
  discover: adminQuery.mutation(async () => {
    if (!hasOddsProvider()) throw new Error("ODDS_API_KEY not configured");
    return discoverSports();
  }),

  /** Admin: paid manual sync for one sport (respects quota tiers upstream). */
  syncSport: adminQuery
    .input(z.object({ sportCode: z.string().min(2).max(16) }))
    .mutation(async ({ input }) => {
      if (!hasOddsProvider()) throw new Error("ODDS_API_KEY not configured");
      return syncSportOdds(input.sportCode.toUpperCase());
    }),

  /** Admin: sync championship / futures markets for a sport (paid, measured). */
  syncOutrights: adminQuery
    .input(z.object({ sportCode: z.string().min(2).max(16) }))
    .mutation(async ({ input }) => {
      if (!hasOddsProvider()) throw new Error("ODDS_API_KEY not configured");
      return syncOutrights(input.sportCode.toUpperCase());
    }),

  /** Admin: switch data source. LIVE pauses the demo simulator's influence. */
  setMode: adminQuery
    .input(z.object({ mode: z.enum(["demo", "live"]) }))
    .mutation(async ({ input }) => {
      await setFeedMode(input.mode);
      return { mode: await getFeedMode() };
    }),

  /** Admin: documented player-prop market keys for a sport (never invented). */
  propMarkets: adminQuery
    .input(z.object({ sportCode: z.string().min(2).max(16) }))
    .query(({ input }) => ({
      sportCode: input.sportCode.toUpperCase(),
      markets: allowedPropMarkets(input.sportCode.toUpperCase()),
    })),

  /** Admin: credit-cost estimate BEFORE any props credits are spent. */
  estimateProps: adminQuery
    .input(
      z.object({
        eventCount: z.number().int().min(1).max(100),
        marketKeys: z.array(z.string()).min(1),
      }),
    )
    .query(({ input }) => ({
      estimatedCredits: estimatePropsCost(input.eventCount, input.marketKeys),
    })),

  /** Admin: event-level props pull for one provider event (paid, measured). */
  syncProps: adminQuery
    .input(
      z.object({
        sportCode: z.string().min(2).max(16),
        providerEventId: z.string().min(4).max(128),
        marketKeys: z.array(z.string()).min(1).max(6),
      }),
    )
    .mutation(async ({ input }) =>
      syncEventProps(input.sportCode.toUpperCase(), input.providerEventId, input.marketKeys),
    ),

  /** Admin: credit-cost estimate for an NHL props sweep BEFORE spending. */
  estimateNhlPropsSweep: adminQuery.query(async () => {
    const { estimatePropsCost } = await import("../feed/service");
    const { getDb } = await import("../queries/connection");
    const { events, sports } = await import("@db/schema");
    const { and, eq, gte, sql } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .innerJoin(sports, eq(events.sportId, sports.id))
      .where(and(
        eq(sports.code, "NHL"),
        eq(events.status, "scheduled"),
        gte(events.startTime, new Date()),
        sql`${events.startTime} < DATE_ADD(NOW(), INTERVAL 36 HOUR)`,
      ));
    const markets = 3; // points, shots, anytime-goal
    return {
      eventsInWindow: rows.length,
      estimatedCredits: estimatePropsCost(rows.length, new Array(markets).fill("x")),
      note: "1 credit per market per region per event; 3 markets, 1 region",
    };
  }),

  /** Admin: on-demand NHL props sweep (paid, measured — same as scheduler). */
  syncNhlPropsNow: adminQuery.mutation(async () => {
    const { syncNhlProps } = await import("../engine/props");
    return syncNhlProps(36);
  }),

  /** Admin: backfill NHL player boxscores over a date range (free API). */
  backfillNhlPlayerLogs: adminQuery
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .mutation(async ({ input }) => {
      const { ingestNhlPlayerRange } = await import("../engine/props");
      return ingestNhlPlayerRange(new Date(input.startDate), new Date(input.endDate));
    }),
});

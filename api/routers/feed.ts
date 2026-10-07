/**
 * Odds feed router.
 *  - public status: feed mode + per-sport staleness/health (never the key,
 *    never raw quota internals beyond credits remaining)
 *  - admin: discovery, manual sync, mode switch (DEMO <-> LIVE), quota detail
 */
import { z } from "zod";
import { adminQuery, createRouter, publicQuery } from "../middleware";
import {
  allowedPropMarkets,
  discoverSports,
  estimatePropsCost,
  getFeedMode,
  getFeedStatus,
  setFeedMode,
  syncEventProps,
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
});

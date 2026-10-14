/**
 * Phase 6 — Market Intelligence admin API.
 *
 * Powers the admin dashboard: per-event A/B/C probabilities, movement,
 * liquidity, agreement, and the A-vs-B-vs-C performance report, plus the
 * per-sport enable/disable controls. Admin-only — this is operational
 * telemetry, not public content.
 *
 * Every number comes from the stored tables; where there is no data the
 * endpoint returns explicit empties (never fabricated values).
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { adminQuery, createRouter } from "../middleware";
import { getDb } from "../queries/connection";
import {
  fusionShadow, fusionWeightLog, pmIntelSnapshots, pmSportModels,
} from "@db/schema";
import { fusionReport, fusionShadowCounts } from "../engine/fusion-validate";
import { extractIntelFeatures } from "../engine/pm-intel";
import { runSportPmModel } from "../engine/pm-sport-models";
import { getFusionWeight, invalidateFusionWeightCache } from "../engine/fusion";
import { SPORT_ORDER } from "../models";

export const marketIntelRouter = createRouter({
  /** Per-sport PM model state + enable toggles (dashboard header table). */
  sportModels: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(pmSportModels);
    const bySport = new Map(rows.map((r) => [r.sportCode, r] as const));
    // stable sport order, filling any missing with a default shell
    return SPORT_ORDER.map((code) => {
      const r = bySport.get(code);
      return {
        sportCode: code,
        enabled: r?.enabled ?? true,
        hasCoverage: r?.hasCoverage ?? false,
        fusionWeight: r ? parseFloat(r.fusionWeight) : 0,
        lifecycle: r?.lifecycle ?? "collecting",
        forwardSample: r?.forwardSample ?? 0,
      };
    });
  }),

  /** Toggle a sport's PM intelligence on/off (independent control, §163). */
  setSportEnabled: adminQuery
    .input(z.object({ sportCode: z.string().min(2).max(16), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const code = input.sportCode.toUpperCase();
      await db
        .insert(pmSportModels)
        .values({ sportCode: code, enabled: input.enabled })
        .onDuplicateKeyUpdate({ set: { enabled: input.enabled, updatedAt: new Date() } });
      invalidateFusionWeightCache();
      return { sportCode: code, enabled: input.enabled };
    }),

  /** A-vs-B-vs-C performance report by sport+market (Phase 4). */
  fusionReport: adminQuery.query(async () => {
    const [report, counts] = await Promise.all([fusionReport(), fusionShadowCounts()]);
    return { report, counts };
  }),

  /** Recent fusion weight changes with their evidence (audit trail, §182). */
  weightLog: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(fusionWeightLog)
      .orderBy(desc(fusionWeightLog.id))
      .limit(50);
    return rows.map((r) => ({
      id: r.id,
      sportCode: r.sportCode,
      market: r.market,
      prevWeight: parseFloat(r.prevWeight),
      nextWeight: parseFloat(r.nextWeight),
      evidence: safeJson(r.evidence),
      createdAt: r.createdAt,
    }));
  }),

  /** Latest intel snapshot per event (the dashboard's live board). */
  latestSnapshots: adminQuery
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(pmIntelSnapshots)
        .orderBy(desc(pmIntelSnapshots.id))
        .limit(input?.limit ?? 50);
      return rows.map((r) => ({ id: r.id, capturedAt: r.capturedAt, ...safeJson(r.features) }));
    }),

  /** Live A/B/C read for a single event+market (dashboard drill-down). */
  eventRead: adminQuery
    .input(z.object({
      eventId: z.number(),
      sportCode: z.string(),
      market: z.enum(["moneyline", "spread", "total"]),
      selection: z.string(),
    }))
    .query(async ({ input }) => {
      const features = await extractIntelFeatures(
        input.eventId, input.market, input.selection, input.sportCode,
      );
      const sportRead = features ? runSportPmModel(input.sportCode, features) : null;
      const fw = await getFusionWeight(input.sportCode, input.market);
      return {
        features,
        sportRead,
        fusionWeight: fw.weight,
        lifecycle: fw.lifecycle,
        enabled: fw.enabled,
      };
    }),

  /** Recent shadow predictions with their A/B/C probabilities (Phase 5 board). */
  shadowBoard: adminQuery
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(fusionShadow)
        .orderBy(desc(fusionShadow.id))
        .limit(input?.limit ?? 50);
      return rows.map((r) => ({
        id: r.id,
        pickId: r.pickId,
        eventId: r.eventId,
        sportCode: r.sportCode,
        market: r.market,
        selection: r.selection,
        probA: parseFloat(r.probA),
        probB: r.probB === null ? null : parseFloat(r.probB),
        probC: parseFloat(r.probC),
        weightUsed: parseFloat(r.weightUsed),
        outcome: r.outcome,
        placedAt: r.placedAt,
        settledAt: r.settledAt,
      }));
    }),
});

function safeJson(s: string | null | undefined): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

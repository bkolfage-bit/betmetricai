/**
 * Models router — quantitative model registry, health, calibration,
 * backtests, edge-score weights, and the retraining validation pipeline.
 *
 * Admin actions follow §21: retraining runs validation gates and queues
 * for ADMIN REVIEW. Nothing auto-deploys to production.
 */
import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  adminConfig,
  alerts,
  backtests,
  calibrationResults,
  modelHealth,
  models,
  pickHistory,
  sports,
} from "@db/schema";
import { desc, eq, sql } from "drizzle-orm";
import {
  getEdgeWeights,
  setEdgeWeights,
  type EdgeWeights,
} from "../engine/edge-score";
import { SPORT_MODELS, SPORT_ORDER } from "../models";

const MODEL_STATUSES = ["production", "candidate", "disabled"] as const;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const modelsRouter = createRouter({
  /** Registry of all sport models with their latest health status. */
  list: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(models);
    const healthRows = await db
      .select()
      .from(modelHealth)
      .orderBy(desc(modelHealth.id));
    const latestHealth = new Map<string, (typeof healthRows)[number]>();
    for (const h of healthRows) {
      if (!latestHealth.has(h.modelId)) latestHealth.set(h.modelId, h);
    }
    const order = new Map<string, number>(SPORT_ORDER.map((c, i) => [c, i]));
    return rows
      .map((m) => {
        const runtime = SPORT_MODELS[m.sportCode as keyof typeof SPORT_MODELS];
        const health = latestHealth.get(m.modelId) ?? null;
        return {
          modelId: m.modelId,
          sportCode: m.sportCode,
          name: m.name,
          modelVersion: m.modelVersion,
          featureVersion: m.featureVersion,
          trainedAt: m.trainedAt,
          trainingPeriod: m.trainingPeriod,
          validationPeriod: m.validationPeriod,
          status: m.status,
          components: parseJson(m.components, [] as Array<{ name: string; weight: number }>),
          healthStatus: health?.status ?? "DISABLED",
          healthCheckedAt: health?.updatedAt ?? null,
          pickMarkets: runtime?.pickMarkets ?? [],
          simsPerEvent: parseJson(m.metrics, { simsPerEvent: 0 } as { simsPerEvent?: number })
            .simsPerEvent ?? 0,
        };
      })
      .sort((a, b) => (order.get(a.sportCode) ?? 99) - (order.get(b.sportCode) ?? 99));
  }),

  /** Full model detail: components, metrics, calibration, backtests, health checks. */
  detail: publicQuery
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(models).where(eq(models.modelId, input.modelId));
      if (rows.length === 0) return null;
      const m = rows[0];
      const runtime = SPORT_MODELS[m.sportCode as keyof typeof SPORT_MODELS];

      const calib = await db
        .select()
        .from(calibrationResults)
        .where(eq(calibrationResults.modelId, m.modelId))
        .orderBy(desc(calibrationResults.computedAt));

      const bt = await db
        .select()
        .from(backtests)
        .where(eq(backtests.modelId, m.modelId))
        .orderBy(desc(backtests.computedAt));

      const healthRows = await db
        .select()
        .from(modelHealth)
        .where(eq(modelHealth.modelId, m.modelId))
        .orderBy(desc(modelHealth.id))
        .limit(1);

      return {
        model: {
          ...m,
          components: parseJson(m.components, [] as Array<{ name: string; weight: number }>),
          metrics: parseJson(m.metrics, {} as Record<string, unknown>),
        },
        runtime: runtime
          ? {
              components: runtime.components,
              pickMarkets: runtime.pickMarkets,
              live: runtime.live,
            }
          : null,
        calibration: calib.map((c) => ({
          ...c,
          buckets: parseJson(c.buckets, [] as Array<{
            p: number;
            freq: number;
            n: number;
            lo: number;
            hi: number;
          }>),
        })),
        backtests: bt.map((b) => ({
          ...b,
          byEdge: parseJson(b.byEdge, [] as Array<{
            band: string;
            picks: number;
            winRate: number;
            roi: number;
          }>),
        })),
        health: healthRows[0]
          ? {
              ...healthRows[0],
              checks: parseJson(healthRows[0].checks, [] as Array<{
                name: string;
                ok: boolean;
                detail: string;
              }>),
            }
          : null,
      };
    }),

  /** Edge-score weights per sport (public so pick cards can explain scores). */
  edgeWeights: publicQuery
    .input(z.object({ sportCode: z.string().optional() }).optional())
    .query(async ({ input }) => {
      if (input?.sportCode) {
        return { [input.sportCode]: await getEdgeWeights(input.sportCode) };
      }
      const out: Record<string, EdgeWeights> = {};
      for (const code of SPORT_ORDER) out[code] = await getEdgeWeights(code);
      return out;
    }),

  /** Admin: update edge-score weights for one sport (persisted, cache-busted). */
  updateEdgeWeights: adminQuery
    .input(
      z.object({
        sportCode: z.string(),
        weights: z.object({
          probEdge: z.number().min(0).max(1),
          ev: z.number().min(0).max(1),
          confidence: z.number().min(0).max(0.5),
          agreement: z.number().min(0).max(0.5),
          lineStability: z.number().min(0).max(0.5),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      await setEdgeWeights(input.sportCode, input.weights);
      const db = getDb();
      await db.insert(alerts).values({
        type: "system",
        title: "Edge weights updated",
        message: `${input.sportCode} edge-score weights updated by admin.`,
      });
      return { ok: true, weights: await getEdgeWeights(input.sportCode) };
    }),

  /** Admin: change a model's lifecycle status (production / candidate / disabled). */
  updateStatus: adminQuery
    .input(z.object({ modelId: z.string(), status: z.enum(MODEL_STATUSES) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(models)
        .set({ status: input.status })
        .where(eq(models.modelId, input.modelId));
      if (input.status === "disabled") {
        await db.insert(modelHealth).values({
          modelId: input.modelId,
          status: "DISABLED",
          checks: JSON.stringify([
            { name: "Admin action", ok: false, detail: "Model disabled by administrator." },
          ]),
        });
      }
      await db.insert(alerts).values({
        type: "system",
        title: "Model status changed",
        message: `${input.modelId} → ${input.status} (admin action).`,
      });
      return { ok: true };
    }),

  /**
   * Admin: request retraining. Runs the production validation pipeline
   * (§21) against the data we actually have; if every gate passes the
   * request is queued for ADMIN REVIEW — never auto-deployed.
   */
  requestRetrain: adminQuery
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(models).where(eq(models.modelId, input.modelId));
      if (rows.length === 0) throw new Error("Unknown model");
      const m = rows[0];

      const gates: Array<{ name: string; ok: boolean; detail: string }> = [];

      // Gate 1: DATA VALIDATION — enough graded history to train against
      const hist = await db
        .select({ n: sql<number>`count(*)` })
        .from(pickHistory)
        .where(eq(pickHistory.sportCode, m.sportCode));
      const histN = Number(hist[0]?.n ?? 0);
      gates.push({
        name: "Data volume",
        ok: histN >= 30,
        detail: `${histN} graded historical picks (minimum 30)`,
      });

      // Gate 2: CALIBRATION — current model calibration within tolerance
      const calib = await db
        .select()
        .from(calibrationResults)
        .where(eq(calibrationResults.modelId, m.modelId))
        .orderBy(desc(calibrationResults.computedAt));
      const worstEce = calib.reduce((mx, c) => Math.max(mx, parseFloat(c.ece)), 0);
      gates.push({
        name: "Calibration (ECE < 0.20)",
        ok: calib.length > 0 && worstEce < 0.2,
        detail:
          calib.length > 0
            ? `worst-market ECE ${worstEce.toFixed(3)} across ${calib.length} markets`
            : "no calibration results on record",
      });

      // Gate 3: HEALTH — model not DISABLED
      const healthRows = await db
        .select()
        .from(modelHealth)
        .where(eq(modelHealth.modelId, m.modelId))
        .orderBy(desc(modelHealth.id))
        .limit(1);
      const healthStatus = healthRows[0]?.status ?? "DISABLED";
      gates.push({
        name: "Model health",
        ok: healthStatus !== "DISABLED",
        detail: `current status ${healthStatus}`,
      });

      const passed = gates.every((g) => g.ok);

      // queue for admin review (never auto-deploy)
      const db2 = getDb();
      const existing = await db2
        .select()
        .from(adminConfig)
        .where(eq(adminConfig.key, "retrain_requests"));
      const queue = parseJson(existing[0]?.value ?? null, [] as Array<{
        modelId: string;
        requestedAt: string;
        gates: typeof gates;
        review: "pending" | "approved" | "rejected";
      }>);
      queue.push({
        modelId: m.modelId,
        requestedAt: new Date().toISOString(),
        gates,
        review: "pending",
      });
      await db2
        .insert(adminConfig)
        .values({ key: "retrain_requests", value: JSON.stringify(queue) })
        .onDuplicateKeyUpdate({ set: { value: JSON.stringify(queue) } });

      await db2.insert(alerts).values({
        type: "system",
        title: passed ? "Retrain validation passed" : "Retrain validation failed",
        message: passed
          ? `${m.modelId}: all validation gates passed — queued for admin review. Candidate models are never auto-deployed.`
          : `${m.modelId}: validation gates failed (${gates.filter((g) => !g.ok).map((g) => g.name).join(", ")}).`,
      });

      return { passed, gates, review: "pending" as const };
    }),

  /** Admin: list retrain requests awaiting review. */
  retrainQueue: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(adminConfig)
      .where(eq(adminConfig.key, "retrain_requests"));
    return parseJson(rows[0]?.value ?? null, [] as Array<{
      modelId: string;
      requestedAt: string;
      gates: Array<{ name: string; ok: boolean; detail: string }>;
      review: "pending" | "approved" | "rejected";
    }>);
  }),

  /** Sport metadata for filter rails (code, name, status, event counts). */
  sports: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(sports);
    const order = new Map<string, number>(SPORT_ORDER.map((c, i) => [c, i]));
    return rows.sort(
      (a, b) => (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99),
    );
  }),
});

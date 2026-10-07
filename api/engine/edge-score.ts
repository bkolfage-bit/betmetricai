/**
 * Engine / edge score (§16) — standardized 0–100 AI Edge Score.
 *
 * Blends probability edge and expected value into a single value metric,
 * maps it onto 0–100 (50 = no edge), then adjusts for model confidence,
 * model agreement, line stability and data freshness/quality.
 *
 * Weights are configurable per sport from the admin dashboard
 * (admin_config key `edge_weights`).
 */
import { getDb } from "../queries/connection";
import { adminConfig } from "@db/schema";
import { eq } from "drizzle-orm";

export interface EdgeWeights {
  /** blend between probability edge and EV (must sum to 1) */
  probEdge: number;
  ev: number;
  /** multiplicative boosts */
  confidence: number;
  agreement: number;
  lineStability: number;
}

export const DEFAULT_EDGE_WEIGHTS: EdgeWeights = {
  probEdge: 0.6,
  ev: 0.4,
  confidence: 0.12,
  agreement: 0.06,
  lineStability: 0.05,
};

let cache: { at: number; map: Record<string, EdgeWeights> } | null = null;

export async function getEdgeWeights(sportCode: string): Promise<EdgeWeights> {
  if (!cache || Date.now() - cache.at > 30_000) {
    const db = getDb();
    const rows = await db
      .select()
      .from(adminConfig)
      .where(eq(adminConfig.key, "edge_weights"));
    let map: Record<string, EdgeWeights> = {};
    try {
      map = rows.length ? JSON.parse(rows[0].value) : {};
    } catch {
      map = {};
    }
    cache = { at: Date.now(), map };
  }
  return { ...DEFAULT_EDGE_WEIGHTS, ...(cache.map[sportCode] ?? {}) };
}

export async function setEdgeWeights(sportCode: string, w: EdgeWeights) {
  const db = getDb();
  const rows = await db
    .select()
    .from(adminConfig)
    .where(eq(adminConfig.key, "edge_weights"));
  let map: Record<string, EdgeWeights> = {};
  try {
    map = rows.length ? JSON.parse(rows[0].value) : {};
  } catch {
    map = {};
  }
  map[sportCode] = w;
  await db
    .insert(adminConfig)
    .values({ key: "edge_weights", value: JSON.stringify(map) })
    .onDuplicateKeyUpdate({ set: { value: JSON.stringify(map) } });
  cache = null;
}

export function aiEdgeScoreEx(input: {
  probEdge: number;
  ev: number;
  confidence: number; // 0..1
  agreementFrac: number; // 0..1 — model agreement (§17)
  lineStability: number; // 0..1
  dataQuality: number; // 0..1 — freshness/feed quality
  weights: EdgeWeights;
}): number {
  const w = input.weights;
  const blendSum = w.probEdge + w.ev || 1;
  const v = (w.probEdge * input.probEdge + w.ev * input.ev) / blendSum;
  const base = v >= 0 ? 50 + 350 * v : 50 + 900 * v;
  const factor =
    0.9 +
    input.confidence * w.confidence +
    input.agreementFrac * w.agreement +
    input.lineStability * w.lineStability +
    (input.dataQuality - 0.9) * 0.1;
  return Math.max(0, Math.min(100, Math.round(base * factor)));
}

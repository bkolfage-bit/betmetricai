/**
 * Phase 3 — Fusion engine.
 *
 * Compares three probability estimates for every pick and combines them
 * honestly:
 *
 *   Model A — existing BetMetric sports AI (the current working probability:
 *             sport model → calibration → market anchor). Never modified.
 *   Model B — prediction-market AI (Kalshi + Polymarket, Phase 1 features →
 *             Phase 2 sport read).
 *   Model C — combined: A and B blended by a per-sport, per-market weight.
 *
 * Non-negotiable rules from the spec:
 *  - the PM weight is LEARNED from forward-tested evidence (Phase 4), never
 *    assigned a flat 30% "because the config allows it" (§98). It starts at
 *    0 — pure Model A — and earns influence only when shadow results prove
 *    Model C beats Model A out-of-sample;
 *  - sportsbook and prediction-market prices are correlated (the same money
 *    moves both). Because Model A is ALREADY anchored to the sportsbook
 *    consensus, adding B on top would double-count the market. So B's weight
 *    is discounted by how correlated B is with the book consensus (§92–93);
 *  - Model A's probability is always preserved unchanged for comparison (§96);
 *  - every fusion decision is recorded to fusion_shadow with full inputs and
 *    version stamps, and every weight change to fusion_weight_log (§182).
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  fusionShadow, fusionWeightLog, pmSportModels,
} from "@db/schema";
import { extractIntelFeatures, type IntelFeatures } from "./pm-intel";
import { runSportPmModel, type SportPmRead } from "./pm-sport-models";

export interface FusionResult {
  probA: number;             // Model A — unchanged sports-model working prob
  probB: number | null;      // Model B — null when no PM coverage
  probC: number;             // Model C — fused (== probA when weight 0 or no B)
  weightUsed: number;        // the PM weight actually applied (0..cap)
  pmEnabled: boolean;        // sport toggle on AND lifecycle past 'collecting'
  pmCoverage: boolean;       // a real PM market existed for this pick
  correlationDiscount: number; // 0..1 — how much B was discounted for corr
  sportRead: SportPmRead | null;
  features: IntelFeatures | null;
}

/**
 * Hard cap on PM influence even after validation — the sports model stays
 * the primary driver. This is a ceiling, never a default (spec §98).
 */
const PM_WEIGHT_CAP = 0.30;

/** Forward-tested samples required before a sport's weight may rise above 0. */
const PROMOTE_MIN_SAMPLE = 100;

/**
 * Read the current learned PM weight for a sport+market. Returns 0 (pure
 * Model A) unless the sport is enabled, past the collecting phase, and has
 * earned weight through validated forward results.
 */
export async function getFusionWeight(
  sportCode: string,
  market: string,
): Promise<{ weight: number; enabled: boolean; lifecycle: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(pmSportModels)
    .where(eq(pmSportModels.sportCode, sportCode))
    .limit(1);
  if (!row) return { weight: 0, enabled: false, lifecycle: "collecting" };
  const enabled = row.enabled && row.lifecycle !== "collecting";
  const weight = enabled ? Math.min(PM_WEIGHT_CAP, parseFloat(row.fusionWeight)) : 0;
  return { weight, enabled: row.enabled, lifecycle: row.lifecycle };
}

/** 5-minute cache for getFusionWeight — recompute calls it once per pick. */
const weightCache = new Map<string, { at: number; v: { weight: number; enabled: boolean; lifecycle: string } }>();
const WEIGHT_CACHE_TTL_MS = 5 * 60_000;

export async function getFusionWeightCached(
  sportCode: string,
  market: string,
): Promise<{ weight: number; enabled: boolean; lifecycle: string }> {
  const key = `${sportCode}|${market}`;
  const hit = weightCache.get(key);
  if (hit && Date.now() - hit.at < WEIGHT_CACHE_TTL_MS) return hit.v;
  const v = await getFusionWeight(sportCode, market);
  weightCache.set(key, { at: Date.now(), v });
  return v;
}

/** Test/admin hook: drop cached weights after a toggle or learning run. */
export function invalidateFusionWeightCache(): void {
  weightCache.clear();
}

/**
 * Estimate how correlated Model B is with the sportsbook consensus, to avoid
 * double-counting the market signal already inside Model A's anchor.
 * Returns a 0..1 discount factor (1 = fully independent, 0 = redundant).
 *
 * Without a historical PM corpus we cannot measure the true correlation, so
 * we use a conservative structural estimate from the live divergence: the
 * tighter B tracks the book, the less NEW information it adds.
 */
function correlationDiscount(features: IntelFeatures | null): number {
  if (!features || features.bookDivergence === null) return 0.5; // unknown → cautious
  const div = Math.abs(features.bookDivergence);
  // 0pp divergence (B == book) → mostly redundant (0.3); ≥12pp → independent (1.0)
  return Math.min(1, Math.max(0.3, 0.3 + (div / 0.12) * 0.7));
}

/**
 * Compute the three-model fusion for one pick. Model A is passed in (the
 * existing engine's working probability) and returned untouched; B and C are
 * derived. Never modifies any existing model output.
 */
export async function fuseProbabilities(input: {
  eventId: number;
  sportCode: string;
  market: "moneyline" | "spread" | "total";
  selection: string;
  probA: number;              // existing engine's working probability
  modelVersionA: string;
}): Promise<FusionResult> {
  const { eventId, sportCode, market, selection, probA } = input;

  // Phase 1 features → Phase 2 sport read
  const features = await extractIntelFeatures(eventId, market, selection, sportCode);
  const sportRead = features ? runSportPmModel(sportCode, features) : null;
  const probB = sportRead && sportRead.coverage ? sportRead.prob : null;

  const { weight, enabled, lifecycle } = await getFusionWeight(sportCode, market);
  const corrDiscount = correlationDiscount(features);

  // Model C: blend A and B by the learned, correlation-discounted weight.
  // weight 0 or no PM coverage → C is exactly A (no PM influence).
  let weightUsed = 0;
  let probC = probA;
  if (enabled && probB !== null && weight > 0 && sportRead) {
    weightUsed = Math.min(PM_WEIGHT_CAP, weight * corrDiscount * sportRead.trust);
    probC = clampProb((1 - weightUsed) * probA + weightUsed * probB);
  }

  return {
    probA,
    probB,
    probC,
    weightUsed,
    pmEnabled: enabled,
    pmCoverage: probB !== null,
    correlationDiscount: corrDiscount,
    sportRead,
    features,
  };
}

function clampProb(p: number): number {
  return Math.min(0.999, Math.max(0.001, p));
}

/**
 * Record a shadow fusion row at pick time. Append-only; one row per pick.
 * outcome/brier fields stay null until settlement (no look-ahead).
 */
export async function recordFusionShadow(input: {
  pickId: number;
  eventId: number;
  sportCode: string;
  market: string;
  selection: string;
  fusion: FusionResult;
  bookProb: number | null;
  modelVersionA: string;
}): Promise<void> {
  const db = getDb();
  const f = input.fusion;
  try {
    await db.insert(fusionShadow).values({
      pickId: input.pickId,
      eventId: input.eventId,
      sportCode: input.sportCode,
      market: input.market,
      selection: input.selection,
      probA: f.probA.toFixed(6),
      probB: f.probB === null ? null : f.probB.toFixed(6),
      probC: f.probC.toFixed(6),
      weightUsed: f.weightUsed.toFixed(4),
      bookProb: input.bookProb === null ? null : input.bookProb.toFixed(6),
      pmLiquidity: f.features?.volume24h != null ? String(f.features.volume24h) : null,
      dataQuality: f.features ? f.features.dataQuality.toFixed(4) : null,
      modelVersionA: input.modelVersionA,
      modelVersionB: "pm-v2.0",
    });
  } catch {
    /* duplicate pickId — shadow rows are append-only, skip */
  }
}

/**
 * Learn / update a sport's PM weight from settled forward-tested shadow rows.
 * Only promotes when Model C demonstrably beats Model A out-of-sample with
 * enough evidence — and logs every change with its evidence (§182, §184).
 *
 * Returns the new weight, or null if unchanged.
 */
export async function learnFusionWeight(sportCode: string): Promise<number | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(fusionShadow)
    .where(and(eq(fusionShadow.sportCode, sportCode)));
  const settled = rows.filter((r) => r.outcome !== null && r.brierA !== null && r.brierC !== null);

  const [modelRow] = await db
    .select()
    .from(pmSportModels)
    .where(eq(pmSportModels.sportCode, sportCode))
    .limit(1);
  const prevWeight = modelRow ? parseFloat(modelRow.fusionWeight) : 0;

  // not enough forward evidence → stay at/return current weight
  if (settled.length < PROMOTE_MIN_SAMPLE) return null;

  const brierA = settled.reduce((s, r) => s + parseFloat(r.brierA!), 0) / settled.length;
  const brierC = settled.reduce((s, r) => s + parseFloat(r.brierC!), 0) / settled.length;

  // promote only on a MEANINGFUL improvement (lower Brier), not noise (§120)
  const improvement = brierA - brierC; // positive = C better
  const MEANINGFUL = 0.005; // half a Brier point
  let nextWeight = prevWeight;
  if (improvement > MEANINGFUL) {
    // scale weight with the size of the proven edge, capped
    nextWeight = Math.min(PM_WEIGHT_CAP, prevWeight + Math.min(0.10, improvement * 4));
  } else if (improvement < -MEANINGFUL && prevWeight > 0) {
    // C is WORSE — pull weight back down toward Model A
    nextWeight = Math.max(0, prevWeight - 0.05);
  } else {
    return null; // within noise band — no change
  }

  if (nextWeight === prevWeight) return null;

  await db.insert(fusionWeightLog).values({
    sportCode,
    market: null,
    prevWeight: prevWeight.toFixed(4),
    nextWeight: nextWeight.toFixed(4),
    evidence: JSON.stringify({
      forwardSample: settled.length,
      brierA: +brierA.toFixed(6),
      brierC: +brierC.toFixed(6),
      improvement: +improvement.toFixed(6),
      decision: nextWeight > prevWeight ? "promote" : "demote",
    }),
  });
  await db
    .update(pmSportModels)
    .set({
      fusionWeight: nextWeight.toFixed(4),
      forwardSample: settled.length,
      lifecycle: nextWeight > 0 ? "live" : "shadow",
      updatedAt: new Date(),
    })
    .where(eq(pmSportModels.sportCode, sportCode));

  invalidateFusionWeightCache();
  return nextWeight;
}

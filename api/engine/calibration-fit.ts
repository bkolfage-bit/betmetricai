/**
 * Engine / calibration fitting — gated, holdout-validated probability
 * calibration. Raw model scores are not automatically accurate
 * probabilities, but a calibration layer fitted on a handful of results is
 * worse than none at all. The gates here implement the accepted practice:
 *
 *  - n < 100 graded picks → NO correction (variance dominates; Platt would
 *    just fit noise)
 *  - 100 ≤ n < 1000 → Platt scaling (low-variance parametric correction)
 *  - n ≥ 1000 → isotonic regression (non-parametric; only worth it with
 *    enough data to resist overfitting)
 *  - the fit must beat the raw probabilities on a chronological 30%
 *    holdout — an in-sample improvement alone proves nothing
 *
 * Fits are stored per sport in admin_config and applied by the pick engine
 * BEFORE market anchoring. Nothing is applied until the gates pass.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { adminConfig, pickHistory } from "@db/schema";
import { asc } from "drizzle-orm";
import { logLoss, plattFit, plattApply, type ProbOutcome } from "./calibration";

export const CALIB_MIN_SAMPLE = 100;
export const CALIB_ISOTONIC_SAMPLE = 1000;

export interface CalibrationFit {
  method: "platt" | "isotonic";
  /** Platt parameters (method = platt) */
  a?: number;
  b?: number;
  /** isotonic step map: sorted knots p → calibrated q (method = isotonic) */
  map?: Array<{ p: number; q: number }>;
  n: number;
  holdoutLogLoss: number;
  baseLogLoss: number;
  computedAt: string;
}

/* ------------------------- isotonic regression ------------------------- */

/** Pool-adjacent-violators on probability-sorted pairs → monotone step map. */
function isotonicFit(pairs: ProbOutcome[]): Array<{ p: number; q: number }> {
  const sorted = [...pairs].sort((x, y) => x.prob - y.prob);
  // blocks: [sumP, sumW, count, minP, maxP]
  const blocks: Array<{ s: number; n: number; lo: number; hi: number }> = [];
  for (const r of sorted) {
    blocks.push({ s: r.won ? 1 : 0, n: 1, lo: r.prob, hi: r.prob });
    while (blocks.length >= 2) {
      const b2 = blocks[blocks.length - 1];
      const b1 = blocks[blocks.length - 2];
      if (b1.s / b1.n <= b2.s / b2.n) break;
      blocks.splice(blocks.length - 2, 2, {
        s: b1.s + b2.s,
        n: b1.n + b2.n,
        lo: b1.lo,
        hi: b2.hi,
      });
    }
  }
  return blocks.map((b) => ({ p: (b.lo + b.hi) / 2, q: b.s / b.n }));
}

function isotonicApply(map: Array<{ p: number; q: number }>, p: number): number {
  if (map.length === 0) return p;
  if (p <= map[0].p) return map[0].q;
  if (p >= map[map.length - 1].p) return map[map.length - 1].q;
  for (let i = 1; i < map.length; i++) {
    if (p <= map[i].p) {
      const t = (p - map[i - 1].p) / (map[i].p - map[i - 1].p || 1e-9);
      return map[i - 1].q + t * (map[i].q - map[i - 1].q);
    }
  }
  return map[map.length - 1].q;
}

/* ------------------------------ fitting -------------------------------- */

/**
 * Fit a gated calibration correction on chronological graded picks.
 * Returns null unless the fit clears every gate — null means "keep using
 * the raw model probabilities", which is always a safe, honest answer.
 */
export function fitCalibrationGated(pairs: ProbOutcome[]): CalibrationFit | null {
  if (pairs.length < CALIB_MIN_SAMPLE) return null;
  const cut = Math.floor(pairs.length * 0.7);
  const train = pairs.slice(0, cut);
  const test = pairs.slice(cut);
  if (test.length < 20) return null;
  const base = logLoss(test);

  let fit: Omit<CalibrationFit, "n" | "computedAt">;
  if (pairs.length >= CALIB_ISOTONIC_SAMPLE) {
    const map = isotonicFit(train);
    const ll = logLoss(test.map((t) => ({ prob: isotonicApply(map, t.prob), won: t.won })));
    fit = { method: "isotonic", map, holdoutLogLoss: ll, baseLogLoss: base };
  } else {
    const { a, b } = plattFit(train);
    const ll = logLoss(test.map((t) => ({ prob: plattApply(t.prob, { a, b }), won: t.won })));
    fit = { method: "platt", a, b, holdoutLogLoss: ll, baseLogLoss: base };
  }
  // must genuinely generalize: at least a small holdout improvement
  if (!(fit.holdoutLogLoss < fit.baseLogLoss * 0.995)) return null;
  return { ...fit, n: pairs.length, computedAt: new Date().toISOString() };
}

export function applyCalibrationFit(fit: CalibrationFit, p: number): number {
  const c = fit.method === "platt" && fit.a != null && fit.b != null
    ? plattApply(p, { a: fit.a, b: fit.b })
    : fit.method === "isotonic" && fit.map
      ? isotonicApply(fit.map, p)
      : p;
  return Math.min(0.999, Math.max(0.001, c));
}

/* --------------------------- storage / cache --------------------------- */

const fitKey = (sportCode: string) => `calibration_fit:${sportCode}`;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; fit: CalibrationFit | null }>();

export async function getCalibrationFit(sportCode: string): Promise<CalibrationFit | null> {
  const hit = cache.get(sportCode);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.fit;
  const db = getDb();
  const rows = await db.select().from(adminConfig).where(eq(adminConfig.key, fitKey(sportCode)));
  let fit: CalibrationFit | null = null;
  if (rows.length > 0) {
    try {
      fit = JSON.parse(rows[0].value) as CalibrationFit;
    } catch {
      fit = null;
    }
  }
  cache.set(sportCode, { at: Date.now(), fit });
  return fit;
}

/**
 * Re-fit one sport from its full graded history (chronological). Called by
 * the daily maintenance job; the pick engine only ever reads the stored fit.
 * Returns the adopted fit, or null when the gates reject one (any existing
 * stored fit is then cleared — a fit that no longer generalizes is removed,
 * not left in place).
 */
export async function refreshCalibrationFit(sportCode: string): Promise<CalibrationFit | null> {
  const db = getDb();
  const rows = await db
    .select({ modelProb: pickHistory.modelProb, result: pickHistory.result })
    .from(pickHistory)
    .where(eq(pickHistory.sportCode, sportCode))
    .orderBy(asc(pickHistory.placedAt));
  const pairs: ProbOutcome[] = rows
    .filter((r) => r.modelProb != null && r.result !== "push")
    .map((r) => ({ prob: parseFloat(r.modelProb!), won: r.result === "won" }));
  const fit = fitCalibrationGated(pairs);
  await db
    .insert(adminConfig)
    .values({ key: fitKey(sportCode), value: JSON.stringify(fit) })
    .onDuplicateKeyUpdate({ set: { value: JSON.stringify(fit) } });
  cache.delete(sportCode);
  return fit;
}

/** Re-fit every sport that has graded history. */
export async function refreshAllCalibrationFits(): Promise<Record<string, string>> {
  const db = getDb();
  const sports = await db
    .selectDistinct({ sportCode: pickHistory.sportCode })
    .from(pickHistory);
  const report: Record<string, string> = {};
  for (const s of sports) {
    const fit = await refreshCalibrationFit(s.sportCode);
    report[s.sportCode] = fit
      ? `${fit.method} adopted (n=${fit.n}, holdout ${fit.holdoutLogLoss.toFixed(4)} vs raw ${fit.baseLogLoss.toFixed(4)})`
      : "no fit (gates not passed)";
  }
  return report;
}

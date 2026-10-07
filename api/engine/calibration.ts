/**
 * Engine / calibration (§13) — raw model scores are not automatically
 * accurate probabilities. This module measures and corrects calibration:
 * Brier score, log loss, expected calibration error, reliability curves,
 * and Platt scaling fitted on chronological out-of-sample results.
 */

export interface ProbOutcome {
  prob: number; // model probability for the selection
  won: boolean;
}

export function brierScore(pairs: ProbOutcome[]): number {
  if (pairs.length === 0) return NaN;
  return pairs.reduce((s, p) => s + (p.prob - (p.won ? 1 : 0)) ** 2, 0) / pairs.length;
}

export function logLoss(pairs: ProbOutcome[]): number {
  if (pairs.length === 0) return NaN;
  const eps = 1e-12;
  return (
    pairs.reduce((s, p) => {
      const pr = Math.min(1 - eps, Math.max(eps, p.prob));
      return s - (p.won ? Math.log(pr) : Math.log(1 - pr));
    }, 0) / pairs.length
  );
}

export interface ReliabilityBucket {
  p: number; // mean predicted probability in the bucket
  freq: number; // actual win frequency
  n: number;
  lo: number;
  hi: number;
}

/** Reliability curve: predicted probability vs actual outcome frequency. */
export function reliabilityBuckets(pairs: ProbOutcome[], buckets = 10): ReliabilityBucket[] {
  if (pairs.length === 0) return [];
  const out: ReliabilityBucket[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = b / buckets;
    const hi = (b + 1) / buckets;
    const inBucket = pairs.filter(
      (p) => p.prob >= lo && (b === buckets - 1 ? p.prob <= hi : p.prob < hi),
    );
    if (inBucket.length === 0) continue;
    out.push({
      p: inBucket.reduce((s, x) => s + x.prob, 0) / inBucket.length,
      freq: inBucket.filter((x) => x.won).length / inBucket.length,
      n: inBucket.length,
      lo,
      hi,
    });
  }
  return out;
}

/** Expected calibration error from a reliability curve. */
export function expectedCalibrationError(buckets: ReliabilityBucket[]): number {
  const total = buckets.reduce((s, b) => s + b.n, 0);
  if (total === 0) return NaN;
  return buckets.reduce((s, b) => s + (b.n / total) * Math.abs(b.p - b.freq), 0);
}

/**
 * Platt scaling: fit sigmoid parameters (a, b) so that
 * calibrated(p) = 1 / (1 + exp(a * logit(p) + b)) minimizes log loss
 * on the given out-of-sample pairs. Simple grid + gradient search.
 */
export function plattFit(pairs: ProbOutcome[]): { a: number; b: number } {
  if (pairs.length < 20) return { a: 1, b: 0 };
  const logit = (p: number) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
  let best = { a: 1, b: 0 };
  let bestLoss = Infinity;
  for (let a = 0.4; a <= 2.4; a += 0.1) {
    for (let b = -0.8; b <= 0.8; b += 0.05) {
      const calibrated = pairs.map((p) => ({
        prob: 1 / (1 + Math.exp(a * logit(p.prob) + b)),
        won: p.won,
      }));
      const loss = logLoss(calibrated);
      if (loss < bestLoss) {
        bestLoss = loss;
        best = { a: Math.round(a * 100) / 100, b: Math.round(b * 100) / 100 };
      }
    }
  }
  return best;
}

export function plattApply(p: number, params: { a: number; b: number }): number {
  const c = Math.min(0.999, Math.max(0.001, p));
  const logit = Math.log(c / (1 - c));
  return 1 / (1 + Math.exp(params.a * logit + params.b));
}

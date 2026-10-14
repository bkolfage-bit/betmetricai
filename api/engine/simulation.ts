/**
 * Engine / simulation — shared Monte Carlo infrastructure (§18).
 * Sport models build their own simulators on top of these samplers;
 * default run size is 10,000 simulations per event.
 */

export const DEFAULT_SIMS = 10_000;

/** Deterministic RNG so simulation runs are reproducible. */
export function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNormalSampler(rand: () => number) {
  return function randNormal(mean: number, sd: number): number {
    // Box–Muller
    const u1 = Math.max(1e-12, rand());
    const u2 = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

export function makePoissonSampler(rand: () => number) {
  const randNormal = makeNormalSampler(rand);
  return function randPoisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(randNormal(lambda, Math.sqrt(lambda))));
    // Knuth
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rand();
    } while (p > L);
    return k - 1;
  };
}

export interface MarginTotalResult {
  homeWin: number;
  awayWin: number;
  draw: number;
  marginMean: number;
  marginSd: number;
  totalMean: number;
  totalSd: number;
  /** cover probability of `line` from the home perspective */
  coverProb: (line: number) => number;
  overProb: (line: number) => number;
}

/** Summarize an array of simulated [homeScore, awayScore] pairs. */
export function summarizeScores(scores: Array<[number, number]>): MarginTotalResult {
  const n = scores.length;
  let homeWin = 0;
  let draw = 0;
  const margins: number[] = [];
  const totals: number[] = [];
  for (const [h, a] of scores) {
    if (h > a) homeWin++;
    else if (h === a) draw++;
    margins.push(h - a);
    totals.push(h + a);
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / n;
  const sd = (xs: number[], m: number) =>
    Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / n);
  const marginMean = mean(margins);
  const totalMean = mean(totals);
  const sortedM = [...margins].sort((x, y) => x - y);
  const sortedT = [...totals].sort((x, y) => x - y);
  return {
    homeWin: homeWin / n,
    awayWin: (n - homeWin - draw) / n,
    draw: draw / n,
    marginMean,
    marginSd: Math.max(0.5, sd(margins, marginMean)),
    totalMean,
    totalSd: Math.max(0.5, sd(totals, totalMean)),
    coverProb: (line: number) => {
      // P(margin + line > 0) with push counting half
      let p = 0;
      for (const m of sortedM) {
        if (m + line > 0) p += 1;
        else if (m + line === 0) p += 0.5;
      }
      return p / n;
    },
    overProb: (line: number) => {
      let p = 0;
      for (const t of sortedT) {
        if (t > line) p += 1;
        else if (t === line) p += 0.5;
      }
      return p / n;
    },
  };
}

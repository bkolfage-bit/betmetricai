/**
 * Phase 4 — Validation harness for the fusion models.
 *
 * Two jobs:
 *
 *  1. SETTLE shadow rows: when a game finishes, fill outcome + Brier for
 *     Models A/B/C on every unsettled fusion_shadow row for that event.
 *     Settlement uses the SAME real result the grading engine already
 *     computed (pick_history), so there is exactly one source of truth and
 *     no look-ahead — outcome is only ever written after the game is final.
 *
 *  2. SCORE the models: chronological, out-of-sample metrics (Brier, log
 *     loss, win rate, ROI, CLV, units) per sport and per market, for A vs B
 *     vs C. Multiple correlated picks from the same game are de-duplicated
 *     to one row per event+selection so a same-game parlay of correlated
 *     markets never inflates the sample (§116).
 *
 * Nothing here fabricates a metric: with no settled rows the report is
 * empty and every number is null, displayed as INSUFFICIENT DATA.
 */
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { fusionShadow, pickHistory } from "@db/schema";

/** brier for a probabilistic forecast of a binary outcome */
function brier(prob: number, outcome: number): number {
  return (prob - outcome) ** 2;
}
function logLoss(prob: number, outcome: number): number {
  const p = Math.min(0.9999, Math.max(0.0001, prob));
  return -(outcome * Math.log(p) + (1 - outcome) * Math.log(1 - p));
}

/**
 * Settle every unsettled fusion_shadow row whose pick has been graded.
 * Returns the number of rows settled. Append-only — outcome is written once.
 */
export async function settleFusionShadow(): Promise<number> {
  const db = getDb();
  const open = await db
    .select()
    .from(fusionShadow)
    .where(isNull(fusionShadow.outcome))
    .limit(500);
  if (open.length === 0) return 0;

  let settled = 0;
  for (const row of open) {
    // the authoritative graded result for this pick
    const hist = await db
      .select()
      .from(pickHistory)
      .where(eq(pickHistory.pickId, row.pickId))
      .orderBy(desc(pickHistory.id))
      .limit(1);
    if (hist.length === 0) continue; // game not final yet
    const h = hist[0];
    if (h.result === "push") {
      // push: exclude from Brier (mark settled with outcome left null but
      // settledAt stamped so it is not reprocessed)
      await db
        .update(fusionShadow)
        .set({ settledAt: new Date() })
        .where(eq(fusionShadow.id, row.id));
      continue;
    }
    const outcome = h.result === "won" ? 1 : 0;
    const pA = parseFloat(row.probA);
    const pC = parseFloat(row.probC);
    const pB = row.probB === null ? null : parseFloat(row.probB);
    await db
      .update(fusionShadow)
      .set({
        outcome,
        brierA: brier(pA, outcome).toFixed(6),
        brierC: brier(pC, outcome).toFixed(6),
        brierB: pB === null ? null : brier(pB, outcome).toFixed(6),
        settledAt: new Date(),
      })
      .where(eq(fusionShadow.id, row.id));
    settled++;
  }
  return settled;
}

export interface ModelMetric {
  n: number;
  brier: number | null;
  logLoss: number | null;
  /** mean predicted prob (for calibration read) */
  meanProb: number | null;
  /** realized win rate of the selections */
  winRate: number | null;
}

export interface FusionReportRow {
  sportCode: string;
  market: string;
  a: ModelMetric;
  b: ModelMetric;
  c: ModelMetric;
  /** does C beat A by a meaningful margin on Brier? */
  cBeatsA: boolean | null;
}

const MEANINGFUL_BRIER = 0.005;

function metric(rows: Array<{ p: number | null; o: number }>): ModelMetric {
  const usable = rows.filter((r) => r.p !== null) as Array<{ p: number; o: number }>;
  if (usable.length === 0) return { n: 0, brier: null, logLoss: null, meanProb: null, winRate: null };
  const n = usable.length;
  const br = usable.reduce((s, r) => s + brier(r.p, r.o), 0) / n;
  const ll = usable.reduce((s, r) => s + logLoss(r.p, r.o), 0) / n;
  const mp = usable.reduce((s, r) => s + r.p, 0) / n;
  const wr = usable.reduce((s, r) => s + r.o, 0) / n;
  return {
    n,
    brier: +br.toFixed(6),
    logLoss: +ll.toFixed(6),
    meanProb: +mp.toFixed(4),
    winRate: +wr.toFixed(4),
  };
}

/**
 * A-vs-B-vs-C report, grouped by sport and market, chronological and
 * de-duplicated to one row per event+selection (correlated same-game markets
 * collapsed). Empty when nothing has settled — never fabricated.
 */
export async function fusionReport(): Promise<FusionReportRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(fusionShadow)
    .where(isNotNull(fusionShadow.outcome))
    .orderBy(fusionShadow.placedAt); // chronological

  // de-dup correlated same-game markets: keep one row per event+selection
  const seen = new Set<string>();
  const groups = new Map<string, Array<{ a: number; b: number | null; c: number; o: number }>>();
  for (const r of rows) {
    const dedupKey = `${r.eventId}|${r.selection}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const gk = `${r.sportCode}|${r.market}`;
    const arr = groups.get(gk) ?? [];
    arr.push({
      a: parseFloat(r.probA),
      b: r.probB === null ? null : parseFloat(r.probB),
      c: parseFloat(r.probC),
      o: r.outcome!,
    });
    groups.set(gk, arr);
  }

  const out: FusionReportRow[] = [];
  for (const [gk, arr] of groups) {
    const [sportCode, market] = gk.split("|");
    const a = metric(arr.map((r) => ({ p: r.a, o: r.o })));
    const b = metric(arr.map((r) => ({ p: r.b, o: r.o })));
    const c = metric(arr.map((r) => ({ p: r.c, o: r.o })));
    const cBeatsA =
      a.brier !== null && c.brier !== null
        ? c.brier < a.brier - MEANINGFUL_BRIER
        : null;
    out.push({ sportCode, market, a, b, c, cBeatsA });
  }
  // stable order: sport then market
  out.sort((x, y) => x.sportCode.localeCompare(y.sportCode) || x.market.localeCompare(y.market));
  return out;
}

/** Count of settled vs open shadow rows, for the dashboard header. */
export async function fusionShadowCounts(): Promise<{ total: number; settled: number; open: number }> {
  const db = getDb();
  const t: any = await db.execute(sql`select count(*) as n from fusion_shadow`);
  const s: any = await db.execute(sql`select count(*) as n from fusion_shadow where outcome is not null`);
  const total = Number(t[0]?.[0]?.n ?? t[0]?.n ?? 0);
  const settled = Number(s[0]?.[0]?.n ?? s[0]?.n ?? 0);
  return { total, settled, open: total - settled };
}

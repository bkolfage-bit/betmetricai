import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { pickHistory } from "@db/schema";
import { asc } from "drizzle-orm";
import { americanPayout } from "../lib/edge";

function summarize(rows: Array<typeof pickHistory.$inferSelect>) {
  const wins = rows.filter((r) => r.result === "won").length;
  const losses = rows.filter((r) => r.result === "lost").length;
  const pushes = rows.filter((r) => r.result === "push").length;
  const decided = wins + losses;
  const units = rows.reduce((s, r) => s + parseFloat(r.units), 0);
  // stake: 1 unit per bet (flat staking), pushes stake 0 risk resolved
  const staked = decided; // 1u per decided bet
  const roi = staked > 0 ? units / staked : 0;
  const clvs = rows.map((r) => parseFloat(r.clv));
  const avgClv = clvs.length ? clvs.reduce((s, x) => s + x, 0) / clvs.length : 0;
  const posClv = clvs.length ? clvs.filter((x) => x > 0).length / clvs.length : 0;
  // no-vig CLV over the rows where it could be computed honestly
  const nv = rows.filter((r) => r.clvNoVig !== null).map((r) => parseFloat(r.clvNoVig!));
  const avgClvNoVig = nv.length ? nv.reduce((s, x) => s + x, 0) / nv.length : null;
  const posNv = nv.length ? nv.filter((x) => x > 0).length / nv.length : null;
  // model-vs-market Brier: our published probability vs the no-vig closing
  // fair probability, scored against what actually happened. Lower is
  // better; beating the market's number is the point of the exercise.
  const scored = rows.filter(
    (r) => r.modelProb !== null && r.closeFairProb !== null && r.result !== "push",
  );
  const brier = (get: (r: (typeof scored)[number]) => number) =>
    scored.length
      ? scored.reduce((s, r) => s + (get(r) - (r.result === "won" ? 1 : 0)) ** 2, 0) / scored.length
      : null;
  const modelBrier = brier((r) => parseFloat(r.modelProb!));
  const marketBrier = brier((r) => parseFloat(r.closeFairProb!));
  return {
    total: rows.length,
    wins,
    losses,
    pushes,
    winRate: decided > 0 ? wins / decided : 0,
    roi,
    units,
    avgClv,
    posClvPct: posClv,
    avgClvNoVig,
    posClvNoVigPct: posNv,
    noVigSample: nv.length,
    modelBrier,
    marketBrier,
    brierSample: scored.length,
  };
}

export const performanceRouter = createRouter({
  /** Public, auditable AI performance. Losing picks are never hidden. */
  summary: publicQuery
    .input(z.object({ sport: z.string().optional() }).optional())
    .query(async ({ input }) => {
    const db = getDb();
    const all = await db
      .select()
      .from(pickHistory)
      .orderBy(asc(pickHistory.placedAt));
    const rows = input?.sport ? all.filter((r) => r.sportCode === input.sport) : all;

    const overall = summarize(rows);

    const bySport = new Map<string, typeof all>();
    for (const r of all) {
      const arr = bySport.get(r.sportCode) ?? [];
      arr.push(r);
      bySport.set(r.sportCode, arr);
    }
    const sports = [...bySport.entries()].map(([sportCode, rs]) => ({
      sportCode,
      ...summarize(rs),
    }));

    const byMarket = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byMarket.get(r.market) ?? [];
      arr.push(r);
      byMarket.set(r.market, arr);
    }
    const markets = [...byMarket.entries()].map(([market, rs]) => ({
      market,
      ...summarize(rs),
    }));

    const byMonth = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.placedAt.getFullYear()}-${String(r.placedAt.getMonth() + 1).padStart(2, "0")}`;
      const arr = byMonth.get(key) ?? [];
      arr.push(r);
      byMonth.set(key, arr);
    }
    const months = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, rs]) => ({ month, ...summarize(rs) }));

    // cumulative units curve
    let cum = 0;
    let peak = 0;
    let maxDrawdown = 0;
    const curve = rows.map((r) => {
      cum += parseFloat(r.units);
      peak = Math.max(peak, cum);
      maxDrawdown = Math.max(maxDrawdown, peak - cum);
      return { at: r.placedAt, units: Math.round(cum * 100) / 100 };
    });

    return {
      overall: { ...overall, maxDrawdown },
      sports,
      markets,
      months,
      curve,
      recent: rows.slice(-20).reverse(),
    };
  }),
});

/** Payout helper re-exported for parlay math on the server. */
export function parlayDecimal(legs: Array<{ odds: number }>): number {
  return legs.reduce((acc, l) => acc * (1 + americanPayout(l.odds)), 1);
}

/**
 * Engine / guardrails — per-sport automatic kill switch driven by realized
 * closing-line value. CLV is the market's verdict on whether our published
 * prices were good; a sport whose picks persistently lose to the close is
 * one where the model currently has no edge, and the honest response is to
 * demand MORE edge before publishing, not to keep firing.
 *
 * The guardrail reads the sport's most recent graded picks (no-vig CLV,
 * falling back to raw CLV for older rows) and raises the minimum EV a pick
 * must have to keep its status in that sport. It never edits history and
 * never hides a graded pick — it only gates NEW evaluations. Results are
 * cached briefly so the pick engine doesn't re-query per pick.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { pickHistory } from "@db/schema";

/** Minimum graded picks before the guardrail is allowed to act. */
const MIN_SAMPLE = 30;
/** How many recent graded picks the guardrail evaluates. */
const WINDOW = 50;
/** Guardrail states: average CLV below each rung raises the EV floor. */
const RUNGS: Array<{ avgClvBelow: number; minEvBoost: number }> = [
  { avgClvBelow: -3.0, minEvBoost: 0.04 },
  { avgClvBelow: -2.0, minEvBoost: 0.02 },
  { avgClvBelow: -1.0, minEvBoost: 0.01 },
];

export interface SportGuardrail {
  sportCode: string;
  sample: number;
  avgClv: number | null;
  /** additional minimum EV required on top of the global threshold */
  minEvBoost: number;
  active: boolean;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; g: SportGuardrail }>();

export async function sportGuardrail(sportCode: string): Promise<SportGuardrail> {
  const hit = cache.get(sportCode);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.g;

  const db = getDb();
  const rows = await db
    .select({ clv: pickHistory.clv, clvNoVig: pickHistory.clvNoVig })
    .from(pickHistory)
    .where(eq(pickHistory.sportCode, sportCode))
    .orderBy(desc(pickHistory.placedAt))
    .limit(WINDOW);

  const clvs = rows.map((r) => parseFloat(r.clvNoVig ?? r.clv));
  let g: SportGuardrail;
  if (clvs.length < MIN_SAMPLE) {
    g = { sportCode, sample: clvs.length, avgClv: null, minEvBoost: 0, active: false };
  } else {
    const avg = clvs.reduce((s, x) => s + x, 0) / clvs.length;
    let boost = 0;
    for (const r of RUNGS) {
      if (avg < r.avgClvBelow) boost = r.minEvBoost;
    }
    g = { sportCode, sample: clvs.length, avgClv: avg, minEvBoost: boost, active: boost > 0 };
  }
  cache.set(sportCode, { at: Date.now(), g });
  return g;
}

/** All currently active guardrails (admin visibility). */
export async function activeGuardrails(): Promise<SportGuardrail[]> {
  const db = getDb();
  const sports = await db
    .selectDistinct({ sportCode: pickHistory.sportCode })
    .from(pickHistory);
  const out: SportGuardrail[] = [];
  for (const s of sports) {
    const g = await sportGuardrail(s.sportCode);
    if (g.sample > 0) out.push(g);
  }
  return out;
}

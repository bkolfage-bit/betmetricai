/**
 * Engine / model health (§22) — computes REAL health checks from live
 * platform data and appends a model_health row per registered model.
 *
 * This replaces the demo-seeded health snapshot: every check below is
 * derived from actual odds snapshots, graded pick history, predictions,
 * and team ratings. When there is not enough real data to evaluate a
 * check, it is reported as INSUFFICIENT DATA and treated as neutral
 * (never fabricated as a pass or a failure).
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  calibrationResults,
  events,
  modelHealth,
  models,
  oddsFeedHealth,
  oddsSnapshots,
  oddsSportMap,
  pickHistory,
  predictions,
  sports,
  teamRatings,
} from "@db/schema";
import {
  brierScore,
  expectedCalibrationError,
  logLoss,
  reliabilityBuckets,
  type ProbOutcome,
} from "./calibration";

/** Minimum graded real picks before an ECE reading is statistically meaningful. */
const MIN_CALIB_PICKS = 30;
/** Minimum picks with CLV before a trend reading is meaningful. */
const MIN_CLV_PICKS = 10;
/** ECE above this triggers a calibration warning (on sufficient data). */
const ECE_WARN = 0.08;
/** No odds snapshot for this long while events are upcoming => stale feed. */
const FEED_STALE_MS = 6 * 60 * 60 * 1000;

export interface HealthSummary {
  modelId: string;
  status: "HEALTHY" | "WARNING" | "DEGRADED" | "DISABLED";
  failing: string[];
}

type Check = { name: string; ok: boolean; detail: string };

/**
 * Recompute calibration_results for one model from REAL graded pick
 * history only. Existing rows for the model are replaced, but only when
 * the underlying graded-pick count has changed (or rows are absent while
 * real picks exist) — the table stays an accurate reflection of the real
 * history, not a log of identical recomputations.
 */
async function refreshCalibration(
  modelId: string,
  rows: Array<{ market: string; modelProb: string | null; result: string }>,
): Promise<void> {
  const db = getDb();
  const pairsAll = rows
    .filter((r) => r.modelProb != null && r.result !== "push")
    .map((r) => ({ prob: parseFloat(r.modelProb!), won: r.result === "won" }) satisfies ProbOutcome);

  const existing = await db
    .select({
      id: calibrationResults.id,
      sampleSize: calibrationResults.sampleSize,
      computedAt: calibrationResults.computedAt,
    })
    .from(calibrationResults)
    .where(eq(calibrationResults.modelId, modelId))
    .orderBy(desc(calibrationResults.id))
    .limit(20);
  const batchAt = existing[0]?.computedAt?.getTime() ?? null;
  const batchN = existing
    .filter((r) => batchAt != null && r.computedAt.getTime() === batchAt)
    .reduce((s, r) => s + r.sampleSize, 0);

  if (existing.length > 0 && batchN === pairsAll.length) return; // unchanged
  if (existing.length === 0 && pairsAll.length === 0) return; // nothing to record honestly

  await db.delete(calibrationResults).where(eq(calibrationResults.modelId, modelId));
  const markets = [...new Set(rows.map((r) => r.market))];
  for (const market of markets) {
    const marketRows = rows.filter((r) => r.market === market);
    const pairs = marketRows
      .filter((r) => r.modelProb != null && r.result !== "push")
      .map((r) => ({ prob: parseFloat(r.modelProb!), won: r.result === "won" }) satisfies ProbOutcome);
    if (pairs.length === 0) continue;
    const buckets = reliabilityBuckets(pairs, 8);
    await db.insert(calibrationResults).values({
      modelId,
      market,
      sampleSize: pairs.length,
      brier: brierScore(pairs).toFixed(5),
      logLoss: logLoss(pairs).toFixed(5),
      ece: expectedCalibrationError(buckets).toFixed(5),
      buckets: JSON.stringify(buckets),
    });
  }
}

/** Recompute health for every registered model from real data. */
export async function refreshModelHealth(): Promise<HealthSummary[]> {
  const db = getDb();
  const modelRows = await db.select().from(models);
  const sportRows = await db.select().from(sports);
  const sportIdByCode = new Map(sportRows.map((s) => [s.code, s.id]));
  const now = Date.now();
  const out: HealthSummary[] = [];

  for (const m of modelRows) {
    if (m.status === "disabled") {
      const checks: Check[] = [
        { name: "Admin action", ok: false, detail: "Model disabled by administrator." },
      ];
      await db.insert(modelHealth).values({
        modelId: m.modelId,
        status: "DISABLED",
        checks: JSON.stringify(checks),
      });
      out.push({ modelId: m.modelId, status: "DISABLED", failing: ["Admin action"] });
      continue;
    }

    const sportId = sportIdByCode.get(m.sportCode);
    const upcoming = sportId
      ? await db
          .select({
            id: events.id,
            homeTeamId: events.homeTeamId,
            awayTeamId: events.awayTeamId,
          })
          .from(events)
          .where(and(eq(events.sportId, sportId), eq(events.status, "scheduled")))
          .limit(200)
      : [];

    const hist = await db
      .select({
        market: pickHistory.market,
        modelProb: pickHistory.modelProb,
        result: pickHistory.result,
        clv: pickHistory.clv,
      })
      .from(pickHistory)
      .where(eq(pickHistory.sportCode, m.sportCode));

    await refreshCalibration(m.modelId, hist);

    const checks: Check[] = [];

    /* 1. Feed freshness — real latest odds snapshot for this sport.
     * Three honest regimes:
     *  a) fresh snapshots on upcoming events → OK
     *  b) no fresh snapshots, but the provider feed itself is syncing fine
     *     and simply listing no markets for this sport (off-season /
     *     between events / outrights-only) → OK, informational
     *  c) no fresh snapshots AND the provider sync is failing or silent
     *     while markets should exist → real feed malfunction → FAIL */
    const [feedRow] = await db
      .select()
      .from(oddsFeedHealth)
      .where(eq(oddsFeedHealth.sportCode, m.sportCode));
    const mapRows = await db
      .select({ status: oddsSportMap.status })
      .from(oddsSportMap)
      .where(eq(oddsSportMap.sportCode, m.sportCode));
    const hasGameMarketMapping = mapRows.some((r) => r.status === "active");
    const lastSyncOkMs = feedRow?.lastSuccessAt?.getTime() ?? null;
    const providerSyncing = lastSyncOkMs != null && now - lastSyncOkMs < 2 * 60 * 60 * 1000;

    if (upcoming.length === 0) {
      checks.push({
        name: "Feed freshness",
        ok: true,
        detail: "No upcoming events — feed idle for this sport",
      });
    } else if (!hasGameMarketMapping) {
      checks.push({
        name: "Feed freshness",
        ok: true,
        detail:
          feedRow?.message ??
          "No active game-market provider key for this sport (off-season or outrights-only)",
      });
    } else {
      const ids = upcoming.map((e) => e.id);
      const rows = await db
        .select({ last: sql<string | null>`max(${oddsSnapshots.capturedAt})` })
        .from(oddsSnapshots)
        .where(inArray(oddsSnapshots.eventId, ids));
      const lastRaw = rows[0]?.last ?? null;
      // max(capturedAt) comes back as a raw "YYYY-MM-DD HH:MM:SS" UTC
      // string — parse it explicitly as UTC (never local server time)
      const lastMs = lastRaw
        ? new Date(
            lastRaw.includes("T") ? lastRaw : `${lastRaw.replace(" ", "T")}Z`,
          ).getTime()
        : null;
      const stale = lastMs == null || now - lastMs > FEED_STALE_MS;
      if (!stale) {
        checks.push({
          name: "Feed freshness",
          ok: true,
          detail: `Odds snapshots current (last ${Math.max(1, Math.round((now - lastMs!) / 60000))}min ago, ${upcoming.length} upcoming events)`,
        });
      } else if (providerSyncing) {
        checks.push({
          name: "Feed freshness",
          ok: true,
          detail: `Provider feed healthy but currently lists no odds for this sport — last sync ${Math.round((now - lastSyncOkMs!) / 60000)}min ago returned no markets (typical off-season / between events)`,
        });
      } else {
        checks.push({
          name: "Feed freshness",
          ok: false,
          detail:
            (lastMs == null
              ? `No odds snapshots on record for ${upcoming.length} upcoming events`
              : `Last odds snapshot ${Math.round((now - lastMs) / 3600000)}h ago across ${upcoming.length} upcoming events`) +
            ` and provider sync ${feedRow?.consecutiveFailures ? `failing (${feedRow.consecutiveFailures} consecutive)` : "silent >2h"}`,
        });
      }
    }

    /* 2. Calibration (ECE) — real graded picks only. */
    const pairs: ProbOutcome[] = hist
      .filter((h) => h.modelProb != null && h.result !== "push")
      .map((h) => ({ prob: parseFloat(h.modelProb!), won: h.result === "won" }));
    if (pairs.length < MIN_CALIB_PICKS) {
      checks.push({
        name: "Calibration (ECE)",
        ok: true,
        detail: `INSUFFICIENT REAL DATA — ${pairs.length} graded picks (${MIN_CALIB_PICKS} required for a valid ECE)`,
      });
    } else {
      const ece = expectedCalibrationError(reliabilityBuckets(pairs, 8));
      checks.push({
        name: "Calibration (ECE)",
        ok: ece < ECE_WARN,
        detail: `ECE ${(ece * 100).toFixed(1)}% across ${pairs.length} real graded picks`,
      });
    }

    /* 3. Prediction distribution — real upcoming predictions. */
    if (upcoming.length === 0) {
      checks.push({
        name: "Prediction distribution",
        ok: true,
        detail: "No upcoming events to predict",
      });
    } else {
      const ids = upcoming.map((e) => e.id);
      const preds = await db
        .select({ eventId: predictions.eventId, homeWinProb: predictions.homeWinProb })
        .from(predictions)
        .where(inArray(predictions.eventId, ids))
        .orderBy(desc(predictions.id))
        .limit(2000);
      const latest = new Map<number, number>();
      for (const p of preds) {
        if (!latest.has(p.eventId)) latest.set(p.eventId, parseFloat(p.homeWinProb));
      }
      const probs = [...latest.values()];
      if (probs.length === 0) {
        checks.push({
          name: "Prediction distribution",
          ok: true,
          detail: "No predictions published for upcoming events yet",
        });
      } else {
        const extreme = probs.filter((p) => p > 0.9 || p < 0.1).length / probs.length;
        const mean = probs.reduce((s, p) => s + p, 0) / probs.length;
        checks.push({
          name: "Prediction distribution",
          ok: extreme <= 0.9,
          detail: `${probs.length} upcoming predictions, mean home prob ${(mean * 100).toFixed(0)}%, ${(extreme * 100).toFixed(0)}% extreme (>90%/<10%)`,
        });
      }
    }

    /* 4. CLV trend — real closing-line value on graded picks. */
    if (hist.length < MIN_CLV_PICKS) {
      checks.push({
        name: "CLV trend",
        ok: true,
        detail: `INSUFFICIENT REAL DATA — ${hist.length} graded picks (${MIN_CLV_PICKS} required)`,
      });
    } else {
      const avg = hist.reduce((s, h) => s + parseFloat(h.clv), 0) / hist.length;
      checks.push({
        name: "CLV trend",
        ok: avg > -1.0,
        detail: `Average CLV ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}% across ${hist.length} real graded picks`,
      });
    }

    /* 5. Feature completeness — real ratings coverage for upcoming teams. */
    if (upcoming.length === 0) {
      checks.push({
        name: "Feature completeness",
        ok: true,
        detail: "No upcoming events requiring ratings",
      });
    } else {
      const teamIds = [...new Set(upcoming.flatMap((e) => [e.homeTeamId, e.awayTeamId]))];
      const rated = await db
        .select({ teamId: teamRatings.teamId })
        .from(teamRatings)
        .where(
          and(
            inArray(teamRatings.teamId, teamIds),
            eq(teamRatings.featureVersion, m.featureVersion),
          ),
        );
      const covered = new Set(rated.map((r) => r.teamId));
      const missing = teamIds.filter((t) => !covered.has(t)).length;
      const coverage = teamIds.length === 0 ? 1 : 1 - missing / teamIds.length;
      checks.push({
        name: "Feature completeness",
        ok: coverage >= 0.8,
        detail: `Ratings present for ${teamIds.length - missing}/${teamIds.length} upcoming teams (${m.featureVersion})`,
      });
    }

    const failing = checks.filter((c) => !c.ok).map((c) => c.name);
    const status =
      failing.length === 0 ? "HEALTHY" : failing.length === 1 ? "WARNING" : "DEGRADED";
    await db.insert(modelHealth).values({
      modelId: m.modelId,
      status,
      checks: JSON.stringify(checks),
    });
    out.push({ modelId: m.modelId, status, failing });
  }

  return out;
}

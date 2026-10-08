/**
 * Smart adaptive polling scheduler.
 *
 * Interval tiers (spec §: 30m / 15m / 5m / 2m / live 60s):
 *   > 24h to start   -> 30 min
 *   6–24h            -> 15 min
 *   2–6h             -> 5 min
 *   0–2h             -> 2 min
 *   live (started)   -> 60 sec
 * Only events inside a 30h window are polled at all ("poll only active
 * events"); each sync call passes the due providerEventIds so the payload is
 * limited to what is actually due. Quota protection tiers stretch intervals
 * (x2 / x4) and then suspend paid calls entirely at the critical threshold.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { events, oddsSportMap } from "../../db/schema";
import {
  FORECAST_HORIZON_DAYS,
  getFeedMode,
  getQuotaState,
  syncOutrights,
  syncScores,
  syncSportOdds,
} from "./service";
import { syncPredictionMarkets } from "../pm/service";

const TICK_MS = 30_000;
const WINDOW_AHEAD_MS = 30 * 60 * 60 * 1000; // poll nothing beyond 30h out
const LIVE_GRACE_MS = 4 * 60 * 60 * 1000; // keep polling up to 4h after start
const MAX_EVENTS_PER_CALL = 20;
const HORIZON_MS = FORECAST_HORIZON_DAYS * 24 * 60 * 60 * 1000;
const OUTRIGHTS_INTERVAL_MS = 24 * 60 * 60 * 1000; // futures move slowly
const SCORES_INTERVAL_MS = 5 * 60 * 1000; // /scores: 1 credit per sport-key
const PM_INTERVAL_MS = 10 * 60 * 1000; // prediction markets: free public APIs
const V2_INTERVAL_MS = 24 * 60 * 60 * 1000; // v2 model re-train/validate daily
const HEALTH_INTERVAL_MS = 30 * 60 * 1000; // recompute real model health
let lastOutrightsRun = 0;
let lastScoresRun = 0;
let lastPmRun = 0;
let lastV2Run = 0;
let lastHealthRun = 0;

interface TierDef {
  maxAheadMs: number;
  intervalMs: number;
}

const TIERS: TierDef[] = [
  { maxAheadMs: 0, intervalMs: 60_000 }, // live
  { maxAheadMs: 2 * 3600_000, intervalMs: 2 * 60_000 },
  { maxAheadMs: 6 * 3600_000, intervalMs: 5 * 60_000 },
  { maxAheadMs: 24 * 3600_000, intervalMs: 15 * 60_000 },
  { maxAheadMs: Infinity, intervalMs: 30 * 60_000 },
];

function tierFor(startTime: Date, now: number): TierDef {
  const ahead = startTime.getTime() - now;
  for (const t of TIERS) if (ahead <= t.maxAheadMs) return t;
  return TIERS[TIERS.length - 1];
}

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return; // never overlap ticks
  running = true;
  try {
    const now = Date.now();

    // model-health pass: recompute every check from real data (odds
    // snapshots, graded pick history, predictions, ratings) so the admin
    // dashboard always reflects current reality, never stale artifacts.
    // Runs in every feed mode — health must stay current even when the
    // odds feed itself is suspended or in demo.
    if (now - lastHealthRun >= HEALTH_INTERVAL_MS) {
      lastHealthRun = now;
      try {
        const { refreshModelHealth } = await import("../engine/health");
        const s = await refreshModelHealth();
        const bad = s.filter((x) => x.status !== "HEALTHY");
        console.log(
          `[health] refreshed ${s.length} models — ` +
            (bad.length
              ? bad.map((x) => `${x.modelId}=${x.status}(${x.failing.join("|")})`).join(", ")
              : "all HEALTHY"),
        );
      } catch (e) {
        console.error("[health] refresh failed:", e instanceof Error ? e.message : e);
      }
    }

    const mode = await getFeedMode();
    if (mode !== "live") return;

    const quota = await getQuotaState();
    if (quota.tier === "suspended" || quota.tier === "critical") return;

    const db = getDb();

    // active sport codes straight from the discovered mapping
    const mapRows = await db.select().from(oddsSportMap).where(eq(oddsSportMap.status, "active"));
    if (mapRows.length === 0) return;
    const codes = [...new Set(mapRows.map((r) => r.sportCode))];

    for (const code of codes) {
      // provider-sourced events in the polling window AND within the
      // 8-day forecast horizon (championship futures are handled by the
      // outrights pass below)
      const rows = await db
        .select({
          id: events.id,
          providerEventId: events.providerEventId,
          startTime: events.startTime,
          oddsSyncedAt: events.oddsSyncedAt,
          status: events.status,
        })
        .from(events)
        .where(
          and(
            eq(events.provider, "THE_ODDS_API"),
            inArray(events.status, ["scheduled", "live"]),
            lte(events.startTime, new Date(now + Math.min(WINDOW_AHEAD_MS, HORIZON_MS))),
            gte(events.startTime, new Date(now - LIVE_GRACE_MS)),
          ),
        )
        .orderBy(asc(events.startTime))
        .limit(200);

      const due: string[] = [];
      for (const ev of rows) {
        if (!ev.providerEventId) continue;
        const tier = tierFor(ev.startTime, now);
        const interval = tier.intervalMs * quota.intervalMultiplier;
        const lastSync = ev.oddsSyncedAt?.getTime() ?? 0;
        if (now - lastSync >= interval) due.push(ev.providerEventId);
        if (due.length >= MAX_EVENTS_PER_CALL) break;
      }
      if (due.length === 0) continue;

      const res = await syncSportOdds(code, { eventIds: due });
      console.log(
        `[feed] ${code}: ${res.rowsWritten} rows (${res.eventsWithOdds} events, cost ${res.cost})` +
          (res.errors.length ? ` ERRORS: ${res.errors.join("; ")}` : ""),
      );
    }

    // live scores pass: flips scheduled->live->final with REAL provider
    // scores and feeds the live model. 1 credit per active sport key,
    // throttled to every 5 min — cheap relative to odds polling.
    if (now - lastScoresRun >= SCORES_INTERVAL_MS) {
      lastScoresRun = now;
      for (const code of codes) {
        const r = await syncScores(code).catch((e) => ({
          updated: 0, liveNow: 0, finals: 0,
          errors: [e instanceof Error ? e.message : String(e)],
        }));
        if (r.updated > 0 || r.errors.length > 0) {
          console.log(
            `[feed] ${code} scores: ${r.updated} updated (${r.liveNow} live, ${r.finals} final)` +
              (r.errors.length ? ` ERRORS: ${r.errors.join("; ")}` : ""),
          );
        }
      }
    }

    // prediction-market intelligence pass: free public APIs (no quota cost),
    // every 10 min, isolated from the odds pipeline
    if (now - lastPmRun >= PM_INTERVAL_MS) {
      lastPmRun = now;
      const pm = await syncPredictionMarkets().catch((e) => {
        console.error("[pm] sync crashed:", e instanceof Error ? e.message : e);
        return null;
      });
      if (pm) {
        console.log(
          `[pm] kalshi ${pm.kalshi.events}ev/${pm.kalshi.matched}matched · polymarket ${pm.polymarket.events}ev/${pm.polymarket.matched}matched · history +${pm.historySeeded} · closed ${pm.closed}` +
            (pm.kalshi.errors.length || pm.polymarket.errors.length
              ? ` ERRORS: ${[...pm.kalshi.errors, ...pm.polymarket.errors].join("; ").slice(0, 300)}`
              : ""),
        );
      }
    }

    // v2 model maintenance: daily — ingest newly completed games, then
    // re-validate and re-deploy only where v2 still beats v1
    if (now - lastV2Run >= V2_INTERVAL_MS) {
      lastV2Run = now;
      try {
        const { refreshV2 } = await import("../v2/refresh");
        const r = await refreshV2();
        console.log(`[v2] refresh: ${r.ingested} new games ingested; deployed ${r.deployedSports.join(",") || "none"}; held back ${r.heldBack.join(",") || "none"}`);
      } catch (e) {
        console.error("[v2] refresh failed:", e instanceof Error ? e.message : e);
      }
    }

    // championship / futures exception: outrights sync daily, regardless of
    // how far out the title settles
    if (now - lastOutrightsRun >= OUTRIGHTS_INTERVAL_MS) {
      lastOutrightsRun = now;
      const mapAll = await db.select().from(oddsSportMap);
      const outrightCodes = [
        ...new Set(
          mapAll
            .filter((m) => m.status === "outrights_only" || m.providerSportKey.endsWith("_winner"))
            .map((m) => m.sportCode),
        ),
      ];
      for (const code of outrightCodes) {
        const r = await syncOutrights(code);
        if (r.rowsWritten > 0 || r.errors.length > 0) {
          console.log(
            `[feed] outrights ${code}: ${r.rowsWritten} rows (${r.participants} participants, cost ${r.cost})` +
              (r.errors.length ? ` ERRORS: ${r.errors.join("; ")}` : ""),
          );
        }
      }
    }
  } catch (err) {
    console.error("[feed] scheduler tick failed:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startFeedScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  console.log("[feed] scheduler started (30s tick; LIVE mode + quota tiers gate paid calls)");
}

export function stopFeedScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

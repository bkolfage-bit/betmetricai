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
  pollTierFor,
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
const PM_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000; // cap the unreachable-backoff at 6h
const V2_INTERVAL_MS = 24 * 60 * 60 * 1000; // v2 model re-train/validate daily
const HEALTH_INTERVAL_MS = 30 * 60 * 1000; // recompute real model health
const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // re-price every open pick
const PROPS_INTERVAL_MS = 6 * 60 * 60 * 1000; // NHL props pull: 4x/day (paid)
const PROPS_GRADE_INTERVAL_MS = 60 * 60 * 1000; // grade settled props hourly
const DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000; // full-sport sweep: finds NEW events
const STUCK_CHECK_INTERVAL_MS = 30 * 60 * 1000; // force-resync "live" events past max duration
const MAX_GAME_MINUTES: Record<string, number> = {
  NFL: 330, NCAAF: 330, NBA: 240, NCAAB: 210, MLB: 360, NHL: 270,
  SOCCER: 210, TENNIS: 360, UFC: 480, GOLF: 600,
};
let lastOutrightsRun = 0;
let lastScoresRun = 0;
let lastPmRun = 0;
let pmFailStreak = 0; // consecutive runs where BOTH venues were unreachable
let lastV2Run = 0;
let lastHealthRun = 0;
let lastSweepRun = 0;
let lastPropsRun = 0;
let lastPropsGradeRun = 0;
let lastDiscoveryRun = 0;
let lastStuckCheckRun = 0;

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

    // pick-pricing sweep: recompute every pick on every open event
    // against the freshest odds + the calibration gate, so statuses can
    // never freeze at values produced from stale prices or prior-based
    // ratings. Material changes are versioned (history preserved);
    // non-material recomputes write nothing.
    if (now - lastSweepRun >= SWEEP_INTERVAL_MS) {
      lastSweepRun = now;
      try {
        const { recomputeEventPicks } = await import("../engine/recompute");
        const sweepDb = getDb();
        const open = await sweepDb
          .select({ id: events.id })
          .from(events)
          .where(inArray(events.status, ["scheduled", "live"]))
          .limit(600);
        let changed = 0;
        for (const e of open) {
          const rs = await recomputeEventPicks(e.id).catch(() => []);
          changed += rs.filter((r) => r.changed).length;
        }
        if (changed > 0) console.log(`[sweep] repriced ${open.length} open events — ${changed} material pick updates`);
      } catch (e) {
        console.error("[sweep] failed:", e instanceof Error ? e.message : e);
      }
    }

    // prop grading (free, runs in every mode): settle NHL props from real
    // boxscores once their events are final. Append-only.
    if (now - lastPropsGradeRun >= PROPS_GRADE_INTERVAL_MS) {
      lastPropsGradeRun = now;
      try {
        const { gradeNhlProps } = await import("../engine/props");
        const n = await gradeNhlProps();
        if (n > 0) console.log(`[props] graded ${n} NHL props from boxscores`);
      } catch (e) {
        console.error("[props] grading failed:", e instanceof Error ? e.message : e);
      }
    }

    // stuck-game guard (runs in every mode): a "live" event that has been
    // running longer than any real game can possibly last means a scores
    // poll was missed (downtime, restart). Force an immediate re-check so a
    // finished game never sits as LIVE for hours. Free: /scores costs 0.
    if (now - lastStuckCheckRun >= STUCK_CHECK_INTERVAL_MS) {
      lastStuckCheckRun = now;
      try {
        const stuckDb = getDb();
        const { sports } = await import("@db/schema");
        const sportRows = await stuckDb.select().from(sports);
        const codeOf = new Map(sportRows.map((s) => [s.id, s.code]));
        const liveRows = await stuckDb
          .select({ id: events.id, startTime: events.startTime, sportId: events.sportId })
          .from(events)
          .where(and(eq(events.provider, "THE_ODDS_API"), eq(events.status, "live")));
        const stuckCodes = new Set<string>();
        for (const ev of liveRows) {
          const code = codeOf.get(ev.sportId);
          if (!code) continue;
          const maxMin = MAX_GAME_MINUTES[code] ?? 360;
          if (now - ev.startTime.getTime() > maxMin * 60_000) stuckCodes.add(code);
        }
        for (const code of stuckCodes) {
          const r = await syncScores(code);
          console.log(`[stuck] ${code}: forced resync — ${r.updated} updated, ${r.finals} final, ${r.graded} graded`);
        }
      } catch (e) {
        console.error("[stuck] check failed:", e instanceof Error ? e.message : e);
      }
    }

    const mode = await getFeedMode();
    if (mode !== "live") return;

    const quota = await getQuotaState();
    if (quota.tier === "suspended" || quota.tier === "critical") return;

    // NHL props pull (paid): 4x/day, only for games inside 36h, and only
    // when the quota tier is comfortable. Cost is measured per event and
    // logged by syncEventProps like every other paid call.
    if (now - lastPropsRun >= PROPS_INTERVAL_MS && (quota.tier === "normal" || quota.tier === "conservative")) {
      lastPropsRun = now;
      try {
        const { syncNhlProps } = await import("../engine/props");
        const r = await syncNhlProps(36);
        console.log(
          `[props] NHL: ${r.eventsWithProps}/${r.eventsTried} events pulled, ${r.rowsWritten} edges, cost ${r.credits}` +
            (r.errors.length ? ` ERRORS: ${r.errors.join("; ").slice(0, 200)}` : ""),
        );
      } catch (e) {
        console.error("[props] sync failed:", e instanceof Error ? e.message : e);
      }
    }

    const db = getDb();

    // active sport codes straight from the discovered mapping
    const mapRows = await db.select().from(oddsSportMap).where(eq(oddsSportMap.status, "active"));
    if (mapRows.length === 0) return;
    const codes = [...new Set(mapRows.map((r) => r.sportCode))];

    // event-discovery sweep (paid, measured): the per-event loop below only
    // refreshes games ALREADY in the database. Without this full-sport call,
    // newly scheduled games never enter the system at all. 4x/day per sport,
    // 3 credits each — cheap insurance against missed slates.
    if (now - lastDiscoveryRun >= DISCOVERY_INTERVAL_MS && (quota.tier === "normal" || quota.tier === "conservative")) {
      lastDiscoveryRun = now;
      for (const code of codes) {
        try {
          const res = await syncSportOdds(code);
          if (res.eventsWithOdds > 0 || res.errors.length > 0) {
            console.log(
              `[discovery] ${code}: ${res.eventsWithOdds} events, ${res.rowsWritten} rows, cost ${res.cost}` +
                (res.errors.length ? ` ERRORS: ${res.errors.join("; ").slice(0, 200)}` : ""),
            );
          }
        } catch (e) {
          console.error(`[discovery] ${code} failed:`, e instanceof Error ? e.message : e);
        }
      }
    }

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
        const tier = pollTierFor(ev.startTime, now);
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
    // every 10 min, isolated from the odds pipeline. Circuit breaker: when
    // BOTH venues are unreachable (e.g. sandbox egress allowlist blocks
    // kalshi.com / polymarket.com), back off exponentially instead of logging
    // the same timeout every 10 minutes — and recover automatically the
    // moment access is restored.
    const pmBackoffMs = Math.min(
      PM_BACKOFF_MAX_MS,
      PM_INTERVAL_MS * Math.pow(2, Math.max(0, pmFailStreak - 1)),
    );
    if (now - lastPmRun >= (pmFailStreak >= 2 ? pmBackoffMs : PM_INTERVAL_MS)) {
      lastPmRun = now;
      const pm = await syncPredictionMarkets().catch((e) => {
        console.error("[pm] sync crashed:", e instanceof Error ? e.message : e);
        return null;
      });
      if (pm) {
        const kalshiDead = pm.kalshi.events === 0 && pm.kalshi.errors.length > 0;
        const polyDead = pm.polymarket.events === 0 && pm.polymarket.errors.length > 0;
        const bothDead = kalshiDead && polyDead;
        pmFailStreak = bothDead ? pmFailStreak + 1 : 0;
        if (bothDead) {
          // single concise line per backoff step, not a stack of errors
          console.log(
            `[pm] venues unreachable (kalshi+polymarket) — backing off ${Math.round(pmBackoffMs / 60000)}min (streak ${pmFailStreak})`,
          );
        } else {
          console.log(
            `[pm] kalshi ${pm.kalshi.events}ev/${pm.kalshi.matched}matched · polymarket ${pm.polymarket.events}ev/${pm.polymarket.matched}matched · history +${pm.historySeeded} · closed ${pm.closed}` +
              (pm.kalshi.errors.length || pm.polymarket.errors.length
                ? ` ERRORS: ${[...pm.kalshi.errors, ...pm.polymarket.errors].join("; ").slice(0, 300)}`
                : ""),
          );
        }
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
      // calibration maintenance (daily, same cadence): re-fit each sport's
      // gated calibration layer from graded history. Fits only go live when
      // they beat raw probabilities on a chronological holdout.
      try {
        const { refreshAllCalibrationFits } = await import("../engine/calibration-fit");
        const report = await refreshAllCalibrationFits();
        const adopted = Object.entries(report).filter(([, v]) => !v.startsWith("no fit"));
        console.log(`[calibration] fits refreshed: ${adopted.length ? adopted.map(([s, v]) => `${s} ${v}`).join("; ") : "none adopted (gates)"}`);
      } catch (e) {
        console.error("[calibration] fit refresh failed:", e instanceof Error ? e.message : e);
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

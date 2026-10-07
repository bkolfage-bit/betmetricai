/**
 * Production odds feed service — discovery, sync, quota protection, health.
 *
 * Guarantees (from the integration spec):
 *  - the API key is only ever used inside the provider adapter (server-side)
 *  - current_odds is the fast-read representation; feed_odds_snapshots is
 *    append-only history, deduped by (event, book, market, outcome,
 *    provider_last_update) so re-polls never write duplicate rows
 *  - older data never overwrites newer data in current_odds
 *  - quota tiers throttle and then suspend paid calls automatically
 *  - failures are recorded — never papered over with fabricated odds
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  adminConfig,
  aiPicks,
  currentOdds,
  events,
  feedOddsSnapshots,
  oddsApiUsage,
  oddsFeedHealth,
  oddsOutrights,
  oddsOutrightSnapshots,
  oddsSnapshots,
  oddsSportMap,
  predictions,
  sports,
  sportsbooks,
  teamRatings,
  teams,
} from "../../db/schema";
import { getSportModel } from "../models";
import type { SportModel } from "../models/interface";
import { recomputeEventPicks } from "../engine/recompute";
import { marketProbability } from "../engine/markets";
import { americanToDecimal, americanToImplied, noVigN } from "../engine/probability";
import { getOddsProvider, hasOddsProvider } from "../providers";
import type { ProviderEventOdds, ProviderSport, QuotaInfo } from "../providers/types";
import { normalizeEventOdds } from "./normalize";
import { matchProviderKeys, SPORT_KEY_RULES } from "./sport-map";

const PROVIDER = "THE_ODDS_API";
const MODE_KEY = "odds_feed_mode";
const BASELINE_KEY = "odds_quota_baseline";

/**
 * Forecast horizon: only games within 8 days are analyzed and polled.
 * Exception: championship / futures markets (outrights) — the Super Bowl,
 * division winners, etc. — are always in scope regardless of date.
 */
export const FORECAST_HORIZON_DAYS = 8;
const HORIZON_MS = FORECAST_HORIZON_DAYS * 24 * 60 * 60 * 1000;

/* ------------------------------- quota ---------------------------------- */

export type QuotaTier = "normal" | "conservative" | "minimal" | "critical" | "suspended";

export interface QuotaState {
  used: number | null;
  remaining: number | null;
  baseline: number | null;
  tier: QuotaTier;
  /** multiplier applied to poll intervals at this tier */
  intervalMultiplier: number;
}

export async function logUsage(
  endpoint: string,
  sportKey: string | null,
  quota: QuotaInfo | null,
  latencyMs: number,
  status: "ok" | "error",
  message?: string,
): Promise<void> {
  const db = getDb();
  await db.insert(oddsApiUsage).values({
    endpoint,
    sportKey,
    cost: quota?.lastRequestCost ?? (status === "ok" ? 1 : 0),
    requestsUsed: quota?.requestsUsed ?? null,
    requestsRemaining: quota?.requestsRemaining ?? null,
    latencyMs,
    status,
    message: message?.slice(0, 250),
  });
  // capture baseline (total monthly credits) on first sighting of headers
  if (quota?.requestsUsed != null && quota?.requestsRemaining != null) {
    const total = quota.requestsUsed + quota.requestsRemaining;
    const [row] = await db.select().from(adminConfig).where(eq(adminConfig.key, BASELINE_KEY));
    if (!row) {
      await db.insert(adminConfig).values({ key: BASELINE_KEY, value: String(total) });
    }
  }
}

export async function getQuotaState(): Promise<QuotaState> {
  const db = getDb();
  const [last] = await db
    .select()
    .from(oddsApiUsage)
    .where(sql`${oddsApiUsage.requestsRemaining} IS NOT NULL`)
    .orderBy(desc(oddsApiUsage.id))
    .limit(1);
  const [base] = await db.select().from(adminConfig).where(eq(adminConfig.key, BASELINE_KEY));
  const baseline = base ? Number(base.value) : null;
  const remaining = last?.requestsRemaining ?? null;
  const used = last?.requestsUsed ?? null;

  if (remaining == null || baseline == null || baseline <= 0) {
    return { used, remaining, baseline, tier: "normal", intervalMultiplier: 1 };
  }
  const frac = remaining / baseline;
  if (frac <= 0.05) return { used, remaining, baseline, tier: "suspended", intervalMultiplier: Infinity };
  if (frac <= 0.1) return { used, remaining, baseline, tier: "critical", intervalMultiplier: Infinity };
  if (frac <= 0.25) return { used, remaining, baseline, tier: "minimal", intervalMultiplier: 4 };
  if (frac <= 0.5) return { used, remaining, baseline, tier: "conservative", intervalMultiplier: 2 };
  return { used, remaining, baseline, tier: "normal", intervalMultiplier: 1 };
}

/* -------------------------------- mode ---------------------------------- */

export type FeedMode = "demo" | "live";

export async function getFeedMode(): Promise<FeedMode> {
  const db = getDb();
  const [row] = await db.select().from(adminConfig).where(eq(adminConfig.key, MODE_KEY));
  return row?.value === "live" ? "live" : "demo";
}

export async function setFeedMode(mode: FeedMode): Promise<void> {
  const db = getDb();
  await db
    .insert(adminConfig)
    .values({ key: MODE_KEY, value: mode })
    .onDuplicateKeyUpdate({ set: { value: mode } });
}

/* -------------------------------- health -------------------------------- */

async function markHealth(sportCode: string, ok: boolean, message: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(oddsFeedHealth).where(eq(oddsFeedHealth.sportCode, sportCode));
  const now = new Date();
  if (!row) {
    await db.insert(oddsFeedHealth).values({
      sportCode,
      status: ok ? "healthy" : "degraded",
      lastSuccessAt: ok ? now : null,
      lastFailureAt: ok ? null : now,
      consecutiveFailures: ok ? 0 : 1,
      message: message.slice(0, 250),
    });
    return;
  }
  const fails = ok ? 0 : row.consecutiveFailures + 1;
  const status = ok
    ? "healthy"
    : fails >= 5
      ? "offline"
      : fails >= 2
        ? "degraded"
        : "warning";
  await db
    .update(oddsFeedHealth)
    .set({
      status,
      lastSuccessAt: ok ? now : row.lastSuccessAt,
      lastFailureAt: ok ? row.lastFailureAt : now,
      consecutiveFailures: fails,
      message: message.slice(0, 250),
    })
    .where(eq(oddsFeedHealth.sportCode, sportCode));
}

/* ------------------------------ discovery ------------------------------- */

export interface DiscoverySummary {
  connected: boolean;
  providerSports: number;
  mapped: Array<{ code: string; status: string; keys: string[] }>;
  quota: QuotaInfo | null;
  latencyMs: number;
  error?: string;
}

/** /v4/sports discovery — the ONLY source of truth for available sport keys. */
export async function discoverSports(): Promise<DiscoverySummary> {
  if (!hasOddsProvider()) {
    return {
      connected: false,
      providerSports: 0,
      mapped: [],
      quota: null,
      latencyMs: 0,
      error: "ODDS_API_KEY not configured",
    };
  }
  const provider = getOddsProvider();
  const started = Date.now();
  try {
    const res = await provider.listSports();
    await logUsage("/v4/sports", null, res.quota, res.latencyMs, "ok");
    const db = getDb();
    const discovered: ProviderSport[] = res.data;

    const mapped: DiscoverySummary["mapped"] = [];
    for (const rule of SPORT_KEY_RULES) {
      const hits = matchProviderKeys(rule, discovered).filter((s) => s.active);
      const status = hits.length === 0 ? "unavailable" : rule.outrightsOnly ? "outrights_only" : "active";
      for (const h of hits) {
        await db
          .insert(oddsSportMap)
          .values({
            sportCode: rule.code,
            providerSportKey: h.key,
            providerTitle: h.title,
            providerGroup: h.group,
            hasOutrights: h.hasOutrights,
            status,
            lastCheckedAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              providerTitle: h.title,
              providerGroup: h.group,
              hasOutrights: h.hasOutrights,
              status,
              lastCheckedAt: new Date(),
            },
          });
      }
      // retire keys that disappeared or went inactive since last discovery
      const activeKeys = new Set(hits.map((h) => h.key));
      const existing = await db.select().from(oddsSportMap).where(eq(oddsSportMap.sportCode, rule.code));
      for (const row of existing) {
        if (!activeKeys.has(row.providerSportKey) && row.status !== "unavailable") {
          await db
            .update(oddsSportMap)
            .set({ status: "unavailable", lastCheckedAt: new Date() })
            .where(eq(oddsSportMap.id, row.id));
        }
      }
      if (hits.length === 0) {
        // record the gap explicitly so the UI can say UNAVAILABLE truthfully
        await db
          .insert(oddsFeedHealth)
          .values({ sportCode: rule.code, status: "unavailable", message: "No active provider sport key discovered" })
          .onDuplicateKeyUpdate({
            set: { status: "unavailable", message: "No active provider sport key discovered" },
          });
      }
      mapped.push({ code: rule.code, status, keys: hits.map((h) => h.key) });
    }
    return {
      connected: true,
      providerSports: discovered.length,
      mapped,
      quota: res.quota,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logUsage("/v4/sports", null, null, Date.now() - started, "error", msg);
    return { connected: false, providerSports: 0, mapped: [], quota: null, latencyMs: Date.now() - started, error: msg };
  }
}

/* ------------------------------- upserts -------------------------------- */

async function sportIdByCode(): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db.select().from(sports);
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function ensureTeam(sportId: number, fullName: string): Promise<number> {
  const db = getDb();
  const [hit] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.sportId, sportId), eq(teams.name, fullName)))
    .limit(1);
  if (hit) return hit.id;
  // provider names are full ("Kansas City Chiefs"); our calibrated teams are
  // stored as city + name — reuse the calibrated row when it is the same team
  const sportTeams = await db.select().from(teams).where(eq(teams.sportId, sportId));
  const matched = sportTeams.find(
    (t) => t.city && fullName === `${t.city} ${t.name}`,
  ) ?? sportTeams.find(
    (t) => t.name.length >= 4 && fullName.endsWith(` ${t.name}`) && t.city && fullName.startsWith(t.city),
  );
  if (matched) return matched.id;
  const abbr = fullName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
  const r = await db
    .insert(teams)
    .values({ sportId, name: fullName, abbr: abbr || fullName.slice(0, 3).toUpperCase(), city: "" });
  return Number(r[0].insertId);
}

/**
 * Ratings for the model, sport-aware. Priority:
 *   1. the team's stored team_ratings JSON for this model's featureVersion
 *      (calibrated values for teams we know)
 *   2. a shrunk prior for newly discovered teams: the average of the sport's
 *      stored ratings regressed toward the model's true league-average
 *      constants (k=4 pseudo-teams). The seeded pool skews elite, so the raw
 *      average would rate every unknown team like a playoff team.
 * Every missing key falls back to the model's defaultRatings so a partial
 * payload can never produce NaN projections.
 */
async function getModelRatings(
  teamId: number,
  sportId: number,
  model: SportModel,
): Promise<Record<string, number>> {
  const db = getDb();
  const featureVersion = model.featureVersion;
  const defaults = model.defaultRatings;
  const [own] = await db
    .select()
    .from(teamRatings)
    .where(and(eq(teamRatings.teamId, teamId), eq(teamRatings.featureVersion, featureVersion)))
    .limit(1);
  if (own) {
    const j = JSON.parse(own.ratings) as Record<string, number>;
    return { ...defaults, ...j };
  }

  const sportTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.sportId, sportId));
  const ids = sportTeams.map((t) => t.id);
  if (ids.length > 0) {
    // only hand-calibrated rows inform the prior — auto-persisted priors are
    // excluded so clones can't feed back into the average
    const rows = await db
      .select()
      .from(teamRatings)
      .where(
        and(
          inArray(teamRatings.teamId, ids),
          eq(teamRatings.featureVersion, featureVersion),
          eq(teamRatings.isCalibrated, 1),
        ),
      );
    if (rows.length > 0) {
      // The calibrated pool is hand-selected (top teams/players), so its mean
      // is NOT an unbiased estimate of an unknown team — it only informs the
      // ratings scale. Cap its influence at 25%: prior = (Σ + 3n × league
      // avg) / 4n. Unknown teams land near true league average, which keeps
      // the model from manufacturing edges on teams it knows nothing about.
      const K = rows.length * 3;
      const acc = new Map<string, { s: number; n: number }>();
      for (const r of rows) {
        const j = JSON.parse(r.ratings) as Record<string, number>;
        for (const [k, v] of Object.entries(j)) {
          if (!Number.isFinite(v)) continue;
          const a = acc.get(k) ?? { s: 0, n: 0 };
          a.s += v;
          a.n++;
          acc.set(k, a);
        }
      }
      const keys = new Set([...acc.keys(), ...Object.keys(defaults)]);
      const prior: Record<string, number> = {};
      for (const k of keys) {
        const a = acc.get(k) ?? { s: 0, n: 0 };
        const d = defaults[k] ?? 0;
        prior[k] = Math.round(((a.s + K * d) / (a.n + K)) * 1000) / 1000;
      }
      // persist the prior so future syncs are consistent
      await db.insert(teamRatings).values({
        teamId,
        featureVersion,
        ratings: JSON.stringify(prior),
        isCalibrated: 0,
      });
      return { ...defaults, ...prior };
    }
  }
  // last resort: the model's league-average constants
  return { ...defaults };
}

async function ensureEvent(ev: ProviderEventOdds, sportId: number): Promise<number> {
  const db = getDb();
  const [hit] = await db
    .select()
    .from(events)
    .where(and(eq(events.provider, PROVIDER), eq(events.providerEventId, ev.providerEventId)))
    .limit(1);
  if (hit) return hit.id;
  const homeId = await ensureTeam(sportId, ev.homeTeam);
  const awayId = await ensureTeam(sportId, ev.awayTeam);
  const r = await db.insert(events).values({
    sportId,
    homeTeamId: homeId,
    awayTeamId: awayId,
    startTime: ev.commenceTime,
    status: "scheduled",
    isDemo: false,
    provider: PROVIDER,
    providerEventId: ev.providerEventId,
  });
  return Number(r[0].insertId);
}

/**
 * Ensure a model prediction exists for a provider event so the pick engine
 * can price edges against the live odds. Uses each team's stored ratings
 * (new teams carry league-average defaults until calibrated) — the output is
 * the model's own probability, never a manufactured price.
 */
export async function ensurePrediction(eventId: number, sportCode: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db.select({ id: predictions.id }).from(predictions).where(eq(predictions.eventId, eventId)).limit(1);
  if (existing) return true;
  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev) return false;
  try {
    const model = getSportModel(sportCode);
    const [homeRatings, awayRatings] = await Promise.all([
      getModelRatings(ev.homeTeamId, ev.sportId, model),
      getModelRatings(ev.awayTeamId, ev.sportId, model),
    ]);
    const pred = model.predict(homeRatings, awayRatings, {
      weather: ev.weather ?? null,
      injuries: ev.injuries ?? null,
    });
    // never persist a degenerate model output — non-finite projections, or
    // an exact 0%/100% win probability (no honest pregame model is certain)
    const finite = [pred.projHomeScore, pred.projAwayScore, pred.projSpread, pred.projTotal, pred.homeWinProb].every(Number.isFinite);
    if (!finite) return false;
    if (pred.homeWinProb <= 0 || pred.homeWinProb >= 1) return false;
    await db.insert(predictions).values({
      eventId,
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      projHomeScore: String(pred.projHomeScore.toFixed(1)),
      projAwayScore: String(pred.projAwayScore.toFixed(1)),
      projSpread: String(pred.projSpread.toFixed(1)),
      projTotal: String(pred.projTotal.toFixed(1)),
      homeWinProb: pred.homeWinProb.toFixed(4),
      confidence: pred.confidence.toFixed(3),
      agreement: pred.agreement,
      details: JSON.stringify({ dist: pred.dist, drawProb: pred.drawProb, agreementFrac: pred.agreementFrac, extras: pred.extras ?? null }),
      isLive: false,
      createdAt: new Date(),
    });
    return true;
  } catch {
    // sport has no registered model — skip prediction, odds still sync
    return false;
  }
}

/**
 * Create the candidate picks for a real event from the CURRENT market —
 * same rules as the rest of the platform: one pick per supported market,
 * on the side the model favors at the consensus (median) line. Versions are
 * then produced by recomputeEventPicks, which prices them book-by-book.
 */
export async function ensureEventPicks(eventId: number, sportCode: string): Promise<void> {
  const db = getDb();
  const [existing] = await db.select({ id: aiPicks.id }).from(aiPicks).where(eq(aiPicks.eventId, eventId)).limit(1);
  if (existing) return;
  const [pred] = await db.select().from(predictions).where(eq(predictions.eventId, eventId)).orderBy(desc(predictions.id)).limit(1);
  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!pred || !ev) return;

  const model = getSportModel(sportCode);

  // Data-quality gate: a published pick is a claim that the model disagrees with
  // the market for a reason. If EITHER competitor lacks a calibrated rating for
  // this model version, that side is a league-average prior and the model holds
  // no real information about them — any "disagreement" with a lopsided market
  // is then mostly phantom edge manufactured from ignorance (the market prices
  // in goalies, injuries, form and news that a prior cannot see). Publishing
  // that would violate the platform's no-fabricated-edge rule, so picks require
  // BOTH sides calibrated. Prior-based predictions still display on event pages.
  const calSides = await db
    .selectDistinct({ teamId: teamRatings.teamId })
    .from(teamRatings)
    .where(
      and(
        inArray(teamRatings.teamId, [ev.homeTeamId, ev.awayTeamId]),
        eq(teamRatings.featureVersion, model.featureVersion),
        eq(teamRatings.isCalibrated, 1),
      ),
    );
  if (calSides.length < 2) return;

  const details = pred.details ? (JSON.parse(pred.details) as { dist?: unknown; drawProb?: number }) : {};
  const like = {
    homeWinProb: parseFloat(pred.homeWinProb),
    drawProb: details.drawProb,
    dist: details.dist as never,
  };

  // consensus (median) line per market from the live current_odds
  const rows = await db
    .select({ market: currentOdds.market, outcome: currentOdds.outcome, line: currentOdds.line })
    .from(currentOdds)
    .where(eq(currentOdds.eventId, eventId));
  const linesFor = (market: string, outcome: string) =>
    rows
      .filter((r) => r.market === market && r.outcome === outcome && r.line !== null)
      .map((r) => parseFloat(r.line!))
      .sort((a, b) => a - b);
  const median = (xs: number[]) => (xs.length === 0 ? null : xs[Math.floor(xs.length / 2)]);

  const creates: Array<{ market: "moneyline" | "spread" | "total"; selection: string }> = [];
  if (model.pickMarkets.includes("spread")) {
    const line = median(linesFor("spread", "home"));
    if (line !== null) {
      const pHome = marketProbability(like, "spread", "home", line);
      if (Number.isFinite(pHome)) creates.push({ market: "spread", selection: pHome >= 0.5 ? "home" : "away" });
    }
  }
  if (model.pickMarkets.includes("total")) {
    const line = median(linesFor("total", "over"));
    if (line !== null) {
      const pOver = marketProbability(like, "total", "over", line);
      if (Number.isFinite(pOver)) creates.push({ market: "total", selection: pOver >= 0.5 ? "over" : "under" });
    }
  }
  // moneyline picks only near game time; fights/fights-style always.
  // beyond the forecast horizon there is no analysis at all.
  const hoursOut = (ev.startTime.getTime() - Date.now()) / 3_600_000;
  if (hoursOut > FORECAST_HORIZON_DAYS * 24) return;
  if (model.pickMarkets.includes("moneyline") && (hoursOut < 30 || sportCode === "UFC" || sportCode === "TENNIS")) {
    const hasMl = rows.some((r) => r.market === "moneyline");
    if (hasMl) {
      const hwp = parseFloat(pred.homeWinProb);
      creates.push({ market: "moneyline", selection: hwp >= (details.drawProb ? 0.34 : 0.5) ? "home" : "away" });
    }
  }
  for (const c of creates) {
    await db.insert(aiPicks).values({ eventId, market: c.market, selection: c.selection });
  }
}

const KNOWN_BOOKS: Record<string, string> = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
  bet365: "bet365",
  fanatics: "Fanatics",
};

async function ensureSportsbook(key: string, title: string): Promise<number> {
  const db = getDb();
  const [byKey] = await db.select().from(sportsbooks).where(eq(sportsbooks.providerKey, key)).limit(1);
  if (byKey) return byKey.id;
  // attach to a seeded book when it is the same operator
  const wanted = KNOWN_BOOKS[key];
  if (wanted) {
    const [byName] = await db.select().from(sportsbooks).where(eq(sportsbooks.name, wanted)).limit(1);
    if (byName) {
      await db.update(sportsbooks).set({ providerKey: key }).where(eq(sportsbooks.id, byName.id));
      return byName.id;
    }
  }
  let code = key.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "BOOK";
  for (let i = 2; ; i++) {
    const [clash] = await db.select().from(sportsbooks).where(eq(sportsbooks.code, code)).limit(1);
    if (!clash) break;
    code = `${code.slice(0, 12)}_${i}`;
  }
  const r = await db.insert(sportsbooks).values({ name: title, providerKey: key, code });
  return Number(r[0].insertId);
}

/* --------------------------------- sync --------------------------------- */

export interface SyncResult {
  sportCode: string;
  sportKeys: string[];
  eventsWithOdds: number;
  rowsWritten: number;
  snapshotsWritten: number;
  skippedByDedup: number;
  cost: number;
  latencyMs: number;
  errors: string[];
}

const CORE_MARKETS = () => (process.env.ODDS_CORE_MARKETS || "h2h,spreads,totals").split(",").filter(Boolean);
const REGIONS = () => (process.env.ODDS_REGIONS || "us").split(",").filter(Boolean);
const BOOKMAKERS = () => {
  const v = process.env.ODDS_BOOKMAKERS;
  return v ? v.split(",").filter(Boolean) : undefined;
};

/** Paid odds sync for one internal sport code across its active provider keys. */
export async function syncSportOdds(
  sportCode: string,
  opts: { eventIds?: string[] } = {},
): Promise<SyncResult> {
  const result: SyncResult = {
    sportCode,
    sportKeys: [],
    eventsWithOdds: 0,
    rowsWritten: 0,
    snapshotsWritten: 0,
    skippedByDedup: 0,
    cost: 0,
    latencyMs: 0,
    errors: [],
  };
  const db = getDb();
  const provider = getOddsProvider();
  const sportIds = await sportIdByCode();
  const sportId = sportIds.get(sportCode);
  if (!sportId) {
    result.errors.push(`unknown sport code ${sportCode}`);
    return result;
  }

  const keys = await db
    .select()
    .from(oddsSportMap)
    .where(and(eq(oddsSportMap.sportCode, sportCode), eq(oddsSportMap.status, "active")));
  result.sportKeys = keys.map((k) => k.providerSportKey);
  if (keys.length === 0) {
    result.errors.push("no active provider sport key — run discovery first");
    await markHealth(sportCode, false, "no active provider sport key");
    return result;
  }

  const started = Date.now();
  for (const keyRow of keys) {
    try {
      const res = await provider.getOdds(keyRow.providerSportKey, {
        regions: REGIONS(),
        markets: CORE_MARKETS(),
        bookmakers: BOOKMAKERS(),
        eventIds: opts.eventIds,
      });
      result.cost += res.quota.lastRequestCost ?? 1;
      await logUsage(`/v4/sports/${keyRow.providerSportKey}/odds`, keyRow.providerSportKey, res.quota, res.latencyMs, "ok");

      /* ---- phase 1: resolve events, books, freshness (few round-trips) ---- */
      const now = new Date();
      const horizonCutoff = now.getTime() + HORIZON_MS;
      interface PendingEvent {
        eventId: number;
        books: ReturnType<typeof normalizeEventOdds>;
      }
      const pending: PendingEvent[] = [];
      const bookIds = new Map<string, number>();
      for (const ev of res.data) {
        if (ev.bookmakers.length === 0) continue;
        // forecast horizon: skip games beyond 8 days (championship futures
        // live in the outrights sync, which is date-independent)
        if (ev.commenceTime.getTime() > horizonCutoff) continue;
        const books = normalizeEventOdds(ev);
        if (books.length === 0) continue;
        const eventId = await ensureEvent(ev, sportId);
        result.eventsWithOdds++;
        pending.push({ eventId, books });
        for (const bk of books) {
          if (!bookIds.has(bk.bookmakerKey)) {
            bookIds.set(bk.bookmakerKey, await ensureSportsbook(bk.bookmakerKey, bk.bookmakerTitle));
          }
        }
      }
      if (pending.length > 0) {
        const eventIds = pending.map((p) => p.eventId);
        // staleness guard: existing current rows newer than the payload win
        const existing = await db.select().from(currentOdds).where(inArray(currentOdds.eventId, eventIds));
        const freshness = new Map<string, Date>();
        for (const row of existing) {
          freshness.set(`${row.eventId}:${row.sportsbookId}:${row.market}:${row.outcome}`, row.providerLastUpdate);
        }

        /* ---- phase 2: build batch rows with dedup + staleness in memory ---- */
        const currentRows: Array<typeof currentOdds.$inferInsert> = [];
        const snapRows: Array<typeof feedOddsSnapshots.$inferInsert> = [];
        const mirrorRows: Array<typeof oddsSnapshots.$inferInsert> = [];
        const movedEvents = new Set<number>();
        const seenInBatch = new Set<string>();
        for (const p of pending) {
          for (const bk of p.books) {
            const bookId = bookIds.get(bk.bookmakerKey)!;
            for (const row of bk.rows) {
              const freshKey = `${p.eventId}:${bookId}:${row.market}:${row.outcome}`;
              const prev = freshness.get(freshKey);
              if ((prev && prev >= bk.lastUpdate) || seenInBatch.has(`${freshKey}:${bk.lastUpdate.getTime()}`)) {
                result.skippedByDedup++;
                continue;
              }
              seenInBatch.add(`${freshKey}:${bk.lastUpdate.getTime()}`);
              const values = {
                eventId: p.eventId,
                sportsbookId: bookId,
                market: row.market,
                outcome: row.outcome,
                line: row.line != null ? String(row.line) : null,
                americanOdds: row.americanOdds,
                decimalOdds: String(row.decimalOdds),
                impliedProb: String(row.impliedProb),
                noVigProb: row.noVigProb != null ? String(row.noVigProb) : null,
                providerLastUpdate: bk.lastUpdate,
                fetchedAt: now,
                isLive: false,
              };
              currentRows.push(values);
              snapRows.push(values);
              // mirror moved rows into platform odds history so best-price,
              // CLV tracking and pick recalculation all see the live market
              mirrorRows.push({
                eventId: p.eventId,
                sportsbookId: bookId,
                market: row.market,
                selection: row.outcome,
                line: row.line != null ? String(Math.round(row.line * 10) / 10) : null,
                odds: row.americanOdds,
                isLive: false,
                capturedAt: bk.lastUpdate,
              });
              movedEvents.add(p.eventId);
            }
          }
        }

        /* ---- phase 3: chunked bulk writes ---- */
        const CHUNK = 200;
        for (let i = 0; i < currentRows.length; i += CHUNK) {
          const slice = currentRows.slice(i, i + CHUNK);
          await db.insert(currentOdds).values(slice).onDuplicateKeyUpdate({
            set: {
              line: sql`VALUES(line)`,
              americanOdds: sql`VALUES(american_odds)`,
              decimalOdds: sql`VALUES(decimal_odds)`,
              impliedProb: sql`VALUES(implied_prob)`,
              noVigProb: sql`VALUES(no_vig_prob)`,
              providerLastUpdate: sql`VALUES(provider_last_update)`,
              fetchedAt: sql`VALUES(fetched_at)`,
            },
          });
        }
        result.rowsWritten = currentRows.length;
        for (let i = 0; i < snapRows.length; i += CHUNK) {
          try {
            await db.insert(feedOddsSnapshots).values(snapRows.slice(i, i + CHUNK));
            result.snapshotsWritten += Math.min(CHUNK, snapRows.length - i);
          } catch (e) {
            // duplicate provider_last_update raced in — the unique key is the
            // backstop; fall back to row-by-row for this chunk
            if ((e as { errno?: number })?.errno !== 1062) throw e;
            for (const row of snapRows.slice(i, i + CHUNK)) {
              try {
                await db.insert(feedOddsSnapshots).values(row);
                result.snapshotsWritten++;
              } catch (e2) {
                if ((e2 as { errno?: number })?.errno !== 1062) throw e2;
              }
            }
          }
        }
        for (let i = 0; i < mirrorRows.length; i += CHUNK) {
          await db.insert(oddsSnapshots).values(mirrorRows.slice(i, i + CHUNK));
        }
        await db
          .update(events)
          .set({ oddsSyncedAt: now })
          .where(inArray(events.id, eventIds));
        for (const bookId of bookIds.values()) {
          await db
            .update(sportsbooks)
            .set({ lastSeenAt: now, region: REGIONS().join(",") })
            .where(eq(sportsbooks.id, bookId));
        }

        /* ---- phase 4: dynamic pick recalculation for moved events ---- */
        for (const eventId of movedEvents) {
          const ok = await ensurePrediction(eventId, sportCode);
          if (ok) await ensureEventPicks(eventId, sportCode);
          await recomputeEventPicks(eventId);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(msg);
      await logUsage(`/v4/sports/${keyRow.providerSportKey}/odds`, keyRow.providerSportKey, null, Date.now() - started, "error", msg);
    }
  }
  result.latencyMs = Date.now() - started;

  if (result.errors.length === 0) {
    await markHealth(sportCode, true, `sync ok: ${result.eventsWithOdds} events, ${result.rowsWritten} rows`);
  } else {
    await markHealth(sportCode, false, result.errors[0]);
  }
  return result;
}

/* ------------------------------- outrights ------------------------------- */

/**
 * Championship / futures sync — the exception to the 8-day horizon.
 * Discovers *_winner outright keys for a sport from the provider sport map
 * (never invented) and stores participant prices with no-vig separation
 * across the full field.
 */
export interface OutrightsResult {
  sportCode: string;
  keys: string[];
  participants: number;
  rowsWritten: number;
  cost: number;
  latencyMs: number;
  errors: string[];
}

export async function syncOutrights(sportCode: string): Promise<OutrightsResult> {
  const result: OutrightsResult = {
    sportCode, keys: [], participants: 0, rowsWritten: 0, cost: 0, latencyMs: 0, errors: [],
  };
  const db = getDb();
  const provider = getOddsProvider();
  // outright keys: rows marked outrights_only, plus discovered *_winner keys
  const mapRows = await db
    .select()
    .from(oddsSportMap)
    .where(eq(oddsSportMap.sportCode, sportCode));
  const keys = mapRows
    .filter((m) => m.status === "outrights_only" || m.providerSportKey.endsWith("_winner"))
    // skip keys the provider has deactivated — they 404 on odds requests
    .filter((m) => m.status !== "unavailable")
    .map((m) => m.providerSportKey);
  result.keys = [...new Set(keys)];
  if (result.keys.length === 0) return result;

  const started = Date.now();
  for (const key of result.keys) {
    try {
      const res = await provider.getOdds(key, {
        regions: REGIONS(),
        markets: ["outrights"],
        bookmakers: BOOKMAKERS(),
      });
      result.cost += res.quota.lastRequestCost ?? 1;
      await logUsage(`/v4/sports/${key}/odds (outrights)`, key, res.quota, res.latencyMs, "ok");
      const now = new Date();

      for (const ev of res.data) {
        for (const bk of ev.bookmakers) {
          const bookId = await ensureSportsbook(bk.key, bk.title);
          for (const mkt of bk.markets) {
            if (mkt.key !== "outrights") continue;
            // no-vig across the full field of participants
            const field = mkt.outcomes.filter((o) => Number.isFinite(o.price));
            // provider noise guard: a title market never has 1 participant
            if (field.length < 2) continue;
            if (field.length === 0) continue;
            const nv = noVigN(field.map((o) => Math.round(o.price)));
            const rows: Array<typeof oddsOutrights.$inferInsert> = field.map((o, i) => ({
              sportCode,
              providerSportKey: key,
              market: mkt.key,
              sportsbookId: bookId,
              participant: o.name,
              americanOdds: Math.round(o.price),
              decimalOdds: String(americanToDecimal(Math.round(o.price))),
              impliedProb: String(americanToImplied(Math.round(o.price))),
              noVigProb: nv[i] != null ? String(nv[i]) : null,
              providerLastUpdate: new Date(mkt.lastUpdate),
              fetchedAt: now,
            }));
            await db.insert(oddsOutrights).values(rows).onDuplicateKeyUpdate({
              set: {
                americanOdds: sql`VALUES(american_odds)`,
                decimalOdds: sql`VALUES(decimal_odds)`,
                impliedProb: sql`VALUES(implied_prob)`,
                noVigProb: sql`VALUES(no_vig_prob)`,
                providerLastUpdate: sql`VALUES(provider_last_update)`,
                fetchedAt: sql`VALUES(fetched_at)`,
              },
            });
            for (const row of rows) {
              try {
                await db.insert(oddsOutrightSnapshots).values(row);
              } catch (e) {
                // duplicate snapshot (same participant, same provider
                // timestamp) — the dedup backstop working as designed
                if ((e as { errno?: number })?.errno !== 1062) throw e;
              }
            }
            result.participants += field.length;
            result.rowsWritten += rows.length;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(msg);
      await logUsage(`/v4/sports/${key}/odds (outrights)`, key, null, Date.now() - started, "error", msg);
    }
  }
  result.latencyMs = Date.now() - started;
  return result;
}

/* ------------------------------ player props ----------------------------- */

/**
 * Documented player-prop market keys per sport (The Odds API v4 feature
 * markets). Keys are ONLY ever taken from this list — never invented.
 */
const PROP_MARKETS: Record<string, string[]> = {
  NFL: ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_anytime_td"],
  NCAAF: ["player_pass_yds", "player_rush_yds", "player_reception_yds"],
  NBA: ["player_points", "player_rebounds", "player_assists", "player_threes"],
  MLB: ["batter_hits", "batter_total_bases", "pitcher_strikeouts"],
  NHL: ["player_points", "player_shots_on_goal", "player_goal_scorer_anytime"],
  SOCCER: ["player_goal_scorer_anytime", "player_shots_on_target", "player_assists"],
};

export function allowedPropMarkets(sportCode: string): string[] {
  return PROP_MARKETS[sportCode] ?? [];
}

/**
 * Credit cost estimate for a props pull — shown to the admin BEFORE any
 * credits are spent. Props cost 1 credit per market per region per event.
 */
export function estimatePropsCost(eventCount: number, marketKeys: string[]): number {
  return eventCount * marketKeys.length * REGIONS().length;
}

export interface PropsSyncResult {
  sportCode: string;
  providerEventId: string;
  markets: string[];
  rowsWritten: number;
  cost: number;
  latencyMs: number;
  error?: string;
}

/** Event-level player props pull (paid) for ONE provider event. */
export async function syncEventProps(
  sportCode: string,
  providerEventId: string,
  markets: string[],
): Promise<PropsSyncResult> {
  const started = Date.now();
  const result: PropsSyncResult = {
    sportCode,
    providerEventId,
    markets,
    rowsWritten: 0,
    cost: 0,
    latencyMs: 0,
  };
  const allowed = new Set(allowedPropMarkets(sportCode));
  const bad = markets.filter((m) => !allowed.has(m));
  if (bad.length > 0) {
    result.error = `unknown prop market keys for ${sportCode}: ${bad.join(", ")}`;
    return result; // never request invented keys
  }
  const db = getDb();
  const [keyRow] = await db
    .select()
    .from(oddsSportMap)
    .where(and(eq(oddsSportMap.sportCode, sportCode), eq(oddsSportMap.status, "active")))
    .limit(1);
  if (!keyRow) {
    result.error = "no active provider sport key";
    return result;
  }
  const [evRow] = await db
    .select()
    .from(events)
    .where(and(eq(events.provider, PROVIDER), eq(events.providerEventId, providerEventId)))
    .limit(1);
  if (!evRow) {
    result.error = "event not synced yet — sync core odds first";
    return result;
  }

  try {
    const provider = getOddsProvider();
    // player props are ONLY available via the event-level endpoint
    const res = await provider.getEventOdds(keyRow.providerSportKey, providerEventId, {
      regions: REGIONS(),
      markets,
      bookmakers: BOOKMAKERS(),
    });
    result.cost = res.quota.lastRequestCost ?? markets.length;
    await logUsage(
      `/v4/sports/${keyRow.providerSportKey}/events/{id}/odds (props)`,
      keyRow.providerSportKey,
      res.quota,
      res.latencyMs,
      "ok",
    );

    const now = new Date();
    const ev = res.data.providerEventId === providerEventId ? res.data : null;
    if (ev) {
      for (const bk of ev.bookmakers) {
        const bookId = await ensureSportsbook(bk.key, bk.title);
        for (const mkt of bk.markets) {
          if (!allowed.has(mkt.key)) continue; // belt-and-braces
          for (const o of mkt.outcomes) {
            const player = o.description;
            if (!player || !Number.isFinite(o.price)) continue;
            const side = o.name.toLowerCase() === "over" ? "over" : o.name.toLowerCase() === "under" ? "under" : null;
            if (!side) continue;
            // no-vig against the matching opposite side for this player
            const opp = mkt.outcomes.find(
              (x) => x.description === player && x.name.toLowerCase() === (side === "over" ? "under" : "over"),
            );
            const american = Math.round(o.price);
            const implied = americanToImplied(american);
            let noVig: number | null = null;
            if (opp && Number.isFinite(opp.price)) {
              const both = noVigN([american, Math.round(opp.price)]);
              noVig = both[0] ?? null;
            }
            const values = {
              eventId: evRow.id,
              sportsbookId: bookId,
              market: "prop" as const,
              outcome: `${player}|${side}`,
              line: o.point != null ? String(o.point) : null,
              americanOdds: american,
              decimalOdds: String(americanToDecimal(american)),
              impliedProb: String(implied),
              noVigProb: noVig != null ? String(noVig) : null,
              providerLastUpdate: new Date(mkt.lastUpdate),
              fetchedAt: now,
              isLive: false,
            };
            await db
              .insert(currentOdds)
              .values(values)
              .onDuplicateKeyUpdate({
                set: {
                  line: values.line,
                  americanOdds: values.americanOdds,
                  decimalOdds: values.decimalOdds,
                  impliedProb: values.impliedProb,
                  noVigProb: values.noVigProb,
                  providerLastUpdate: values.providerLastUpdate,
                  fetchedAt: values.fetchedAt,
                },
              });
            try {
              await db.insert(feedOddsSnapshots).values(values);
            } catch (e) {
              if ((e as { errno?: number })?.errno !== 1062) throw e;
            }
            result.rowsWritten++;
          }
        }
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    await logUsage(
      `/v4/sports/${keyRow.providerSportKey}/events/{id}/odds (props)`,
      keyRow.providerSportKey,
      null,
      Date.now() - started,
      "error",
      result.error,
    );
  }
  result.latencyMs = Date.now() - started;
  return result;
}

/** Free event discovery for one provider sport key (no odds, no credit cost). */
export async function discoverEvents(sportKey: string): Promise<{ count: number; latencyMs: number; error?: string }> {
  const provider = getOddsProvider();
  const started = Date.now();
  try {
    const res = await provider.listEvents(sportKey);
    await logUsage(`/v4/sports/${sportKey}/events`, sportKey, res.quota, res.latencyMs, "ok");
    return { count: res.data.length, latencyMs: Date.now() - started };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logUsage(`/v4/sports/${sportKey}/events`, sportKey, null, Date.now() - started, "error", msg);
    return { count: 0, latencyMs: Date.now() - started, error: msg };
  }
}

/* -------------------------------- status -------------------------------- */

export async function getFeedStatus() {
  const db = getDb();
  const [mode, quota, health, map, lastCalls] = await Promise.all([
    getFeedMode(),
    getQuotaState(),
    db.select().from(oddsFeedHealth),
    db.select().from(oddsSportMap),
    db.select().from(oddsApiUsage).orderBy(desc(oddsApiUsage.id)).limit(10),
  ]);
  return { mode, quota, health, map, lastCalls, providerConfigured: hasOddsProvider() };
}

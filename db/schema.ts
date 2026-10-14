import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  boolean,
  int,
  bigint,
  decimal,
  unique,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  /** scrypt hash for standalone email/password accounts; null for OAuth users */
  passwordHash: varchar("passwordHash", { length: 255 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  plan: mysqlEnum("plan", ["free", "pro"]).default("free").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/* ------------------------------ sports core ------------------------------ */

export const sports = mysqlTable("sports", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 16 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
  modelStatus: mysqlEnum("modelStatus", ["live", "training", "planned"])
    .default("planned")
    .notNull(),
});

export const teams = mysqlTable("teams", {
  id: serial("id").primaryKey(),
  sportId: bigint("sportId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => sports.id),
  name: varchar("name", { length: 64 }).notNull(),
  abbr: varchar("abbr", { length: 8 }).notNull(),
  city: varchar("city", { length: 64 }).notNull(),
  // model ratings (quant engine inputs)
  elo: int("elo").default(1500).notNull(),
  offEff: decimal("offEff", { precision: 5, scale: 2 }).default("0").notNull(),
  defEff: decimal("defEff", { precision: 5, scale: 2 }).default("0").notNull(),
});

export const events = mysqlTable("events", {
  id: serial("id").primaryKey(),
  sportId: bigint("sportId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => sports.id),
  homeTeamId: bigint("homeTeamId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => teams.id),
  awayTeamId: bigint("awayTeamId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => teams.id),
  startTime: timestamp("startTime").notNull(),
  status: mysqlEnum("status", ["scheduled", "live", "final"])
    .default("scheduled")
    .notNull(),
  venue: varchar("venue", { length: 128 }),
  weather: varchar("weather", { length: 255 }),
  injuries: text("injuries"),
  homeScore: int("homeScore"),
  awayScore: int("awayScore"),
  period: varchar("period", { length: 16 }),
  clock: varchar("clock", { length: 16 }),
  isDemo: boolean("isDemo").default(true).notNull(),
  /* production odds feed identity (null while DEMO-sourced) */
  provider: varchar("provider", { length: 32 }),
  providerEventId: varchar("providerEventId", { length: 128 }),
  oddsSyncedAt: timestamp("oddsSyncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const sportsbooks = mysqlTable("sportsbooks", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  providerKey: varchar("providerKey", { length: 64 }),
  region: varchar("region", { length: 8 }),
  lastSeenAt: timestamp("lastSeenAt"),
  code: varchar("code", { length: 16 }).notNull().unique(),
  affiliateUrl: text("affiliateUrl"),
  priority: int("priority").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
});

/* ------------------------- production odds feed -------------------------- */

/** Provider sport-key mapping — populated by live discovery, never assumed. */
export const oddsSportMap = mysqlTable("odds_sport_map", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sport_code", { length: 32 }).notNull(),
  providerSportKey: varchar("provider_sport_key", { length: 128 }).notNull(),
  providerTitle: varchar("provider_title", { length: 255 }),
  providerGroup: varchar("provider_group", { length: 64 }),
  hasOutrights: boolean("has_outrights").default(false).notNull(),
  status: mysqlEnum("status", ["active", "outrights_only", "unavailable"])
    .default("active")
    .notNull(),
  lastCheckedAt: timestamp("last_checked_at"),
});

/** Current odds — one row per event/book/market/outcome, fast frontend read. */
export const currentOdds = mysqlTable("current_odds", {
  id: serial("id").primaryKey(),
  eventId: bigint("event_id", { mode: "number", unsigned: true }).notNull(),
  sportsbookId: bigint("sportsbook_id", { mode: "number", unsigned: true }).notNull(),
  market: mysqlEnum("market", ["moneyline", "spread", "total", "prop"]).notNull(),
  outcome: varchar("outcome", { length: 64 }).notNull(),
  line: decimal("line", { precision: 8, scale: 2 }),
  americanOdds: int("american_odds").notNull(),
  decimalOdds: decimal("decimal_odds", { precision: 10, scale: 4 }).notNull(),
  impliedProb: decimal("implied_prob", { precision: 8, scale: 6 }).notNull(),
  noVigProb: decimal("no_vig_prob", { precision: 8, scale: 6 }),
  providerLastUpdate: timestamp("provider_last_update").notNull(),
  fetchedAt: timestamp("fetched_at").notNull(),
  isLive: boolean("is_live").default(false).notNull(),
});

/** Feed snapshot history — append-only, deduped by provider_last_update. */
export const feedOddsSnapshots = mysqlTable("feed_odds_snapshots", {
  id: serial("id").primaryKey(),
  eventId: bigint("event_id", { mode: "number", unsigned: true }).notNull(),
  sportsbookId: bigint("sportsbook_id", { mode: "number", unsigned: true }).notNull(),
  market: mysqlEnum("market", ["moneyline", "spread", "total", "prop"]).notNull(),
  outcome: varchar("outcome", { length: 64 }).notNull(),
  line: decimal("line", { precision: 8, scale: 2 }),
  americanOdds: int("american_odds").notNull(),
  decimalOdds: decimal("decimal_odds", { precision: 10, scale: 4 }).notNull(),
  impliedProb: decimal("implied_prob", { precision: 8, scale: 6 }).notNull(),
  noVigProb: decimal("no_vig_prob", { precision: 8, scale: 6 }),
  providerLastUpdate: timestamp("provider_last_update").notNull(),
  fetchedAt: timestamp("fetched_at").notNull(),
  isLive: boolean("is_live").default(false).notNull(),
});

/**
 * Outrights / futures — championship and division-winner markets. These are
 * the exception to the 8-day forecast horizon: a Super Bowl or division
 * title market is always in scope regardless of how far out it settles.
 */
export const oddsOutrights = mysqlTable("odds_outrights", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sport_code", { length: 32 }).notNull(),
  providerSportKey: varchar("provider_sport_key", { length: 128 }).notNull(),
  market: varchar("market", { length: 64 }).notNull(),
  sportsbookId: bigint("sportsbook_id", { mode: "number", unsigned: true }).notNull(),
  participant: varchar("participant", { length: 128 }).notNull(),
  americanOdds: int("american_odds").notNull(),
  decimalOdds: decimal("decimal_odds", { precision: 10, scale: 4 }).notNull(),
  impliedProb: decimal("implied_prob", { precision: 8, scale: 6 }).notNull(),
  noVigProb: decimal("no_vig_prob", { precision: 8, scale: 6 }),
  providerLastUpdate: timestamp("provider_last_update").notNull(),
  fetchedAt: timestamp("fetched_at").notNull(),
});

/** Outright snapshot history — append-only, deduped by provider timestamp. */
export const oddsOutrightSnapshots = mysqlTable("odds_outright_snapshots", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sport_code", { length: 32 }).notNull(),
  providerSportKey: varchar("provider_sport_key", { length: 128 }).notNull(),
  market: varchar("market", { length: 64 }).notNull(),
  sportsbookId: bigint("sportsbook_id", { mode: "number", unsigned: true }).notNull(),
  participant: varchar("participant", { length: 128 }).notNull(),
  americanOdds: int("american_odds").notNull(),
  decimalOdds: decimal("decimal_odds", { precision: 10, scale: 4 }).notNull(),
  impliedProb: decimal("implied_prob", { precision: 8, scale: 6 }).notNull(),
  noVigProb: decimal("no_vig_prob", { precision: 8, scale: 6 }),
  providerLastUpdate: timestamp("provider_last_update").notNull(),
  fetchedAt: timestamp("fetched_at").notNull(),
});

/** Quota tracking straight from provider response headers. */
export const oddsApiUsage = mysqlTable("odds_api_usage", {
  id: serial("id").primaryKey(),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  sportKey: varchar("sport_key", { length: 128 }),
  cost: int("cost").default(1).notNull(),
  requestsUsed: int("requests_used"),
  requestsRemaining: int("requests_remaining"),
  latencyMs: int("latency_ms"),
  status: varchar("status", { length: 16 }).default("ok").notNull(),
  message: varchar("message", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Feed health per sport. */
export const oddsFeedHealth = mysqlTable("odds_feed_health", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sport_code", { length: 32 }).notNull().unique(),
  status: mysqlEnum("status", ["healthy", "warning", "degraded", "offline", "unavailable"])
    .default("offline")
    .notNull(),
  lastSuccessAt: timestamp("last_success_at"),
  lastFailureAt: timestamp("last_failure_at"),
  consecutiveFailures: int("consecutive_failures").default(0).notNull(),
  message: varchar("message", { length: 255 }),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/* ------------------------------ odds & model ----------------------------- */

export const oddsSnapshots = mysqlTable("odds_snapshots", {
  id: serial("id").primaryKey(),
  eventId: bigint("eventId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => events.id),
  sportsbookId: bigint("sportsbookId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => sportsbooks.id),
  market: mysqlEnum("market", ["moneyline", "spread", "total"]).notNull(),
  // home|away for ml/spread, over|under for total
  selection: varchar("selection", { length: 16 }).notNull(),
  line: decimal("line", { precision: 6, scale: 1 }),
  odds: int("odds").notNull(), // American odds
  isLive: boolean("isLive").default(false).notNull(),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
});

export const predictions = mysqlTable("predictions", {
  id: serial("id").primaryKey(),
  eventId: bigint("eventId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => events.id),
  modelId: varchar("modelId", { length: 48 }).notNull().default("nfl-ensemble"),
  modelVersion: varchar("modelVersion", { length: 32 }).notNull(),
  projHomeScore: decimal("projHomeScore", { precision: 6, scale: 1 }).notNull(),
  projAwayScore: decimal("projAwayScore", { precision: 6, scale: 1 }).notNull(),
  projSpread: decimal("projSpread", { precision: 6, scale: 1 }).notNull(), // home perspective
  projTotal: decimal("projTotal", { precision: 6, scale: 1 }).notNull(),
  homeWinProb: decimal("homeWinProb", { precision: 5, scale: 4 }).notNull(),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull(),
  agreement: varchar("agreement", { length: 8 }), // e.g. "4/4"
  details: text("details"), // JSON: sport-specific distribution params + component votes
  isLive: boolean("isLive").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const aiPicks = mysqlTable("ai_picks", {
  id: serial("id").primaryKey(),
  eventId: bigint("eventId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => events.id),
  market: mysqlEnum("market", ["moneyline", "spread", "total"]).notNull(),
  selection: varchar("selection", { length: 16 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const aiPickVersions = mysqlTable("ai_pick_versions", {
  id: serial("id").primaryKey(),
  pickId: bigint("pickId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => aiPicks.id),
  version: int("version").notNull(),
  line: decimal("line", { precision: 6, scale: 1 }),
  odds: int("odds").notNull(),
  sportsbookId: bigint("sportsbookId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => sportsbooks.id),
  modelProb: decimal("modelProb", { precision: 5, scale: 4 }).notNull(),
  /** working probability: modelProb after calibration + market anchoring */
  anchoredProb: decimal("anchoredProb", { precision: 5, scale: 4 }),
  /** quarter-Kelly stake guidance (fraction of bankroll) from anchoredProb */
  kelly: decimal("kelly", { precision: 5, scale: 4 }),
  impliedProb: decimal("impliedProb", { precision: 5, scale: 4 }).notNull(),
  noVigProb: decimal("noVigProb", { precision: 5, scale: 4 }),
  probEdge: decimal("probEdge", { precision: 5, scale: 4 }).notNull(),
  ev: decimal("ev", { precision: 6, scale: 4 }).notNull(),
  edgeScore: int("edgeScore").notNull(),
  confidence: decimal("confidence", { precision: 4, scale: 3 }),
  modelAgreement: varchar("modelAgreement", { length: 8 }),
  modelVersion: varchar("modelVersion", { length: 32 }),
  featureVersion: varchar("featureVersion", { length: 32 }),
  status: mysqlEnum("status", [
    "STRONG_BET",
    "BET",
    "WATCH",
    "HOLD",
    "PASS",
  ]).notNull(),
  betUpTo: decimal("betUpTo", { precision: 6, scale: 1 }),
  changeReason: text("changeReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const playerProps = mysqlTable("player_props", {
  id: serial("id").primaryKey(),
  eventId: bigint("eventId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => events.id),
  sportsbookId: bigint("sportsbookId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => sportsbooks.id),
  player: varchar("player", { length: 64 }).notNull(),
  teamAbbr: varchar("teamAbbr", { length: 8 }).notNull(),
  market: varchar("market", { length: 64 }).notNull(),
  line: decimal("line", { precision: 6, scale: 1 }).notNull(),
  overOdds: int("overOdds").notNull(),
  underOdds: int("underOdds").notNull(),
  projValue: decimal("projValue", { precision: 6, scale: 1 }).notNull(),
  probOver: decimal("probOver", { precision: 5, scale: 4 }).notNull(),
  evOver: decimal("evOver", { precision: 6, scale: 4 }).notNull(),
  lean: varchar("lean", { length: 8 }), // "over" | "under" — the value side
  evLean: decimal("evLean", { precision: 6, scale: 4 }), // anchored EV of the lean side
  status: varchar("status", { length: 16 }).default("PASS").notNull(), // PASS | WATCH | BET | STRONG_BET
  edgeScore: int("edgeScore").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

/* ------------------------- performance & history ------------------------- */

export const pickHistory = mysqlTable("pick_history", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  market: varchar("market", { length: 32 }).notNull(),
  eventLabel: varchar("eventLabel", { length: 128 }).notNull(),
  selection: varchar("selection", { length: 128 }).notNull(),
  odds: int("odds").notNull(),
  edgeScore: int("edgeScore").notNull(),
  modelProb: decimal("modelProb", { precision: 5, scale: 4 }), // for calibration
  result: mysqlEnum("result", ["won", "lost", "push"]).notNull(),
  units: decimal("units", { precision: 6, scale: 2 }).notNull(),
  clv: decimal("clv", { precision: 6, scale: 3 }).notNull(), // % closing line value (raw implied)
  /** % CLV measured against the no-vig closing price (null = not computable) */
  clvNoVig: decimal("clvNoVig", { precision: 6, scale: 3 }),
  /** no-vig fair probability of the selection at the close — the market's answer key */
  closeFairProb: decimal("closeFairProb", { precision: 5, scale: 4 }),
  placedAt: timestamp("placedAt").notNull(),
  /** when the game actually finished (real-world completion), not when our
   *  feed happened to import the result. Charts/month grouping use this so a
   *  late score-sync doesn't make a pick look graded at import time. */
  completedAt: timestamp("completedAt"),
  // Grading idempotency key (plain column, no FK: graded history must
  // survive any later pick cleanup — history is never altered).
  pickId: bigint("pickId", { mode: "number", unsigned: true }),
});

/* ------------------------------ user features ---------------------------- */

/**
 * Saved picks — a user's personal watchlist of AI picks (heart button on
 * every pick card). References the pick, not a version: versions rotate as
 * the market moves, but the saved pick itself must persist. Only saved
 * while the event is not final; graded results are looked up from
 * pick_history at read time.
 */
export const savedPicks = mysqlTable("saved_picks", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  pickId: bigint("pickId", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Customer testimonials — admin-moderated reviews.
 * Submissions arrive as "pending" and are invisible to the public until an
 * administrator approves them. `verified` marks a confirmed customer;
 * `featured` pins a review to the front of the homepage carousel.
 * The 26 illustrative homepage examples live ONLY in frontend code — they
 * are never seeded into this table and never become "real" reviews.
 */
export const testimonials = mysqlTable("testimonials", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  displayName: varchar("displayName", { length: 64 }).notNull(),
  rating: int("rating").notNull(), // 1–5 stars, exactly as submitted
  text: varchar("text", { length: 1000 }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"])
    .default("pending")
    .notNull(),
  verified: int("verified").default(0).notNull(),
  featured: int("featured").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const userBets = mysqlTable("user_bets", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  sport: varchar("sport", { length: 16 }).notNull(),
  eventLabel: varchar("eventLabel", { length: 128 }).notNull(),
  market: varchar("market", { length: 32 }).notNull(),
  selection: varchar("selection", { length: 128 }).notNull(),
  line: decimal("line", { precision: 6, scale: 1 }),
  odds: int("odds").notNull(),
  stake: decimal("stake", { precision: 10, scale: 2 }).notNull(),
  result: mysqlEnum("result", ["pending", "won", "lost", "push"])
    .default("pending")
    .notNull(),
  profit: decimal("profit", { precision: 10, scale: 2 }).default("0").notNull(),
  closingLine: decimal("closingLine", { precision: 6, scale: 1 }),
  placedAt: timestamp("placedAt").defaultNow().notNull(),
  settledAt: timestamp("settledAt"),
});

export const alerts = mysqlTable("alerts", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 32 }).notNull(), // pick_change | line_move | injury | system
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const adminConfig = mysqlTable("admin_config", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
});

export const apiLogs = mysqlTable("api_logs", {
  id: serial("id").primaryKey(),
  service: varchar("service", { length: 64 }).notNull(),
  level: mysqlEnum("level", ["info", "warn", "error"]).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* ------------------------- model registry (§12/29) ------------------------ */

/** Sport-specific quantitative inputs for a competitor (team or player). */
export const teamRatings = mysqlTable("team_ratings", {
  id: serial("id").primaryKey(),
  teamId: bigint("teamId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => teams.id),
  featureVersion: varchar("featureVersion", { length: 32 }).notNull(),
  ratings: text("ratings").notNull(), // JSON — sport-specific feature set
  /** 1 = hand-calibrated/seeded rating; 0 = auto-persisted league prior */
  isCalibrated: int("isCalibrated").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

/** Model registry: one row per sport model, with ensemble + validation metadata. */
export const models = mysqlTable("models", {
  id: serial("id").primaryKey(),
  modelId: varchar("modelId", { length: 48 }).notNull().unique(), // e.g. nba-ensemble
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  name: varchar("name", { length: 96 }).notNull(),
  modelVersion: varchar("modelVersion", { length: 32 }).notNull(),
  featureVersion: varchar("featureVersion", { length: 32 }).notNull(),
  components: text("components").notNull(), // JSON [{name, weight}]
  trainingPeriod: varchar("trainingPeriod", { length: 64 }).notNull(),
  validationPeriod: varchar("validationPeriod", { length: 64 }).notNull(),
  trainedAt: timestamp("trainedAt").notNull(),
  metrics: text("metrics").notNull(), // JSON validation metrics (brier, logloss, roi...)
  status: mysqlEnum("status", ["production", "candidate", "disabled"])
    .default("production")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Continuous model-health monitoring (§22). */
export const modelHealth = mysqlTable("model_health", {
  id: serial("id").primaryKey(),
  modelId: varchar("modelId", { length: 48 }).notNull(),
  status: mysqlEnum("status", ["HEALTHY", "WARNING", "DEGRADED", "DISABLED"])
    .notNull(),
  checks: text("checks").notNull(), // JSON [{name, ok, detail}]
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

/** Monte Carlo simulation runs (§18) — full distributions, not just picks. */
export const simulationRuns = mysqlTable("simulation_runs", {
  id: serial("id").primaryKey(),
  eventId: bigint("eventId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => events.id),
  modelId: varchar("modelId", { length: 48 }).notNull(),
  sims: int("sims").notNull(),
  distribution: text("distribution").notNull(), // JSON outcome distribution
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Probability calibration results per model/market (§13). */
export const calibrationResults = mysqlTable("calibration_results", {
  id: serial("id").primaryKey(),
  modelId: varchar("modelId", { length: 48 }).notNull(),
  market: varchar("market", { length: 32 }).notNull(),
  sampleSize: int("sampleSize").notNull(),
  brier: decimal("brier", { precision: 7, scale: 5 }).notNull(),
  logLoss: decimal("logLoss", { precision: 7, scale: 5 }).notNull(),
  ece: decimal("ece", { precision: 7, scale: 5 }).notNull(),
  buckets: text("buckets").notNull(), // JSON reliability curve [{p, freq, n}]
  computedAt: timestamp("computedAt").defaultNow().notNull(),
});

/** Chronological out-of-sample backtests (§19). */
export const backtests = mysqlTable("backtests", {
  id: serial("id").primaryKey(),
  modelId: varchar("modelId", { length: 48 }).notNull(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  trainWindow: varchar("trainWindow", { length: 64 }).notNull(),
  testWindow: varchar("testWindow", { length: 64 }).notNull(),
  picks: int("picks").notNull(),
  wins: int("wins").notNull(),
  losses: int("losses").notNull(),
  pushes: int("pushes").notNull(),
  winRate: decimal("winRate", { precision: 5, scale: 4 }).notNull(),
  roi: decimal("roi", { precision: 7, scale: 4 }).notNull(),
  units: decimal("units", { precision: 8, scale: 2 }).notNull(),
  avgClv: decimal("avgClv", { precision: 6, scale: 3 }).notNull(),
  brier: decimal("brier", { precision: 7, scale: 5 }).notNull(),
  logLoss: decimal("logLoss", { precision: 7, scale: 5 }).notNull(),
  maxDrawdown: decimal("maxDrawdown", { precision: 7, scale: 2 }).notNull(),
  avgOdds: int("avgOdds").notNull(),
  byEdge: text("byEdge").notNull(), // JSON per-edge-band breakdown
  computedAt: timestamp("computedAt").defaultNow().notNull(),
});

/** Closing lines captured at event start for CLV (§20). */
export const closingLines = mysqlTable("closing_lines", {
  id: serial("id").primaryKey(),
  pickId: bigint("pickId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => aiPicks.id),
  line: decimal("line", { precision: 6, scale: 1 }),
  odds: int("odds").notNull(),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
});

/* ----------------- prediction-market intelligence (read-only) ----------------- */

/**
 * A prediction-market event (Kalshi or Polymarket) matched, where possible,
 * to a first-class `events` row from the sportsbook feed. Everything in
 * these tables is PUBLIC market data fetched from free read-only endpoints —
 * no credentials, no trading, no order execution.
 */
export const pmEvents = mysqlTable("pm_events", {
  id: serial("id").primaryKey(),
  venue: mysqlEnum("venue", ["KALSHI", "POLYMARKET"]).notNull(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  /** venue-native identity: Kalshi event_ticker / Polymarket event slug */
  venueEventId: varchar("venueEventId", { length: 191 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  homeTeam: varchar("homeTeam", { length: 128 }),
  awayTeam: varchar("awayTeam", { length: 128 }),
  startTime: timestamp("startTime"),
  /** matched events.id (plain column — prediction markets must never
   *  constrain the sportsbook pipeline) */
  eventId: bigint("eventId", { mode: "number", unsigned: true }),
  status: varchar("status", { length: 16 }).default("open").notNull(), // open | closed
  url: varchar("url", { length: 255 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

/** One outcome side of a prediction-market contract, normalized. */
export const pmMarkets = mysqlTable("pm_markets", {
  id: serial("id").primaryKey(),
  pmEventId: bigint("pmEventId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => pmEvents.id),
  /** venue-native market id: Kalshi market ticker / Polymarket condition id */
  venueMarketId: varchar("venueMarketId", { length: 191 }).notNull(),
  market: mysqlEnum("market", ["moneyline", "spread", "total"]).notNull(),
  selection: varchar("selection", { length: 16 }).notNull(), // home | away | draw | over | under
  line: decimal("line", { precision: 8, scale: 2 }),
  /** normalized 0..1 pricing for THIS selection */
  bid: decimal("bid", { precision: 8, scale: 6 }),
  ask: decimal("ask", { precision: 8, scale: 6 }),
  mid: decimal("mid", { precision: 8, scale: 6 }),
  lastPrice: decimal("lastPrice", { precision: 8, scale: 6 }),
  volume: decimal("volume", { precision: 16, scale: 2 }),
  volume24h: decimal("volume24h", { precision: 16, scale: 2 }),
  liquidity: decimal("liquidity", { precision: 16, scale: 2 }),
  /** Polymarket CLOB token id for this side (price-history lookups) */
  tokenId: varchar("tokenId", { length: 96 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

/** Append-only prediction-market price history (feeds the trend charts). */
export const pmPriceSnapshots = mysqlTable("pm_price_snapshots", {
  id: serial("id").primaryKey(),
  pmMarketId: bigint("pmMarketId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => pmMarkets.id),
  mid: decimal("mid", { precision: 8, scale: 6 }).notNull(),
  bid: decimal("bid", { precision: 8, scale: 6 }),
  ask: decimal("ask", { precision: 8, scale: 6 }),
  volume: decimal("volume", { precision: 16, scale: 2 }),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
});

/* ---------------------- v2 trained-model infrastructure ---------------------- */

/**
 * Real completed game results ingested from official free sources
 * (ESPN scoreboard API, MLB Stats API, NHL API). This is the training
 * corpus for the v2 models — real historical outcomes only, never
 * fabricated. Deduped by (sportCode, source, sourceGameId).
 */
/** Real per-player game results from free official APIs (NHL boxscores).
 *  The foundation of the player-prop model: rolling stats are computed only
 *  from rows here — never fabricated. */
export const playerGameLogs = mysqlTable("player_game_logs", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  playerId: varchar("playerId", { length: 32 }).notNull(), // provider player id
  player: varchar("player", { length: 64 }).notNull(),
  teamAbbr: varchar("teamAbbr", { length: 8 }).notNull(),
  gameDate: varchar("gameDate", { length: 10 }).notNull(), // YYYY-MM-DD
  /** stat bag: { goals, assists, points, shots, toiMinutes, ... } per sport */
  stats: text("stats").notNull(),
}, (t) => [unique("uq_player_game_logs").on(t.sportCode, t.playerId, t.gameDate)]);

/** Graded prop record — same append-only discipline as pick_history. */
export const propHistory = mysqlTable("prop_history", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  market: varchar("market", { length: 64 }).notNull(),
  eventLabel: varchar("eventLabel", { length: 128 }).notNull(),
  player: varchar("player", { length: 64 }).notNull(),
  selection: varchar("selection", { length: 128 }).notNull(),
  odds: int("odds").notNull(),
  line: decimal("line", { precision: 6, scale: 1 }),
  modelProb: decimal("modelProb", { precision: 5, scale: 4 }),
  result: mysqlEnum("result", ["won", "lost", "push"]).notNull(),
  units: decimal("units", { precision: 6, scale: 2 }).notNull(),
  placedAt: timestamp("placedAt").notNull(),
  completedAt: timestamp("completedAt"),
  pickId: bigint("pickId", { mode: "number", unsigned: true }), // idempotency key = player_props.id
});

export const gameResults = mysqlTable("game_results", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  source: varchar("source", { length: 32 }).notNull(), // ESPN | MLB_STATS | NHL_API
  sourceGameId: varchar("sourceGameId", { length: 64 }).notNull(),
  gameDate: varchar("gameDate", { length: 10 }).notNull(), // YYYY-MM-DD
  startTime: timestamp("startTime"),
  homeName: varchar("homeName", { length: 128 }).notNull(),
  awayName: varchar("awayName", { length: 128 }).notNull(),
  homeScore: int("homeScore").notNull(),
  awayScore: int("awayScore").notNull(),
  neutral: boolean("neutral").default(false).notNull(),
  completed: boolean("completed").default(true).notNull(),
  surface: varchar("surface", { length: 16 }), // tennis only: hard | clay | grass
});

/** Walk-forward validation record per sport/model — objective proof that a
 *  v2 model outperforms its v1 baseline before it is deployed. */
export const modelValidation = mysqlTable("model_validation", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  modelVersion: varchar("modelVersion", { length: 32 }).notNull(), // v1 | v2
  gamesEvaluated: int("gamesEvaluated").notNull(),
  brier: decimal("brier", { precision: 9, scale: 6 }).notNull(),
  logLoss: decimal("logLoss", { precision: 9, scale: 6 }).notNull(),
  maeMargin: decimal("maeMargin", { precision: 8, scale: 3 }),
  maeTotal: decimal("maeTotal", { precision: 8, scale: 3 }),
  trainedGames: int("trainedGames").notNull(),
  evaluatedAt: timestamp("evaluatedAt").defaultNow().notNull(),
});


/* ============================================================================
 * MARKET INTELLIGENCE UPGRADE V2
 *
 * Prediction-market (Kalshi + Polymarket) intelligence, sport-specific PM
 * models, a 3-way fusion engine (A = sports model, B = prediction-market,
 * C = validated blend), and shadow-mode validation. Append-only and
 * versioned everywhere — the existing sports models, their weights, grading
 * history and decision engine are NOT touched.
 *
 * Deployment discipline (spec §Phase 3/4/7): the fusion weight starts at
 * pure Model A (PM weight 0) and only earns influence through forward-tested
 * evidence recorded in fusion_shadow. Nothing here fabricates a probability
 * or a validation metric.
 * ========================================================================== */

/** Per-sport prediction-market model runtime state + enable switch. */
export const pmSportModels = mysqlTable("pm_sport_models", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sportCode", { length: 16 }).notNull().unique(),
  /** admin toggle: is this sport's PM intelligence active at all */
  enabled: boolean("enabled").default(true).notNull(),
  /** does Kalshi/Polymarket actually list markets for this sport */
  hasCoverage: boolean("hasCoverage").default(false).notNull(),
  /** current learned PM weight in the fusion (0 = Model A only). Starts 0. */
  fusionWeight: decimal("fusionWeight", { precision: 5, scale: 4 }).default("0").notNull(),
  /** lifecycle: collecting -> shadow -> candidate -> live (per sport) */
  lifecycle: varchar("lifecycle", { length: 16 }).default("collecting").notNull(),
  /** count of forward-tested settled predictions informing fusionWeight */
  forwardSample: int("forwardSample").default(0).notNull(),
  /** JSON: sport-specific learned parameters (movement sensitivity etc.) */
  params: text("params"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

/**
 * Market-intelligence feature snapshot for one matched event+market at a
 * point in time. Append-only; each row is a full readout of the 11 Phase-1
 * features plus the detected behavior flags. Never overwritten.
 */
export const pmIntelSnapshots = mysqlTable("pm_intel_snapshots", {
  id: serial("id").primaryKey(),
  eventId: bigint("eventId", { mode: "number", unsigned: true }).notNull(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  market: varchar("market", { length: 16 }).notNull(), // moneyline | spread | total
  selection: varchar("selection", { length: 16 }).notNull(),
  /** the 11 Phase-1 features + behavior flags, as JSON (see pm-intel.ts) */
  features: text("features").notNull(),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
}, (t) => [unique("uq_pm_intel").on(t.eventId, t.market, t.selection, t.capturedAt)]);

/**
 * Shadow-mode prediction record: for each live pick, what Model A, Model B
 * and Model C each said, with full inputs and version stamps. This is the
 * forward-testing evidence base — graded later against real outcomes.
 * Append-only; a row is created at pick time and `result`/`brierA/B/C`
 * filled only when the game settles (no look-ahead).
 */
export const fusionShadow = mysqlTable("fusion_shadow", {
  id: serial("id").primaryKey(),
  pickId: bigint("pickId", { mode: "number", unsigned: true }).notNull(),
  eventId: bigint("eventId", { mode: "number", unsigned: true }).notNull(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  market: varchar("market", { length: 16 }).notNull(),
  selection: varchar("selection", { length: 16 }).notNull(),
  /** Model A: existing sports model working probability */
  probA: decimal("probA", { precision: 8, scale: 6 }).notNull(),
  /** Model B: prediction-market probability (null when no PM coverage) */
  probB: decimal("probB", { precision: 8, scale: 6 }),
  /** Model C: fused probability with the weight in effect at pick time */
  probC: decimal("probC", { precision: 8, scale: 6 }).notNull(),
  /** the PM weight actually used for probC (0 = pure Model A) */
  weightUsed: decimal("weightUsed", { precision: 5, scale: 4 }).notNull(),
  /** sportsbook no-vig consensus at pick time (the price we bet against) */
  bookProb: decimal("bookProb", { precision: 8, scale: 6 }),
  /** PM liquidity/volume + data-quality at pick time */
  pmLiquidity: decimal("pmLiquidity", { precision: 16, scale: 2 }),
  dataQuality: decimal("dataQuality", { precision: 5, scale: 4 }),
  /** model versions for reproducibility */
  modelVersionA: varchar("modelVersionA", { length: 32 }),
  modelVersionB: varchar("modelVersionB", { length: 32 }),
  /** filled at settlement: 1 = selection won, 0 = lost (push excluded) */
  outcome: int("outcome"),
  brierA: decimal("brierA", { precision: 9, scale: 6 }),
  brierB: decimal("brierB", { precision: 9, scale: 6 }),
  brierC: decimal("brierC", { precision: 9, scale: 6 }),
  placedAt: timestamp("placedAt").defaultNow().notNull(),
  settledAt: timestamp("settledAt"),
}, (t) => [unique("uq_fusion_shadow").on(t.pickId)]);

/**
 * Fusion weight change audit — every time a sport's PM weight moves, why,
 * and the evidence behind it. Append-only; weights never change silently.
 */
export const fusionWeightLog = mysqlTable("fusion_weight_log", {
  id: serial("id").primaryKey(),
  sportCode: varchar("sportCode", { length: 16 }).notNull(),
  market: varchar("market", { length: 16 }), // null = sport-wide
  prevWeight: decimal("prevWeight", { precision: 5, scale: 4 }).notNull(),
  nextWeight: decimal("nextWeight", { precision: 5, scale: 4 }).notNull(),
  /** evidence snapshot: forward sample, Brier A vs C, decision rationale */
  evidence: text("evidence").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Admin config for the intelligence layer (per-sport enable already on
 *  pm_sport_models; this holds global toggles + promotion thresholds). */
export const pmIntelConfig = mysqlTable("pm_intel_config", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

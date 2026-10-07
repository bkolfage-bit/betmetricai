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
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const sportsbooks = mysqlTable("sportsbooks", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  code: varchar("code", { length: 16 }).notNull().unique(),
  affiliateUrl: text("affiliateUrl"),
  priority: int("priority").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
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
  modelVersion: varchar("modelVersion", { length: 32 }).notNull(),
  projHomeScore: decimal("projHomeScore", { precision: 5, scale: 1 }).notNull(),
  projAwayScore: decimal("projAwayScore", { precision: 5, scale: 1 }).notNull(),
  projSpread: decimal("projSpread", { precision: 5, scale: 1 }).notNull(), // home perspective
  projTotal: decimal("projTotal", { precision: 5, scale: 1 }).notNull(),
  homeWinProb: decimal("homeWinProb", { precision: 5, scale: 4 }).notNull(),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull(),
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
  impliedProb: decimal("impliedProb", { precision: 5, scale: 4 }).notNull(),
  probEdge: decimal("probEdge", { precision: 5, scale: 4 }).notNull(),
  ev: decimal("ev", { precision: 6, scale: 4 }).notNull(),
  edgeScore: int("edgeScore").notNull(),
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
  result: mysqlEnum("result", ["won", "lost", "push"]).notNull(),
  units: decimal("units", { precision: 6, scale: 2 }).notNull(),
  clv: decimal("clv", { precision: 6, scale: 3 }).notNull(), // % closing line value
  placedAt: timestamp("placedAt").notNull(),
});

/* ------------------------------ user features ---------------------------- */

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

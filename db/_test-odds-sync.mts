/**
 * Live connection test against the production API (spec §testing):
 *   1. /v4/sports discovery  -> persists the sport map (free)
 *   2. free event discovery  -> one key per mapped sport (cost 0)
 *   3. NFL core odds sync    -> first paid call, measures credit cost
 *   4. sample verification   -> current_odds + feed_odds_snapshots counts
 * No test is reported as passed unless it really ran against the live API.
 */
import "dotenv/config";
import { discoverSports, discoverEvents, syncSportOdds, getQuotaState } from "../api/feed/service";
import { getDb } from "../api/queries/connection";
import { currentOdds, feedOddsSnapshots } from "./schema";
import { sql } from "drizzle-orm";

const line = "-".repeat(64);

console.log(line);
console.log("STEP 1: SPORT DISCOVERY (free)");
const disc = await discoverSports();
console.log(`connected: ${disc.connected} | provider sports: ${disc.providerSports} | latency ${disc.latencyMs}ms`);
console.log(`quota: used=${disc.quota?.requestsUsed} remaining=${disc.quota?.requestsRemaining} lastCost=${disc.quota?.lastRequestCost}`);
for (const m of disc.mapped) {
  console.log(`  ${m.code.padEnd(12)} ${m.status.padEnd(15)} ${m.keys.join(", ") || "-"}`);
}
if (!disc.connected) {
  console.log("DISCOVERY FAILED:", disc.error);
  process.exit(1);
}

console.log(line);
console.log("STEP 2: FREE EVENT DISCOVERY (one key per active sport)");
for (const m of disc.mapped.filter((x) => x.status === "active")) {
  const key = m.keys[0];
  const r = await discoverEvents(key);
  console.log(`  ${m.code.padEnd(12)} ${key.padEnd(34)} events=${r.count}${r.error ? " ERROR: " + r.error : ""}`);
}

console.log(line);
console.log("STEP 3: NFL CORE ODDS SYNC (paid, cost measured)");
const before = await getQuotaState();
const sync = await syncSportOdds("NFL");
const after = await getQuotaState();
console.log(`sportKeys: ${sync.sportKeys.join(", ")}`);
console.log(`events with odds: ${sync.eventsWithOdds} | rows written: ${sync.rowsWritten} | snapshots: ${sync.snapshotsWritten} | dedup-skipped: ${sync.skippedByDedup}`);
console.log(`cost (provider header): ${sync.cost} | latency: ${sync.latencyMs}ms`);
console.log(`quota before: remaining=${before.remaining} -> after: remaining=${after.remaining}`);
if (sync.errors.length) console.log("errors:", sync.errors);

console.log(line);
console.log("STEP 4: DB VERIFICATION");
const db = getDb();
const [c] = await db.select({ n: sql<number>`COUNT(*)` }).from(currentOdds);
const [s] = await db.select({ n: sql<number>`COUNT(*)` }).from(feedOddsSnapshots);
console.log(`current_odds rows: ${c.n} | feed_odds_snapshots rows: ${s.n}`);
const sample = await db.select().from(currentOdds).limit(6);
for (const r of sample) {
  console.log(`  event=${r.eventId} book=${r.sportsbookId} ${r.market}/${r.outcome} line=${r.line} odds=${r.americanOdds} implied=${r.impliedProb} novig=${r.noVigProb}`);
}
console.log(line);
console.log("TEST COMPLETE");
process.exit(0);

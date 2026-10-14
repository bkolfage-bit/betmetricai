import "dotenv/config";
import { syncSportOdds, getQuotaState } from "../api/feed/service";
import { getDb } from "../api/queries/connection";
import { sportsbooks } from "./schema";
import { sql } from "drizzle-orm";

const before = await getQuotaState();
const r = await syncSportOdds("NFL");
console.log(`NFL re-sync: events=${r.eventsWithOdds} rows=${r.rowsWritten} cost=${r.cost} ${r.errors.join(";") || ""}`);
const after = await getQuotaState();
console.log(`quota: ${before.remaining} -> ${after.remaining}`);

const db = getDb();
const wanted = ["ballybet","betanysports","courtside","espnbet","hardrockbet","hardrockbet_fl","rebet"];
const rows = await db.select().from(sportsbooks);
console.log("\nrequested books now present:");
for (const k of wanted) {
  const hit = rows.find(b => b.providerKey === k);
  console.log(`  ${k.padEnd(16)} ${hit ? `FOUND -> ${hit.name} (id ${hit.id})` : "not in payload"}`);
}
process.exit(0);

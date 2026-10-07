import "dotenv/config";
import { syncSportOdds, getQuotaState } from "../api/feed/service";
for (const code of ["NBA", "NHL", "NCAAF", "MLB", "UFC", "TENNIS", "SOCCER"]) {
  const r = await syncSportOdds(code);
  console.log(`${code.padEnd(8)} events=${r.eventsWithOdds} rows=${r.rowsWritten} cost=${r.cost} ${r.errors.length ? "ERR: " + r.errors.join(";") : ""}`);
}
const q = await getQuotaState();
console.log(`quota: used=${q.used} remaining=${q.remaining} tier=${q.tier}`);
process.exit(0);

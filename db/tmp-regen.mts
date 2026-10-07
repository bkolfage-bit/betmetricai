import { getDb } from "../api/queries/connection";
import { events, sports } from "./schema";
import { and, eq, gt } from "drizzle-orm";
import { ensurePrediction, ensureEventPicks } from "../api/feed/service";

const db = getDb();
const rows = await db.select({ id: events.id, code: sports.code }).from(events)
  .innerJoin(sports, eq(sports.id, events.sportId))
  .where(and(eq(events.isDemo, false), eq(events.status, "scheduled"), gt(events.startTime, new Date())));
console.log("regenerating", rows.length, "events");
let ok = 0, fail = 0;
for (const r of rows) {
  const made = await ensurePrediction(r.id, r.code);
  if (made) { ok++; await ensureEventPicks(r.id, r.code); } else fail++;
}
console.log("created:", ok, "failed:", fail);
process.exit(0);

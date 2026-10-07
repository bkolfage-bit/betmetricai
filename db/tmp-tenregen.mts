import { getDb } from "../api/queries/connection";
import { events, sports, predictions } from "./schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { ensurePrediction, ensureEventPicks } from "../api/feed/service";

const db = getDb();
// tennis events currently missing a prediction
const rows = await db.select({ id: events.id }).from(events)
  .innerJoin(sports, eq(sports.id, events.sportId))
  .leftJoin(predictions, eq(predictions.eventId, events.id))
  .where(and(eq(sports.code, "TENNIS"), eq(events.isDemo, false), eq(events.status, "scheduled"), gt(events.startTime, new Date()), isNull(predictions.id)));
console.log("tennis events to regen:", rows.length);
let ok = 0;
for (const r of rows) { if (await ensurePrediction(r.id, "TENNIS")) { ok++; await ensureEventPicks(r.id, "TENNIS"); } }
console.log("regenerated:", ok);
process.exit(0);

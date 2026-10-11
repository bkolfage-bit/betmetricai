import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";
const db = getDb();
// most recent graded rows
const recent: any = await db.execute(sql`
  SELECT ph.id, ph.sportCode, ph.eventLabel, ph.result, ph.completedAt, ph.placedAt, e.startTime, e.status
  FROM pick_history ph
  LEFT JOIN ai_picks p ON ph.pickId=p.id
  LEFT JOIN events e ON p.eventId=e.id
  ORDER BY ph.id DESC LIMIT 12`);
console.log("latest graded rows:");
for (const r of recent[0]) console.log(` ${r.sportCode} ${r.eventLabel} | ${r.result} | completed ${r.completedAt} | event start ${r.startTime} status=${r.status}`);
// finals from today that have picks but no grading
const todayFinals: any = await db.execute(sql`
  SELECT e.id, e.startTime, e.status, s.code, ht.abbr h, at2.abbr a,
    (SELECT COUNT(*) FROM ai_picks p WHERE p.eventId=e.id) picks,
    (SELECT COUNT(*) FROM pick_history ph JOIN ai_picks p2 ON ph.pickId=p2.id WHERE p2.eventId=e.id) graded
  FROM events e JOIN sports s ON e.sportId=s.id
  JOIN teams ht ON e.homeTeamId=ht.id JOIN teams at2 ON e.awayTeamId=at2.id
  WHERE e.startTime > NOW() - INTERVAL 30 HOUR AND e.status='final'
  ORDER BY e.startTime DESC`);
console.log("\nfinal events last 30h:");
for (const r of todayFinals[0]) console.log(` ${r.code} ${r.a} @ ${r.h} | start ${r.startTime} | picks=${r.picks} graded=${r.graded}`);
process.exit(0);

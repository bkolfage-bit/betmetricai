import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";
const db = getDb();
const rows: any = await db.execute(sql`
  SELECT s.code, COUNT(*) n,
    SUM((SELECT COUNT(*) FROM ai_picks p WHERE p.eventId=e.id)) picks,
    SUM((SELECT COUNT(*) FROM pick_history ph JOIN ai_picks p2 ON ph.pickId=p2.id WHERE p2.eventId=e.id)) graded
  FROM events e JOIN sports s ON e.sportId=s.id
  WHERE e.status='final' AND e.startTime > DATE_SUB(NOW(), INTERVAL 30 HOUR)
  GROUP BY s.code`);
console.log("finals last 30h by sport:");
for (const r of rows[0]) console.log(` ${r.code}: ${r.n} events, ${r.picks} picks, ${r.graded} graded`);
// NFL specifically — tonight's game
const nfl: any = await db.execute(sql`
  SELECT e.id, e.status, e.startTime, ht.abbr h, at2.abbr a, e.homeScore, e.awayScore
  FROM events e JOIN sports s ON e.sportId=s.id
  JOIN teams ht ON e.homeTeamId=ht.id JOIN teams at2 ON e.awayTeamId=at2.id
  WHERE s.code='NFL' AND e.startTime > DATE_SUB(NOW(), INTERVAL 30 HOUR)`);
console.log("\nNFL events last 30h:");
for (const r of nfl[0]) console.log(` ${r.a} @ ${r.h} | ${r.status} | ${r.homeScore}-${r.awayScore} | start ${r.startTime}`);
process.exit(0);

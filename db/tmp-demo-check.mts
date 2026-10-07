import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const conn = await mysql.createConnection(url);

const [evs] = await conn.query(
  `SELECT e.id, s.code, e.isDemo, e.status, e.startTime,
     (SELECT COUNT(*) FROM current_odds co WHERE co.event_id = e.id) AS oddsRows,
     (SELECT COUNT(*) FROM ai_picks p WHERE p.eventId = e.id) AS picks
   FROM events e JOIN sports s ON s.id = e.sportId
   WHERE e.id IN (79, 80, 87)`
);
console.log(evs);

// how many events WITH picks are demo vs live
const [mix] = await conn.query(
  `SELECT e.isDemo, COUNT(DISTINCT e.id) AS events, COUNT(p.id) AS picks
   FROM events e JOIN ai_picks p ON p.eventId = e.id GROUP BY e.isDemo`
);
console.log(mix);

// demo events with picks but zero odds rows
const [stale] = await conn.query(
  `SELECT e.id, s.code, e.isDemo FROM events e JOIN sports s ON s.id = e.sportId
   WHERE e.id IN (SELECT DISTINCT eventId FROM ai_picks)
     AND NOT EXISTS (SELECT 1 FROM current_odds co WHERE co.event_id = e.id)`
);
console.log("pick events with no odds rows:", stale);

await conn.end();

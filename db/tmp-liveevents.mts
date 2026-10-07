import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const conn = await mysql.createConnection(url);

const [rows] = await conn.query(
  `SELECT e.id, s.code, h.name AS home, a.name AS away, e.startTime,
          p.homeWinProb, p.projSpread, p.projTotal
   FROM events e
   JOIN sports s ON s.id = e.sportId
   JOIN teams h ON h.id = e.homeTeamId
   JOIN teams a ON a.id = e.awayTeamId
   JOIN predictions p ON p.eventId = e.id
   WHERE e.isDemo = 0 AND e.id IN (SELECT DISTINCT eventId FROM ai_picks)
     AND p.id = (SELECT MAX(id) FROM predictions WHERE eventId = e.id)
   ORDER BY s.code, e.startTime`
);
for (const r of rows as any[])
  console.log(`${r.code} #${r.id} ${r.away} @ ${r.home} | model home=${(+r.homeWinProb).toFixed(3)} spread=${r.projSpread} total=${r.projTotal} | ${r.startTime.toISOString().slice(0,16)}`);

await conn.end();

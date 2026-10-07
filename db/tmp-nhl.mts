import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const conn = await mysql.createConnection(url);

// live-mode top EV
const [rows] = await conn.query(
  `SELECT s.code, p.market, p.selection, v.line, v.odds, v.modelProb, v.ev
   FROM ai_picks p
   JOIN ai_pick_versions v ON v.pickId = p.id
   JOIN events e ON e.id = p.eventId AND e.isDemo = 0
   JOIN sports s ON s.id = e.sportId
   WHERE v.id = (SELECT MAX(id) FROM ai_pick_versions WHERE pickId = p.id)
   ORDER BY CAST(v.ev AS DECIMAL(10,4)) DESC LIMIT 15`
);
for (const r of rows as any[]) console.log(`${r.code} ${r.market} ${r.selection} line=${r.line} odds=${r.odds} model=${r.modelProb} EV=${(+r.ev).toFixed(3)}`);

// seeded NHL ratings spread
const [nhl] = await conn.query(
  `SELECT t.name, tr.ratings FROM team_ratings tr JOIN teams t ON t.id = tr.teamId
   JOIN sports s ON s.id = t.sportId WHERE s.code='NHL' AND tr.isCalibrated=1`
);
console.log("\nNHL calibrated ratings:");
for (const r of nhl as any[]) console.log(` ${r.name}: ${r.ratings}`);

await conn.end();

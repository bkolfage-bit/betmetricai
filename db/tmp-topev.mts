import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const conn = await mysql.createConnection(url);

const [rows] = await conn.query(
  `SELECT s.code, p.market, p.selection, v.line, v.odds, v.modelProb, v.ev
   FROM ai_picks p
   JOIN ai_pick_versions v ON v.pickId = p.id
   JOIN events e ON e.id = p.eventId
   JOIN sports s ON s.id = e.sportId
   WHERE v.id = (SELECT MAX(id) FROM ai_pick_versions WHERE pickId = p.id)
   ORDER BY CAST(v.ev AS DECIMAL(10,4)) DESC LIMIT 20`
);
for (const r of rows as any[]) console.log(`${r.code} ${r.market} ${r.selection} line=${r.line} odds=${r.odds} model=${r.modelProb} EV=${(+r.ev).toFixed(3)}`);

const [stats] = await conn.query(
  `SELECT MIN(CAST(modelProb AS DECIMAL(8,6))) lo, MAX(CAST(modelProb AS DECIMAL(8,6))) hi,
          MIN(CAST(ev AS DECIMAL(10,4))) evLo, MAX(CAST(ev AS DECIMAL(10,4))) evHi, COUNT(*) n
   FROM ai_pick_versions`
);
console.log("all versions:", stats);

await conn.end();

import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
const [rows] = await conn.query(`
  SELECT s.code, COUNT(*) n,
    SUM(CASE WHEN CAST(p.homeWinProb AS DECIMAL(6,4)) <= 0.0001 OR CAST(p.homeWinProb AS DECIMAL(6,4)) >= 0.9999 THEN 1 ELSE 0 END) deg,
    ROUND(MIN(CAST(p.homeWinProb AS DECIMAL(6,4))),3) mn, ROUND(MAX(CAST(p.homeWinProb AS DECIMAL(6,4))),3) mx,
    ROUND(MIN(CAST(p.projTotal AS DECIMAL(8,1))),1) totMn, ROUND(MAX(CAST(p.projTotal AS DECIMAL(8,1))),1) totMx
  FROM predictions p JOIN events e ON e.id=p.eventId JOIN sports s ON s.id=e.sportId
  WHERE e.isDemo=0 AND e.status='scheduled' AND e.startTime > NOW()
  GROUP BY s.code ORDER BY s.code`);
console.table(rows);
const [ev] = await conn.query(`
  SELECT s.code, v.selection, v.line, v.odds, CAST(v.modelProb AS DECIMAL(5,4)) mp, CAST(v.impliedProb AS DECIMAL(5,4)) ip, CAST(v.ev AS DECIMAL(6,4)) ev
  FROM ai_pick_versions v JOIN ai_picks p ON p.id=v.pickId JOIN events e ON e.id=p.eventId JOIN sports s ON s.id=e.sportId
  WHERE e.isDemo=0 AND e.startTime > NOW() AND v.version=1 AND CAST(v.ev AS DECIMAL(6,4)) > 0.15
  ORDER BY CAST(v.ev AS DECIMAL(6,4)) DESC LIMIT 12`);
console.log("== top EV picks (v1) =="); console.table(ev);
await conn.end();

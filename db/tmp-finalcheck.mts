import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
const [rows] = await conn.query(`
  SELECT s.code, COUNT(*) n,
    SUM(CASE WHEN CAST(p.homeWinProb AS DECIMAL(6,4)) <= 0.02 OR CAST(p.homeWinProb AS DECIMAL(6,4)) >= 0.98 THEN 1 ELSE 0 END) extremes,
    ROUND(MIN(CAST(p.homeWinProb AS DECIMAL(6,4))),3) mn, ROUND(MAX(CAST(p.homeWinProb AS DECIMAL(6,4))),3) mx
  FROM predictions p JOIN events e ON e.id=p.eventId JOIN sports s ON s.id=e.sportId
  WHERE e.isDemo=0 AND e.status='scheduled' AND e.startTime > NOW()
  GROUP BY s.code ORDER BY s.code`);
console.table(rows);
const [ev] = await conn.query(`
  SELECT s.code, p.selection, v.line, v.odds, CAST(v.modelProb AS DECIMAL(5,4)) mp, CAST(v.impliedProb AS DECIMAL(5,4)) ip, CAST(v.ev AS DECIMAL(6,4)) ev
  FROM ai_pick_versions v JOIN ai_picks p ON p.id=v.pickId JOIN events e ON e.id=p.eventId JOIN sports s ON s.id=e.sportId
  WHERE e.isDemo=0 AND e.startTime > NOW() AND v.version=(SELECT MAX(v2.version) FROM ai_pick_versions v2 WHERE v2.pickId=p.id)
  ORDER BY CAST(v.ev AS DECIMAL(6,4)) DESC LIMIT 10`);
console.log("== top current EV =="); console.table(ev);
await conn.end();

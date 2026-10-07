import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
const [rows] = await conn.query(`
  SELECT p.id, p.eventId, th.name home, ta.name away, p.homeWinProb, p.projTotal, p.createdAt
  FROM predictions p JOIN events e ON e.id=p.eventId JOIN teams th ON th.id=e.homeTeamId JOIN teams ta ON ta.id=e.awayTeamId
  JOIN sports s ON s.id=e.sportId WHERE s.code='TENNIS' AND e.isDemo=0 AND CAST(p.homeWinProb AS DECIMAL(6,4)) > 0.9 ORDER BY p.createdAt DESC LIMIT 8`);
console.table(rows);
await conn.end();

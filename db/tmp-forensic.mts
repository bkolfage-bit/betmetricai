import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
const [now] = await conn.query(`SELECT NOW() n`);
console.log("DB NOW:", (now as any[])[0].n);
const [counts] = await conn.query(`
  SELECT CASE WHEN CAST(p.homeWinProb AS DECIMAL(6,4)) > 0.9 THEN 'bad' ELSE 'good' END cls,
    COUNT(*) n, MIN(p.createdAt) mn, MAX(p.createdAt) mx
  FROM predictions p JOIN events e ON e.id=p.eventId JOIN sports s ON s.id=e.sportId
  WHERE s.code='TENNIS' AND e.isDemo=0 AND e.status='scheduled' AND e.startTime > NOW()
  GROUP BY cls`);
console.table(counts);
const [ev] = await conn.query(`SELECT id, status, startTime FROM events WHERE id IN (30229, 30228, 30213, 30212)`);
console.table(ev);
const [dups] = await conn.query(`
  SELECT eventId, COUNT(*) n FROM predictions WHERE eventId IN (30229,30228,30213,30212,30211,30210,30209,30208) GROUP BY eventId`);
console.log("predictions per bad event:"); console.table(dups);
await conn.end();

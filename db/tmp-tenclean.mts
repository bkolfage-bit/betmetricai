import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
// bad tennis priors: elo ~2058 (raw elite average, pre-shrinkage formula)
const [r1] = await conn.query(`
  DELETE tr FROM team_ratings tr JOIN teams t ON t.id=tr.teamId JOIN sports s ON s.id=t.sportId
  WHERE s.code='TENNIS' AND tr.isCalibrated=0 AND CAST(JSON_EXTRACT(tr.ratings,'$.elo') AS DECIMAL(10,2)) > 2000`);
console.log("bad tennis priors deleted:", (r1 as any).affectedRows);
// bad tennis predictions: homeWinProb > 0.9 (the 0.9998 signature)
const [ev] = await conn.query(`
  SELECT DISTINCT p.eventId FROM predictions p JOIN events e ON e.id=p.eventId JOIN sports s ON s.id=e.sportId
  WHERE s.code='TENNIS' AND e.isDemo=0 AND CAST(p.homeWinProb AS DECIMAL(6,4)) > 0.9`);
const ids = (ev as any[]).map(r => r.eventId);
console.log("bad tennis events:", ids.length);
if (ids.length) {
  await conn.query(`DELETE cl FROM closing_lines cl JOIN ai_picks p ON p.id=cl.pickId WHERE p.eventId IN (?)`, [ids]);
  await conn.query(`DELETE v FROM ai_pick_versions v JOIN ai_picks p ON p.id=v.pickId WHERE p.eventId IN (?)`, [ids]);
  await conn.query(`DELETE FROM ai_picks WHERE eventId IN (?)`, [ids]);
  await conn.query(`DELETE p FROM predictions p JOIN events e ON e.id=p.eventId JOIN sports s ON s.id=e.sportId WHERE s.code='TENNIS' AND CAST(p.homeWinProb AS DECIMAL(6,4)) > 0.9`);
}
await conn.end();
console.log("CLEAN DONE");

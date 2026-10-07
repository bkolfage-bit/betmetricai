import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
// stale auto-priors (computed under the old formula) — recompute on demand
const [r0] = await conn.query(`DELETE FROM team_ratings WHERE isCalibrated=0`);
console.log("stale priors deleted:", (r0 as any).affectedRows);
// wipe live upcoming predictions + picks for regen with final models
const [up] = await conn.query(`SELECT e.id FROM events e WHERE e.isDemo=0 AND e.status='scheduled' AND e.startTime > NOW()`);
const upIds = (up as any[]).map(r => r.id);
console.log("live upcoming events:", upIds.length);
if (upIds.length) {
  const [c0] = await conn.query(`DELETE cl FROM closing_lines cl JOIN ai_picks p ON p.id=cl.pickId WHERE p.eventId IN (?)`, [upIds]);
  const [a] = await conn.query(`DELETE v FROM ai_pick_versions v JOIN ai_picks p ON p.id=v.pickId WHERE p.eventId IN (?)`, [upIds]);
  const [b] = await conn.query(`DELETE FROM ai_picks WHERE eventId IN (?)`, [upIds]);
  const [c] = await conn.query(`DELETE FROM predictions WHERE eventId IN (?)`, [upIds]);
  console.log("closing:", (c0 as any).affectedRows, "versions:", (a as any).affectedRows, "picks:", (b as any).affectedRows, "predictions:", (c as any).affectedRows);
}
await conn.end();
console.log("WIPE DONE");

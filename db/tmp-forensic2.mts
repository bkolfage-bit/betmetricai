import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
for (const [eid, label] of [[30229, "BAD"], [30207, "GOOD?"]] as const) {
  const [rows] = await conn.query(`
    SELECT t.name, tr.ratings, tr.isCalibrated, tr.updatedAt FROM events e
    JOIN teams t ON t.id IN (e.homeTeamId, e.awayTeamId)
    LEFT JOIN team_ratings tr ON tr.teamId = t.id
    WHERE e.id = ?`, [eid]);
  console.log(`--- event ${eid} (${label}) ---`);
  for (const r of rows as any[]) console.log(r.name, "cal:", r.isCalibrated, "updated:", r.updatedAt, "\n  ", r.ratings);
}
await conn.end();

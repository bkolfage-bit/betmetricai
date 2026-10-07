import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
// wipe event 30229: prediction + both players' rating rows
await conn.query(`DELETE FROM predictions WHERE eventId=30229`);
await conn.query(`DELETE tr FROM team_ratings tr JOIN events e ON tr.teamId IN (e.homeTeamId, e.awayTeamId) WHERE e.id=30229`);
console.log("wiped event 30229 prediction + player rows");
await conn.end();

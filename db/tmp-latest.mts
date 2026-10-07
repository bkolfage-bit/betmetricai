import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
const [rows] = await conn.query(`
  SELECT tr.updatedAt, s.code, t.name, tr.isCalibrated, LEFT(tr.ratings, 60) r
  FROM team_ratings tr JOIN teams t ON t.id=tr.teamId JOIN sports s ON s.id=t.sportId
  ORDER BY tr.updatedAt DESC LIMIT 12`);
console.table(rows);
const [n] = await conn.query(`SELECT COUNT(*) n, SUM(isCalibrated=0) priors FROM team_ratings`);
console.log((n as any[])[0]);
await conn.end();

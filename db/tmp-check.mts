import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
const [rows] = await conn.query(`
  SELECT s.code, COUNT(*) n FROM team_ratings tr JOIN teams t ON t.id=tr.teamId JOIN sports s ON s.id=t.sportId
  GROUP BY s.code ORDER BY s.code`);
console.table(rows);
const [sample] = await conn.query(`
  SELECT s.code, t.name, tr.ratings FROM team_ratings tr JOIN teams t ON t.id=tr.teamId JOIN sports s ON s.id=t.sportId
  WHERE t.name IN ('Chiefs','J. Sinner','Celtics','Dodgers','Liverpool','J. Jones') LIMIT 8`);
for (const r of sample as any[]) console.log(r.code, r.name, r.ratings.slice(0, 80));
await conn.end();

import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const conn = await mysql.createConnection(url);

// calibrated rows sharing identical ratings JSON with another team (same sport+version)
const [dupes] = await conn.query(
  `SELECT tr1.id, tr1.teamId, t.name, s.code, tr1.featureVersion, tr1.ratings
   FROM team_ratings tr1
   JOIN teams t ON t.id = tr1.teamId
   JOIN sports s ON s.id = t.sportId
   WHERE tr1.isCalibrated = 1 AND EXISTS (
     SELECT 1 FROM team_ratings tr2 JOIN teams t2 ON t2.id = tr2.teamId
     WHERE tr2.id != tr1.id AND tr2.isCalibrated = 1
       AND t2.sportId = t.sportId AND tr2.featureVersion = tr1.featureVersion
       AND tr2.ratings = tr1.ratings
   ) ORDER BY s.code, tr1.ratings`
);
console.log(`calibrated rows with identical twin: ${(dupes as any[]).length}`);
for (const d of dupes as any[]) console.log(` ${d.code} ${d.name} (${d.teamId}) ${d.ratings}`);

await conn.end();

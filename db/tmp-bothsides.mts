import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { getSportModel } from "../api/models/index.js";

const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const conn = await mysql.createConnection(url);

const [rows] = await conn.query(
  `SELECT e.id AS eventId, e.homeTeamId, e.awayTeamId, s.code
   FROM events e JOIN sports s ON s.id = e.sportId
   WHERE e.id IN (SELECT DISTINCT eventId FROM ai_picks)`
);

const perSport: Record<string, { total: number; both: number; one: number }> = {};
const oneSided: number[] = [];
for (const r of rows as any[]) {
  const model = getSportModel(r.code);
  const [cal] = await conn.query(
    `SELECT COUNT(DISTINCT teamId) AS n FROM team_ratings
     WHERE teamId IN (?, ?) AND featureVersion = ? AND isCalibrated = 1`,
    [r.homeTeamId, r.awayTeamId, model.featureVersion]
  );
  const n = (cal as any[])[0].n;
  perSport[r.code] ??= { total: 0, both: 0, one: 0 };
  perSport[r.code].total++;
  if (n >= 2) perSport[r.code].both++;
  else { perSport[r.code].one++; oneSided.push(r.eventId); }
}
console.table(perSport);
console.log("one-sided events:", oneSided.length);

// also: calibrated team counts per sport overall
const [counts] = await conn.query(
  `SELECT s.code, COUNT(DISTINCT tr.teamId) AS calibrated
   FROM team_ratings tr JOIN teams t ON t.id = tr.teamId JOIN sports s ON s.id = t.sportId
   WHERE tr.isCalibrated = 1 GROUP BY s.code ORDER BY s.code`
);
console.log(counts);

await conn.end();

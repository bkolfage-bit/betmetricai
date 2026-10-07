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

const oneSided: number[] = [];
for (const r of rows as any[]) {
  const model = getSportModel(r.code);
  const [cal] = await conn.query(
    `SELECT COUNT(DISTINCT teamId) AS n FROM team_ratings
     WHERE teamId IN (?, ?) AND featureVersion = ? AND isCalibrated = 1`,
    [r.homeTeamId, r.awayTeamId, model.featureVersion]
  );
  if ((cal as any[])[0].n < 2) oneSided.push(r.eventId);
}
console.log(`one-sided events to unpick: ${oneSided.length}`);

if (oneSided.length) {
  const [picks] = await conn.query(`SELECT id FROM ai_picks WHERE eventId IN (?)`, [oneSided]);
  const pickIds = (picks as any[]).map((p) => p.id);
  console.log(`picks to delete: ${pickIds.length}`);
  if (pickIds.length) {
    await conn.query(`DELETE FROM closing_lines WHERE pickId IN (?)`, [pickIds]);
    await conn.query(`DELETE FROM ai_pick_versions WHERE pickId IN (?)`, [pickIds]);
    await conn.query(`DELETE FROM ai_picks WHERE id IN (?)`, [pickIds]);
  }
}

const [per] = await conn.query(
  `SELECT s.code, COUNT(*) AS n FROM ai_picks p JOIN events e ON e.id = p.eventId JOIN sports s ON s.id = e.sportId GROUP BY s.code ORDER BY s.code`
);
console.log(per);
await conn.end();

import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { getSportModel } from "../api/models/index.js";

const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const conn = await mysql.createConnection(url);

// 1. delete calibrated rows that have an identical twin (mislabeled priors)
const [dupes] = await conn.query(
  `SELECT tr1.id FROM team_ratings tr1
   JOIN teams t ON t.id = tr1.teamId
   WHERE tr1.isCalibrated = 1 AND EXISTS (
     SELECT 1 FROM team_ratings tr2 JOIN teams t2 ON t2.id = tr2.teamId
     WHERE tr2.id != tr1.id AND tr2.isCalibrated = 1
       AND t2.sportId = t.sportId AND tr2.featureVersion = tr1.featureVersion
       AND tr2.ratings = tr1.ratings
   )`
);
const ids = (dupes as any[]).map((d) => d.id);
console.log(`clone rows to delete: ${ids.length}`);
if (ids.length) await conn.query(`DELETE FROM team_ratings WHERE id IN (?)`, [ids]);

// 2. re-apply the both-calibrated gate to all events with picks
const [rows] = await conn.query(
  `SELECT e.id AS eventId, e.homeTeamId, e.awayTeamId, s.code
   FROM events e JOIN sports s ON s.id = e.sportId
   WHERE e.id IN (SELECT DISTINCT eventId FROM ai_picks)`
);
const failing: number[] = [];
for (const r of rows as any[]) {
  const model = getSportModel(r.code);
  const [cal] = await conn.query(
    `SELECT COUNT(DISTINCT teamId) AS n FROM team_ratings
     WHERE teamId IN (?, ?) AND featureVersion = ? AND isCalibrated = 1`,
    [r.homeTeamId, r.awayTeamId, model.featureVersion]
  );
  if ((cal as any[])[0].n < 2) failing.push(r.eventId);
}
console.log(`events failing gate after purge: ${failing.length}`);
if (failing.length) {
  const [picks] = await conn.query(`SELECT id FROM ai_picks WHERE eventId IN (?)`, [failing]);
  const pickIds = (picks as any[]).map((p) => p.id);
  console.log(`picks to delete: ${pickIds.length}`);
  if (pickIds.length) {
    await conn.query(`DELETE FROM closing_lines WHERE pickId IN (?)`, [pickIds]);
    await conn.query(`DELETE FROM ai_pick_versions WHERE pickId IN (?)`, [pickIds]);
    await conn.query(`DELETE FROM ai_picks WHERE id IN (?)`, [pickIds]);
  }
}

// 3. final board (live events only)
const [top] = await conn.query(
  `SELECT s.code, p.market, p.selection, v.line, v.odds, v.modelProb, v.ev
   FROM ai_picks p
   JOIN ai_pick_versions v ON v.pickId = p.id
   JOIN events e ON e.id = p.eventId AND e.isDemo = 0
   JOIN sports s ON s.id = e.sportId
   WHERE v.id = (SELECT MAX(id) FROM ai_pick_versions WHERE pickId = p.id)
   ORDER BY CAST(v.ev AS DECIMAL(10,4)) DESC LIMIT 15`
);
console.log("\nlive top-EV after purge:");
for (const r of top as any[]) console.log(` ${r.code} ${r.market} ${r.selection} line=${r.line} odds=${r.odds} model=${r.modelProb} EV=${(+r.ev).toFixed(3)}`);

const [per] = await conn.query(
  `SELECT s.code, e.isDemo, COUNT(*) AS n FROM ai_picks p JOIN events e ON e.id = p.eventId JOIN sports s ON s.id = e.sportId GROUP BY s.code, e.isDemo ORDER BY s.code`
);
console.log(per);

await conn.end();

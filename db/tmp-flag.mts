import mysql from "mysql2/promise";
import fs from "node:fs";
const env = fs.readFileSync(".env","utf8");
const url = env.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
const conn = await mysql.createConnection(url!);
// add marker column if missing
const [cols] = await conn.query(`SHOW COLUMNS FROM team_ratings LIKE 'isCalibrated'`);
if ((cols as any[]).length === 0) {
  await conn.query(`ALTER TABLE team_ratings ADD COLUMN isCalibrated tinyint NOT NULL DEFAULT 0`);
  console.log("column added");
}
// per sport: compute median per key; a row is calibrated if ANY key deviates
// from the median by >2% (prior clones sit within a hair of the mean)
const [rows] = await conn.query(`
  SELECT tr.id, s.code, tr.ratings FROM team_ratings tr
  JOIN teams t ON t.id=tr.teamId JOIN sports s ON s.id=t.sportId`);
const bySport = new Map<string, any[]>();
for (const r of rows as any[]) {
  if (!bySport.has(r.code)) bySport.set(r.code, []);
  bySport.get(r.code)!.push({ id: r.id, j: JSON.parse(r.ratings) });
}
let cal = 0, del = 0;
for (const [code, list] of bySport) {
  const keys = new Set<string>();
  for (const { j } of list) for (const k of Object.keys(j)) keys.add(k);
  const med: Record<string, number> = {};
  for (const k of keys) {
    const vs = list.map(({ j }) => j[k]).filter(Number.isFinite).sort((a, b) => a - b);
    med[k] = vs[Math.floor(vs.length / 2)] ?? 0;
  }
  for (const { id, j } of list) {
    const calibrated = [...keys].some((k) => {
      const v = j[k];
      if (!Number.isFinite(v)) return false;
      const m = med[k];
      const tol = Math.max(Math.abs(m) * 0.02, k === "elo" || k.endsWith("Elo") ? 15 : 1e-9);
      return Math.abs(v - m) > tol;
    });
    if (calibrated) { await conn.query(`UPDATE team_ratings SET isCalibrated=1 WHERE id=?`, [id]); cal++; }
    else { await conn.query(`DELETE FROM team_ratings WHERE id=?`, [id]); del++; }
  }
  console.log(code, "total:", list.length);
}
console.log("marked calibrated:", cal, "clones deleted:", del);
await conn.end();

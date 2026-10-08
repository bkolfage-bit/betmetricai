import mysql from "mysql2/promise";
import { readFileSync } from "fs";
const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const conn = await mysql.createConnection(url);
const [byStatus] = await conn.query(`SELECT status, isDemo, COUNT(*) n FROM events GROUP BY status, isDemo ORDER BY status`);
console.log("events by status:", byStatus);
// any events that should be live right now (started, not final)?
const [due] = await conn.query(
  `SELECT e.id, s.code, e.startTime, e.status, e.isDemo FROM events e JOIN sports s ON s.id=e.sportId
   WHERE e.startTime <= UTC_TIMESTAMP() AND e.status IN ('scheduled') ORDER BY e.startTime LIMIT 10`);
console.log("started but still scheduled:", due);
// live odds calls in the log?
const [logs] = await conn.query(
  `SELECT endpoint, status, createdAt FROM api_logs WHERE endpoint LIKE '%scores%' OR endpoint LIKE '%live%' ORDER BY id DESC LIMIT 5`);
console.log("score/live api calls:", logs);
// latest events (any status)
const [recent] = await conn.query(
  `SELECT e.id, s.code, e.status, e.startTime, e.homeScore, e.awayScore, e.period, e.clock FROM events e JOIN sports s ON s.id=e.sportId ORDER BY e.startTime DESC LIMIT 6`);
console.log("most recent events:", recent);
await conn.end();

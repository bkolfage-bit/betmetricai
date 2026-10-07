import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const conn = await mysql.createConnection(url);

// events behind the suspicious picks
const [picks] = await conn.query(
  `SELECT p.id pickId, p.eventId, p.market, p.selection, v.line, v.odds, s.code, e.startTime, e.status
   FROM ai_picks p
   JOIN ai_pick_versions v ON v.pickId = p.id
   JOIN events e ON e.id = p.eventId JOIN sports s ON s.id = e.sportId
   WHERE v.id = (SELECT MAX(id) FROM ai_pick_versions WHERE pickId = p.id)
     AND ((s.code='SOCCER' AND p.market='total' AND v.line='5.0')
       OR (s.code='NHL' AND p.market='total' AND CAST(v.line AS DECIMAL(4,1)) >= 8)
       OR (s.code='NHL' AND p.market='moneyline' AND v.odds='170'))`
);
for (const p of picks as any[]) {
  console.log(`\n=== ${p.code} event ${p.eventId} status=${p.status} start=${p.startTime} pick: ${p.market} ${p.selection} line=${p.line} odds=${p.odds}`);
  const [odds] = await conn.query(
    `SELECT market, outcome, line, american_odds AS odds, sportsbook_id AS book, fetched_at AS upd FROM current_odds WHERE event_id = ? AND market = ? ORDER BY outcome, line`,
    [p.eventId, p.market]
  );
  for (const o of odds as any[]) console.log(`  ${o.market} ${o.outcome} line=${o.line} odds=${o.odds} book=${o.book} upd=${o.upd}`);
}
await conn.end();

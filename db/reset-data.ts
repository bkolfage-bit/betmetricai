import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const conn = await mysql.createConnection(url);
  await conn.query("SET FOREIGN_KEY_CHECKS=0");
  const tables = [
    "closing_lines","simulation_runs","calibration_results","backtests","model_health","models",
    "team_ratings","pick_history","player_props","ai_pick_versions","ai_picks","predictions",
    "odds_snapshots","alerts","events","teams","sportsbooks","sports",
  ];
  for (const t of tables) await conn.query("DELETE FROM " + t);
  await conn.query("SET FOREIGN_KEY_CHECKS=1");
  const [rows] = await conn.query("SELECT COUNT(*) c FROM sports");
  console.log("DB wiped. sports count:", (rows as any)[0].c);
  await conn.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

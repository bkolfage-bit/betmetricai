import { getDb } from "../api/queries/connection";
import { apiLogs } from "./schema";
import { desc, inArray } from "drizzle-orm";
const db = getDb();
const rows = await db.select().from(apiLogs).where(inArray(apiLogs.service, ["kalshi", "polymarket"])).orderBy(desc(apiLogs.id)).limit(10);
if (rows.length === 0) console.log("no PM logs yet");
for (const r of rows) console.log(r.createdAt.toISOString(), r.service, r.level, r.message.slice(0, 140));
process.exit(0);

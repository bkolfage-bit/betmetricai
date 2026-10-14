import { getDb } from "../queries/connection";
import { adminConfig } from "@db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_THRESHOLDS, type EdgeThresholds } from "./edge";

const THRESHOLDS_KEY = "edge_thresholds";
export const DATA_MODE_KEY = "data_mode";

export async function getThresholds(): Promise<EdgeThresholds> {
  const db = getDb();
  const rows = await db
    .select()
    .from(adminConfig)
    .where(eq(adminConfig.key, THRESHOLDS_KEY));
  if (rows.length === 0) return DEFAULT_THRESHOLDS;
  try {
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(rows[0].value) };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

export async function setThresholds(t: EdgeThresholds): Promise<void> {
  const db = getDb();
  await db
    .insert(adminConfig)
    .values({ key: THRESHOLDS_KEY, value: JSON.stringify(t) })
    .onDuplicateKeyUpdate({ set: { value: JSON.stringify(t) } });
}

export async function getDataMode(): Promise<string> {
  const db = getDb();
  const rows = await db
    .select()
    .from(adminConfig)
    .where(eq(adminConfig.key, DATA_MODE_KEY));
  return rows[0]?.value ?? "DEMO";
}

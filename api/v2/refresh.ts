/**
 * Daily v2 maintenance: pull the last ~10 days of completed games for every
 * sport (keeps the corpus current), then re-run walk-forward validation and
 * re-deploy only the sports where v2 still beats v1. The deployment gate is
 * the same objective rule used at build time — a sport whose v2 stops
 * winning is held back, not forced live.
 */
import { ingestRange, INGEST_SPORTS, SOCCER_LEAGUES } from "./ingest";
import { runValidationAndDeploy } from "./deploy";
import { ingestTennis, ingestUfc, validateAndDeployTennis, validateAndDeployUfc } from "./individual";

export interface V2RefreshResult {
  ingested: number;
  deployedSports: string[];
  heldBack: string[];
}

export async function refreshV2(): Promise<V2RefreshResult> {
  const end = new Date();
  const start = new Date(end.getTime() - 10 * 24 * 3600_000);
  let ingested = 0;
  for (const s of INGEST_SPORTS) {
    const r = await ingestRange(s, start, end, 12).catch(() => null);
    if (r) ingested += r.inserted;
  }
  for (const lg of SOCCER_LEAGUES) {
    const r = await ingestRange(lg, start, end, 12).catch(() => null);
    if (r) ingested += r.inserted;
  }
  // individual sports: same daily upkeep, same objective deployment gate
  for (const r of await ingestTennis(start, end).catch(() => [])) ingested += r.inserted;
  ingested += (await ingestUfc(start, end).catch(() => ({ inserted: 0 }))).inserted;
  const report = await runValidationAndDeploy();
  const tennis = await validateAndDeployTennis().catch(() => null);
  const ufc = await validateAndDeployUfc().catch(() => null);
  const deployedSports = report.filter((r) => r.v2Wins && r.deployed > 0).map((r) => r.sportCode);
  const heldBack = report.filter((r) => !r.v2Wins).map((r) => r.sportCode);
  for (const ind of [tennis, ufc]) {
    if (!ind) continue;
    if (ind.validated && ind.deployed > 0) deployedSports.push(ind.sportCode);
    else if (!ind.validated) heldBack.push(ind.sportCode);
  }
  return { ingested, deployedSports, heldBack };
}

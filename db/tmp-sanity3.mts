import { getDb } from "../api/queries/connection";
import { teams, teamRatings, sports } from "./schema";
import { and, eq, inArray } from "drizzle-orm";
import { getSportModel } from "../api/models";

const db = getDb();
for (const code of ["NFL","NBA","MLB","NHL","NCAAF","NCAAB","SOCCER","TENNIS","GOLF","UFC"]) {
  const model = getSportModel(code);
  const [sp] = await db.select().from(sports).where(eq(sports.code, code)).limit(1);
  const st = await db.select({ id: teams.id }).from(teams).where(eq(teams.sportId, sp.id));
  const rows = await db.select().from(teamRatings).where(and(inArray(teamRatings.teamId, st.map(t=>t.id)), eq(teamRatings.featureVersion, model.featureVersion), eq(teamRatings.isCalibrated, 1)));
  const K = rows.length * 3;
  const acc = new Map<string,{s:number;n:number}>();
  for (const r of rows) for (const [k,v] of Object.entries(JSON.parse(r.ratings)) as any) {
    if (!Number.isFinite(v)) continue;
    const a = acc.get(k) ?? {s:0,n:0}; a.s+=v; a.n++; acc.set(k,a);
  }
  const keys = new Set([...acc.keys(), ...Object.keys(model.defaultRatings)]);
  const prior: Record<string,number> = {};
  for (const k of keys) { const a = acc.get(k) ?? {s:0,n:0}; prior[k] = (a.s + K*(model.defaultRatings[k] ?? 0))/(a.n+K); }
  const parsed = rows.map(r => JSON.parse(r.ratings));
  let strong: any = null, weak: any = null;
  if (parsed.length && parsed[0].elo !== undefined) {
    strong = parsed.reduce((m,x)=> x.elo>m.elo?x:m);
    weak = parsed.reduce((m,x)=> x.elo<m.elo?x:m);
  } else if (parsed.length) { strong = parsed[0]; weak = parsed[parsed.length-1]; }
  const floor = (r: any) => ({ ...model.defaultRatings, ...r });
  const t = (label: string, h: any, a: any) => {
    const p = model.predict(floor(h), floor(a), {});
    const bad = ![p.homeWinProb, p.projSpread, p.projTotal].every(Number.isFinite) || p.homeWinProb<=0 || p.homeWinProb>=1;
    console.log(`${code.padEnd(7)} ${label.padEnd(16)} prob=${p.homeWinProb.toFixed(4).padStart(7)} spread=${String(p.projSpread).padStart(6)} total=${String(p.projTotal).padStart(7)}${bad?" <<< BAD":""}`);
  };
  t("prior-vs-prior", prior, prior);
  if (strong) t("strong-vs-weak", strong, weak);
}
process.exit(0);

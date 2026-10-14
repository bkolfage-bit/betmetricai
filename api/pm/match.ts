/**
 * Cross-provider event matching.
 *
 * Prediction-market events arrive with venue-native team strings (Kalshi
 * sub-titles like "Chicago W", Polymarket outcome names like "Kansas City
 * Chiefs"). They are matched to first-class `events` rows (The Odds API
 * feed) by (a) fuzzy team identity within the same sport and (b) start-time
 * proximity. A match is only accepted when BOTH competitors resolve to
 * distinct teams and exactly one candidate game fits — ambiguous matches
 * are left unmatched rather than guessed.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { events, sports, teams } from "../../db/schema";

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(Boolean));
}

/** Kalshi-style disambiguator: trailing single letter = mascot initial
 *  ("Chicago W" → "Chicago White Sox", "New York Y" → "New York Yankees"). */
function teamMatches(candidate: string, fullName: string): boolean {
  const c = norm(candidate);
  const f = norm(fullName);
  if (!c || !f) return false;
  if (f.includes(c) || c.includes(f)) return true;
  const ct = [...tokens(c)];
  const ft = [...tokens(f)];
  // full token containment (e.g. "chiefs" ⊆ "kansas city chiefs")
  if (ct.every((t) => ft.includes(t))) return true;
  if (ft.every((t) => ct.includes(t))) return true;
  // trailing single-letter disambiguator against the mascot's initial
  const last = ct[ct.length - 1];
  if (last && last.length === 1 && ct.length >= 2) {
    const city = ct.slice(0, -1);
    const mascot = ft.filter((t) => !city.includes(t));
    if (city.every((t) => ft.includes(t)) && mascot.some((m) => m.startsWith(last))) return true;
  }
  return false;
}

export interface TeamRef {
  id: number;
  name: string;
}

/** Resolve a venue team string to one of OUR teams (same sport). */
export function resolveTeam(candidate: string | null, pool: TeamRef[]): TeamRef | null {
  if (!candidate) return null;
  const hits = pool.filter((t) => teamMatches(candidate, t.name));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    // prefer the longest shared-name hit (most specific)
    hits.sort((a, b) => b.name.length - a.name.length);
    if (teamMatches(candidate, hits[0].name) && !teamMatches(candidate, hits[1].name)) return hits[0];
  }
  return null;
}

/**
 * Match an unmatched pm_event to an events row.
 * Returns the matched events.id, or null when no unambiguous game fits.
 */
export async function matchPmEvent(input: {
  sportCode: string;
  teamA: string | null;
  teamB: string | null;
  startTime: Date | null;
}): Promise<{ eventId: number; homeTeam: string; awayTeam: string } | null> {
  const db = getDb();
  const [sport] = await db.select().from(sports).where(eq(sports.code, input.sportCode)).limit(1);
  if (!sport) return null;

  const pool = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.sportId, sport.id));

  const a = resolveTeam(input.teamA, pool);
  const b = resolveTeam(input.teamB, pool);
  if (!a || !b || a.id === b.id) return null;

  const center = input.startTime ?? new Date();
  const lo = new Date(center.getTime() - 36 * 3600_000);
  const hi = new Date(center.getTime() + 36 * 3600_000);
  const candidates = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.sportId, sport.id),
        eq(events.provider, "THE_ODDS_API"),
        inArray(events.status, ["scheduled", "live"]),
        gte(events.startTime, lo),
        lte(events.startTime, hi),
        inArray(events.homeTeamId, [a.id, b.id]),
        inArray(events.awayTeamId, [a.id, b.id]),
      ),
    );
  if (candidates.length !== 1) return null;
  const ev = candidates[0];
  const home = pool.find((t) => t.id === ev.homeTeamId);
  const away = pool.find((t) => t.id === ev.awayTeamId);
  if (!home || !away) return null;
  return { eventId: ev.id, homeTeam: home.name, awayTeam: away.name };
}

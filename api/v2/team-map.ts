/**
 * Team-name reconciliation between our `teams` table (Odds API naming) and
 * the names used by the result-data sources (ESPN / MLB / NHL). Exact,
 * normalized, then token-subset matching. Returns the trained-corpus team
 * name that a DB team corresponds to, or null when ambiguous.
 */

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(Boolean));
}

/** well-known cross-source aliases (city/mascot differences) */
const ALIASES: Record<string, string> = {
  "utsa roadrunners": "texas san antonio roadrunners",
  "montréal canadiens": "montreal canadiens",
  "st louis blues": "st. louis blues",
  "la clippers": "los angeles clippers",
  "la lakers": "los angeles lakers",
  "la rams": "los angeles rams",
  "la chargers": "los angeles chargers",
};

export function matchTeamName(dbName: string, trainedTeams: Map<string, unknown>): string | null {
  if (trainedTeams.has(dbName)) return dbName;
  const n = norm(ALIASES[norm(dbName)] ?? dbName);
  const keys = [...trainedTeams.keys()];
  // normalized exact
  for (const k of keys) if (norm(k) === n) return k;
  const nt = tokens(n);
  const hits = keys.filter((k) => {
    const kt = tokens(k);
    return [...nt].every((t) => kt.has(t)) || [...kt].every((t) => nt.has(t));
  });
  if (hits.length === 1) return hits[0];
  // mascot match (unique mascot token)
  const mascot = [...nt].pop();
  if (mascot) {
    const m = keys.filter((k) => norm(k).includes(mascot));
    if (m.length === 1) return m[0];
  }
  return null;
}

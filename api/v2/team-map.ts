/**
 * Team-name reconciliation between our `teams` table (Odds API naming) and
 * the names used by the result-data sources (ESPN / MLB / NHL). Exact,
 * normalized, then token-subset matching. Returns the trained-corpus team
 * name that a DB team corresponds to, or null when ambiguous.
 */

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics: Bodø → bodo, Köln → koln
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(Boolean));
}

/** well-known cross-source aliases (Odds API short name → ESPN/corpus name) */
const ALIASES: Record<string, string> = {
  /* college football */
  "utsa roadrunners": "texas san antonio roadrunners",
  "san jose state spartans": "san jose state spartans",
  "appalachian state mountaineers": "app state mountaineers",
  "hawaii rainbow warriors": "hawai'i rainbow warriors",
  /* hockey */
  "montréal canadiens": "montreal canadiens",
  "st louis blues": "st. louis blues",
  /* basketball / football city prefixes */
  "la clippers": "los angeles clippers",
  "la lakers": "los angeles lakers",
  "la rams": "los angeles rams",
  "la chargers": "los angeles chargers",
  /* soccer: sportsbook short names → ESPN display names */
  "man city": "manchester city",
  "psg": "paris saint-germain",
  "rennes": "stade rennais",
  "hamburger sv": "hamburg sv",
  "1 fc köln": "fc cologne",
  "borussia monchengladbach": "borussia mönchengladbach",
  "athletic bilbao": "athletic club",
  "sporting lisbon": "sporting cp",
  "slavia praha": "slavia prague",
  "sparta prague": "sparta praha",
  "bodø glimt": "bodo glimt",
  "š k slovan bratislava": "slovan bratislava",
  "salzburg": "fc salzburg",
  "red bull salzburg": "fc salzburg",
  "hapoel be er sheva": "hapoel beer sheva",
  "jagiellonia białystok": "jagiellonia bialystok",
  "ferencváros tc": "ferencvaros",
  "olympiakos piraeus": "olympiacos",
  "pfc levski sofia": "levski sofia",
  "besiktas jk": "besiktas",
  "sk sturm graz": "sturm graz",
  "viktoria plzeň": "viktoria plzen",
  "nec nijmegen": "nec",
  "omonoia fc": "omonoia nicosia",
  "union saint gilloise": "union st gilloise",
  "dinamo zagreb": "gnk dinamo zagreb",
  "nk celje": "celje",
  "psv eindhoven": "psv",
  "az alkmaar": "az",
  "lask": "lask linz",
  "fc ararat armenia": "ararat armenia",
};

/** stop words that carry no identity when token-matching club names */
const STOP = new Set([
  "fc", "cf", "sc", "ac", "as", "sk", "nk", "pfc", "fk", "bk", "if", "sv",
  "vfb", "tsg", "rb", "rcd", "afc", "ud", "cd", "rc", "us", "sg", "ssc",
  "1", "04", "07", "the", "de", "club", "sporting", "real",
]);

/** significant tokens: club name minus generic football-club vocabulary */
function sigTokens(s: string): Set<string> {
  return new Set([...tokens(s)].filter((t) => !STOP.has(t)));
}

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
  // significant-token containment (ignores FC/SC/AC-style filler)
  const ns = sigTokens(n);
  if (ns.size > 0) {
    const sigHits = keys.filter((k) => {
      const ks = sigTokens(k);
      if (ks.size === 0) return false;
      return [...ns].every((t) => ks.has(t)) || [...ks].every((t) => ns.has(t));
    });
    if (sigHits.length === 1) return sigHits[0];
  }
  // initial expansion: individual-sport feeds abbreviate first names
  // ("J. Sinner") while ESPN uses full names ("Jannik Sinner"). Match when
  // the last tokens are equal and each initial aligns positionally.
  const parts = n.split(" ");
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const initials = parts.slice(0, -1);
    if (initials.every((t) => t.length === 1)) {
      const cand = keys.filter((k) => {
        const kp = norm(k).split(" ");
        if (kp[kp.length - 1] !== last || kp.length - 1 < initials.length) return false;
        return initials.every((ini, i) => kp[i].startsWith(ini));
      });
      if (cand.length === 1) return cand[0];
    }
  }
  // mascot match (unique mascot token)
  const mascot = [...nt].pop();
  if (mascot) {
    const m = keys.filter((k) => norm(k).includes(mascot));
    if (m.length === 1) return m[0];
  }
  return null;
}

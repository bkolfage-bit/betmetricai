/**
 * Internal sport code -> provider sport-key matching rules.
 *
 * Keys are MATCHERS, not assumptions: a sport only becomes "active" when the
 * provider's /v4/sports discovery actually returns a matching, active key.
 * Anything not discovered is recorded as unavailable — we never pretend a
 * sport has live sportsbook data the provider does not supply.
 */
import type { ProviderSport } from "../providers/types";

type Matcher =
  | { kind: "exact"; keys: string[] }
  | { kind: "prefix"; prefixes: string[]; exclude?: RegExp };

export interface SportRule {
  code: string;
  matcher: Matcher;
  /** outrights-only sports (e.g. golf majors) have no game-level core odds */
  outrightsOnly?: boolean;
}

const SOCCER_LEAGUES = [
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_uefa_champs_league",
  "soccer_uefa_europa_league",
  "soccer_mls",
];

export const SPORT_KEY_RULES: SportRule[] = [
  { code: "NFL", matcher: { kind: "exact", keys: ["americanfootball_nfl"] } },
  { code: "NCAAF", matcher: { kind: "exact", keys: ["americanfootball_ncaaf"] } },
  { code: "NBA", matcher: { kind: "exact", keys: ["basketball_nba"] } },
  { code: "NCAAB", matcher: { kind: "exact", keys: ["basketball_ncaab"] } },
  { code: "MLB", matcher: { kind: "exact", keys: ["baseball_mlb"] } },
  { code: "NHL", matcher: { kind: "exact", keys: ["icehockey_nhl"] } },
  { code: "SOCCER", matcher: { kind: "exact", keys: SOCCER_LEAGUES } },
  { code: "UFC", matcher: { kind: "exact", keys: ["mma_mixed_martial_arts"] } },
  {
    code: "TENNIS",
    // tournament-level keys (e.g. tennis_atp_shanghai_masters); futures excluded
    matcher: { kind: "prefix", prefixes: ["tennis_atp_", "tennis_wta_"], exclude: /winner/ },
  },
  {
    code: "GOLF",
    matcher: { kind: "prefix", prefixes: ["golf_"] },
    outrightsOnly: true,
  },
  {
    code: "MOTORSPORTS",
    matcher: { kind: "prefix", prefixes: ["motorsport", "nascar", "formula"] },
  },
];

export function matchProviderKeys(rule: SportRule, discovered: ProviderSport[]): ProviderSport[] {
  return discovered.filter((s) => {
    if (rule.matcher.kind === "exact") return rule.matcher.keys.includes(s.key);
    const hit = rule.matcher.prefixes.some((p) => s.key.startsWith(p));
    return hit && !(rule.matcher.exclude && rule.matcher.exclude.test(s.key));
  });
}

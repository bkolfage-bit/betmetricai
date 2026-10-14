/**
 * Normalization engine — maps provider-native JSON into our own schema.
 *
 * Rules:
 *  - h2h      -> moneyline (home / away / draw — draw kept for 3-way sports)
 *  - spreads  -> spread (home / away, signed line)
 *  - totals   -> total (over / under, line)
 *  - unknown market keys are IGNORED, never guessed (spec: do not invent keys)
 *  - every price carries american + decimal + raw implied prob; no-vig prob is
 *    computed per market per book via the existing engine (noVigN).
 */
import { americanToDecimal, americanToImplied, noVigN } from "../engine/probability";
import type { ProviderEventOdds } from "../providers/types";

export type NormMarket = "moneyline" | "spread" | "total";

export interface NormRow {
  market: NormMarket;
  /** home | away | draw | over | under */
  outcome: string;
  line: number | null;
  americanOdds: number;
  decimalOdds: number;
  impliedProb: number;
  noVigProb: number | null;
}

export interface NormBook {
  bookmakerKey: string;
  bookmakerTitle: string;
  lastUpdate: Date;
  rows: NormRow[];
}

const MARKET_MAP: Record<string, NormMarket> = {
  h2h: "moneyline",
  spreads: "spread",
  totals: "total",
};

function outcomeName(
  market: NormMarket,
  name: string,
  homeTeam: string,
  awayTeam: string,
): string | null {
  if (market === "moneyline") {
    if (name === homeTeam) return "home";
    if (name === awayTeam) return "away";
    if (name.toLowerCase() === "draw") return "draw";
    return null; // unmatched participant — skip, never guess
  }
  if (market === "spread") {
    if (name === homeTeam) return "home";
    if (name === awayTeam) return "away";
    return null;
  }
  // totals
  const n = name.toLowerCase();
  if (n === "over") return "over";
  if (n === "under") return "under";
  return null;
}

export function normalizeEventOdds(ev: ProviderEventOdds): NormBook[] {
  const books: NormBook[] = [];
  for (const bk of ev.bookmakers) {
    const rows: NormRow[] = [];
    for (const mkt of bk.markets) {
      const market = MARKET_MAP[mkt.key];
      if (!market) continue; // never invent market keys

      // first pass: map outcomes we recognize
      const mapped: Array<Omit<NormRow, "noVigProb">> = [];
      for (const o of mkt.outcomes) {
        const outcome = outcomeName(market, o.name, ev.homeTeam, ev.awayTeam);
        if (outcome == null) continue;
        if (!Number.isFinite(o.price)) continue;
        mapped.push({
          market,
          outcome,
          line:
            market === "moneyline"
              ? null
              : o.point != null && Number.isFinite(o.point)
                ? o.point
                : null,
          americanOdds: Math.round(o.price),
          decimalOdds: americanToDecimal(Math.round(o.price)),
          impliedProb: americanToImplied(Math.round(o.price)),
        });
      }
      if (mapped.length === 0) continue;

      // second pass: no-vig separation across the full outcome set
      const nv = noVigN(mapped.map((r) => r.americanOdds));
      mapped.forEach((r, i) => {
        rows.push({ ...r, noVigProb: nv[i] ?? null });
      });
    }
    if (rows.length > 0) {
      books.push({
        bookmakerKey: bk.key,
        bookmakerTitle: bk.title,
        lastUpdate: new Date(bk.lastUpdate),
        rows,
      });
    }
  }
  return books;
}

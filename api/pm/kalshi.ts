/**
 * Kalshi public market-data adapter (read-only).
 *
 * Uses ONLY the free public endpoints — no API key, no authentication:
 *   GET /trade-api/v2/series?category=Sports        (league discovery)
 *   GET /trade-api/v2/events?series_ticker=…&with_nested_markets=true
 * No trading, order, portfolio or account endpoint is ever called.
 *
 * Field tolerance: Kalshi has migrated price fields from integer cents
 * (yes_bid) to dollar strings (yes_bid_dollars). Both forms are parsed;
 * anything unrecognized is skipped, never fabricated.
 */

const HOST = "https://api.elections.kalshi.com/trade-api/v2";

/** Kalshi game-winner series → platform sport code. Only game-result
 *  series are mapped (spread/total series are handled when discovered
 *  with parseable titles). */
export const KALSHI_SERIES_MAP: Record<string, string> = {
  KXNFLGAME: "NFL",
  KXNBAGAME: "NBA",
  KXMLBGAME: "MLB",
  KXNHLGAME: "NHL",
  KXNCAAFGAME: "NCAAF",
  KXNCAABGAME: "NCAAB",
  KXEPLGAME: "SOCCER",
  KXLALIGAGAME: "SOCCER",
  KXUCLGAME: "SOCCER",
  KXMLSGAME: "SOCCER",
  KXATPGAME: "TENNIS",
  KXWTAGAME: "TENNIS",
};

export interface KalshiMarketNorm {
  venueMarketId: string; // market ticker
  title: string;
  yesTeam: string | null; // yes_sub_title (team the YES contract names)
  noTeam: string | null;
  yesBid: number | null; // 0..1
  yesAsk: number | null;
  lastPrice: number | null;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  closeTime: Date | null;
}

export interface KalshiEventNorm {
  venueEventId: string; // event_ticker
  title: string;
  seriesTicker: string;
  markets: KalshiMarketNorm[];
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** price fields exist in both cent-int and dollar-string form → 0..1 */
function price(m: Record<string, unknown>, base: string): number | null {
  const dollars = num(m[`${base}_dollars`]);
  if (dollars !== null) return Math.min(1, Math.max(0, dollars));
  const cents = num(m[base]);
  if (cents !== null) return Math.min(1, Math.max(0, cents / 100));
  return null;
}

function ts(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function get<T>(path: string): Promise<{ data: T; latencyMs: number }> {
  const started = Date.now();
  const res = await fetch(`${HOST}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Kalshi HTTP ${res.status} on ${path}: ${body}`);
  }
  return { data: (await res.json()) as T, latencyMs: Date.now() - started };
}

/** Discover which known sports series currently exist on Kalshi. */
export async function kalshiActiveSeries(): Promise<{
  series: Array<{ ticker: string; title: string }>;
  latencyMs: number;
}> {
  const out: Array<{ ticker: string; title: string }> = [];
  let latencyMs = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 5; page++) {
    const path: string = `/series?category=Sports&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const { data, latencyMs: lat }: { data: { series?: Array<{ ticker?: string; title?: string }>; cursor?: string }; latencyMs: number } = await get(path);
    latencyMs += lat;
    for (const s of data.series ?? []) {
      if (s.ticker && KALSHI_SERIES_MAP[s.ticker]) {
        out.push({ ticker: s.ticker, title: s.title ?? s.ticker });
      }
    }
    cursor = data.cursor || null;
    if (!cursor) break;
  }
  return { series: out, latencyMs };
}

/** Open events (with nested markets) for one series. */
export async function kalshiSeriesEvents(seriesTicker: string): Promise<{
  events: KalshiEventNorm[];
  latencyMs: number;
}> {
  const out: KalshiEventNorm[] = [];
  let latencyMs = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 4; page++) {
    const path: string =
      `/events?series_ticker=${encodeURIComponent(seriesTicker)}&status=open` +
      `&with_nested_markets=true&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const { data, latencyMs: lat }: { data: { events?: Array<Record<string, unknown> & { markets?: Array<Record<string, unknown>> }>; cursor?: string }; latencyMs: number } = await get(path);
    latencyMs += lat;
    for (const e of data.events ?? []) {
      const markets: KalshiMarketNorm[] = [];
      for (const m of e.markets ?? []) {
        const ticker = typeof m.ticker === "string" ? m.ticker : null;
        if (!ticker) continue;
        markets.push({
          venueMarketId: ticker,
          title: typeof m.title === "string" ? m.title : ticker,
          yesTeam: typeof m.yes_sub_title === "string" ? m.yes_sub_title : null,
          noTeam: typeof m.no_sub_title === "string" ? m.no_sub_title : null,
          yesBid: price(m, "yes_bid"),
          yesAsk: price(m, "yes_ask"),
          lastPrice: price(m, "last_price"),
          volume: num(m.volume),
          volume24h: num(m.volume_24h),
          liquidity: num(m.liquidity_dollars) ?? num(m.liquidity),
          closeTime: ts(m.close_time),
        });
      }
      out.push({
        venueEventId: typeof e.event_ticker === "string" ? e.event_ticker : String(e.ticker ?? ""),
        title: typeof e.title === "string" ? e.title : seriesTicker,
        seriesTicker,
        markets,
      });
    }
    cursor = data.cursor || null;
    if (!cursor) break;
  }
  return { events: out, latencyMs };
}

/**
 * Kalshi taker fee per $1 contract: ceil(0.07 · P · (1−P) · 100) / 100
 * dollars. Returned as a fraction (0..~0.0175) so EV math can subtract it
 * directly from per-contract economics. Informational estimate only.
 */
export function kalshiTakerFee(price01: number): number {
  const p = Math.min(1, Math.max(0, price01));
  return Math.ceil(0.07 * p * (1 - p) * 100) / 100;
}

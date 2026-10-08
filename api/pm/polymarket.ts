/**
 * Polymarket public market-data adapter (read-only).
 *
 * Free public endpoints, no API key or wallet:
 *   Gamma : https://gamma-api.polymarket.com
 *     GET /sports                      — league catalogue (slug → series id)
 *     GET /events?series_id=…          — events with nested markets
 *   CLOB  : https://clob.polymarket.com
 *     GET  /prices-history?market=…    — historical probability (charts)
 * No trading, order, or account endpoint is ever called.
 */

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

/** Polymarket sport slug → platform sport code */
export const POLY_SPORT_MAP: Record<string, string> = {
  nfl: "NFL",
  nba: "NBA",
  mlb: "MLB",
  nhl: "NHL",
  cfb: "NCAAF",
  cbb: "NCAAB",
  ncaaf: "NCAAF",
  ncaab: "NCAAB",
  epl: "SOCCER",
  ucl: "SOCCER",
  lal: "SOCCER", // la liga
  mls: "SOCCER",
  atp: "TENNIS",
  wta: "TENNIS",
};

export interface PolyMarketNorm {
  venueMarketId: string; // conditionId
  question: string;
  sportsMarketType: string | null; // "moneyline" | "spreads" | "totals" | …
  outcomes: string[];
  outcomePrices: (number | null)[];
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
  line: number | null;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  clobTokenIds: string[];
  gameStartTime: Date | null;
}

export interface PolyEventNorm {
  venueEventId: string; // event slug
  title: string;
  startTime: Date | null;
  markets: PolyMarketNorm[];
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function numArray(v: unknown): (number | null)[] {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.map((x) => num(x));
}

function ts(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function get<T>(base: string, path: string): Promise<{ data: T; latencyMs: number }> {
  const started = Date.now();
  const res = await fetch(`${base}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Polymarket HTTP ${res.status} on ${base}${path}: ${body}`);
  }
  return { data: (await res.json()) as T, latencyMs: Date.now() - started };
}

/** League catalogue: mapped sports with their Gamma series ids. */
export async function polyActiveSports(): Promise<{
  sports: Array<{ slug: string; seriesId: string }>;
  latencyMs: number;
}> {
  const { data, latencyMs } = await get<Array<Record<string, unknown>>>(GAMMA, "/sports?limit=100");
  const out: Array<{ slug: string; seriesId: string }> = [];
  for (const s of Array.isArray(data) ? data : []) {
    const slug = typeof s.sport === "string" ? s.sport.toLowerCase() : "";
    if (!POLY_SPORT_MAP[slug]) continue;
    const seriesId = s.series !== undefined && s.series !== null ? String(s.series) : null;
    if (seriesId) out.push({ slug, seriesId });
  }
  return { sports: out, latencyMs };
}

function parseMarket(m: Record<string, unknown>): PolyMarketNorm | null {
  const conditionId = typeof m.conditionId === "string" ? m.conditionId : null;
  if (!conditionId) return null;
  return {
    venueMarketId: conditionId,
    question: typeof m.question === "string" ? m.question : conditionId,
    sportsMarketType: typeof m.sportsMarketType === "string" ? m.sportsMarketType.toLowerCase() : null,
    outcomes: strArray(m.outcomes),
    outcomePrices: numArray(m.outcomePrices),
    bestBid: num(m.bestBid),
    bestAsk: num(m.bestAsk),
    lastTradePrice: num(m.lastTradePrice),
    line: num(m.line),
    volume: num(m.volume),
    volume24h: num(m.volume24hr),
    liquidity: num(m.liquidityClob) ?? num(m.liquidity),
    clobTokenIds: strArray(m.clobTokenIds),
    gameStartTime: ts(m.gameStartTime),
  };
}

/** Active events (with nested markets) for one Gamma series id. */
export async function polySeriesEvents(seriesId: string): Promise<{
  events: PolyEventNorm[];
  latencyMs: number;
}> {
  const out: PolyEventNorm[] = [];
  let latencyMs = 0;
  for (let offset = 0; offset < 600; offset += 200) {
    const path =
      `/events?series_id=${encodeURIComponent(seriesId)}&active=true&closed=false` +
      `&limit=200&offset=${offset}`;
    const { data, latencyMs: lat } = await get<Array<Record<string, unknown>>>(GAMMA, path);
    latencyMs += lat;
    const arr = Array.isArray(data) ? data : [];
    for (const e of arr) {
      const marketsRaw = Array.isArray(e.markets) ? (e.markets as Array<Record<string, unknown>>) : [];
      const markets = marketsRaw
        .map(parseMarket)
        .filter((m): m is PolyMarketNorm => m !== null)
        .filter((m) => m.sportsMarketType === "moneyline" || m.sportsMarketType === "spreads" || m.sportsMarketType === "totals");
      if (markets.length === 0) continue;
      out.push({
        venueEventId: typeof e.slug === "string" ? e.slug : String(e.id ?? ""),
        title: typeof e.title === "string" ? e.title : "Polymarket event",
        startTime: ts(e.startDate),
        markets,
      });
    }
    if (arr.length < 200) break;
  }
  return { events: out, latencyMs };
}

/**
 * Historical YES-token price series from the public CLOB endpoint.
 * Used to seed the trend chart for newly matched markets; our own
 * snapshots take over from there. Returns [unixSeconds, price 0..1][].
 */
export async function polyPriceHistory(
  tokenId: string,
  interval: "1w" | "1d" | "max" = "1w",
  fidelity = 60,
): Promise<{ points: Array<{ t: number; p: number }>; latencyMs: number }> {
  const { data, latencyMs } = await get<{ history?: Array<{ t?: number; p?: number }> }>(
    CLOB,
    `/prices-history?market=${encodeURIComponent(tokenId)}&interval=${interval}&fidelity=${fidelity}`,
  );
  const points = (data.history ?? [])
    .filter((h) => typeof h.t === "number" && typeof h.p === "number")
    .map((h) => ({ t: h.t as number, p: Math.min(1, Math.max(0, h.p as number)) }));
  return { points, latencyMs };
}

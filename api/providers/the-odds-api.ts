/**
 * TheOddsApiProvider — The Odds API v4 adapter (§1).
 *
 * The API key is read from the server-side environment ONLY (ODDS_API_KEY).
 * It is never logged, never returned in responses, never sent to the
 * frontend. All requests originate from this backend.
 */
import type { ProviderScore,
  OddsProvider,
  ProviderEvent,
  ProviderEventOdds,
  ProviderResult,
  ProviderSport,
  QuotaInfo,
} from "./types";

const HOST = "https://api.the-odds-api.com";

/* raw provider JSON shapes (kept local to this adapter) */
interface RawSport {
  key: string;
  group: string;
  title: string;
  description?: string;
  active: boolean;
  has_outrights: boolean;
}
interface RawOutcome {
  name: string;
  price: number;
  point?: number;
  /** player name on player-prop markets */
  description?: string;
}
interface RawMarket {
  key: string;
  last_update: string;
  outcomes: RawOutcome[];
}
interface RawBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: RawMarket[];
}
interface RawEvent {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: RawBookmaker[];
}
interface RawScore {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  completed: boolean;
  last_update: string | null;
  scores: { name: string; score: string }[] | null;
}

export class TheOddsApiProvider implements OddsProvider {
  readonly name = "THE_ODDS_API";
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ODDS_API_KEY;
    if (!key) throw new Error("ODDS_API_KEY is not configured (server-side env)");
    this.apiKey = key;
  }

  private async request<T>(
    path: string,
    params: Record<string, string | undefined>,
  ): Promise<ProviderResult<T>> {
    const url = new URL(`${HOST}${path}`);
    // key travels as a query param per provider spec — server-side only
    url.searchParams.set("apiKey", this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }

    const started = Date.now();
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const latencyMs = Date.now() - started;

    const quota: QuotaInfo = {
      requestsUsed: numHeader(res.headers.get("x-requests-used")),
      requestsRemaining: numHeader(res.headers.get("x-requests-remaining")),
      lastRequestCost: numHeader(res.headers.get("x-requests-last")),
    };

    if (!res.ok) {
      // never include the URL (contains the key) in errors/logs
      const text = await res.text().catch(() => "");
      throw new Error(
        `The Odds API request failed (${res.status}) at ${path}: ${text.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as T;
    return { data, quota, latencyMs };
  }

  async listSports(): Promise<ProviderResult<ProviderSport[]>> {
    const r = await this.request<RawSport[]>("/v4/sports", {});
    return {
      ...r,
      data: r.data.map((s) => ({
        key: s.key,
        group: s.group,
        title: s.title,
        active: s.active,
        hasOutrights: s.has_outrights,
      })),
    };
  }

  async listEvents(sportKey: string): Promise<ProviderResult<ProviderEvent[]>> {
    const r = await this.request<RawEvent[]>(
      `/v4/sports/${encodeURIComponent(sportKey)}/events`,
      {},
    );
    return { ...r, data: r.data.map(mapEvent) };
  }

  async getOdds(
    sportKey: string,
    opts: {
      regions: string[];
      markets: string[];
      bookmakers?: string[];
      eventIds?: string[];
    },
  ): Promise<ProviderResult<ProviderEventOdds[]>> {
    const r = await this.request<RawEvent[]>(
      `/v4/sports/${encodeURIComponent(sportKey)}/odds`,
      {
        regions: opts.regions.join(","),
        markets: opts.markets.join(","),
        bookmakers: opts.bookmakers?.length ? opts.bookmakers.join(",") : undefined,
        eventIds: opts.eventIds?.length ? opts.eventIds.join(",") : undefined,
        oddsFormat: "american",
        dateFormat: "iso",
      },
    );
    return { ...r, data: r.data.map(mapEventOdds) };
  }

  async getEventOdds(
    sportKey: string,
    eventId: string,
    opts: {
      regions: string[];
      markets: string[];
      bookmakers?: string[];
    },
  ): Promise<ProviderResult<ProviderEventOdds>> {
    const r = await this.request<RawEvent>(
      `/v4/sports/${encodeURIComponent(sportKey)}/events/${encodeURIComponent(eventId)}/odds`,
      {
        regions: opts.regions.join(","),
        markets: opts.markets.join(","),
        bookmakers: opts.bookmakers?.length ? opts.bookmakers.join(",") : undefined,
        oddsFormat: "american",
        dateFormat: "iso",
      },
    );
    return { ...r, data: mapEventOdds(r.data) };
  }

  async getScores(
    sportKey: string,
    opts: { daysFrom?: number; eventIds?: string[] },
  ): Promise<ProviderResult<ProviderScore[]>> {
    const r = await this.request<RawScore[]>(
      `/v4/sports/${encodeURIComponent(sportKey)}/scores`,
      {
        daysFrom: opts.daysFrom !== undefined ? String(opts.daysFrom) : undefined,
        eventIds: opts.eventIds?.length ? opts.eventIds.join(",") : undefined,
        dateFormat: "iso",
      },
    );
    const now = Date.now();
    return {
      ...r,
      data: r.data.map((e) => {
        const home = e.scores?.find((x) => x.name === e.home_team);
        const away = e.scores?.find((x) => x.name === e.away_team);
        const parse = (v: string | undefined) => {
          if (v === undefined) return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        return {
          providerEventId: e.id,
          sportKey: e.sport_key,
          homeTeam: e.home_team,
          awayTeam: e.away_team,
          commenceTime: new Date(e.commence_time),
          // provider omits "started"; scores existing OR tip time passed
          started: e.completed || e.scores !== null || new Date(e.commence_time).getTime() <= now,
          completed: e.completed,
          lastUpdate: e.last_update ? new Date(e.last_update) : null,
          homeScore: parse(home?.score),
          awayScore: parse(away?.score),
        };
      }),
    };
  }
}

function numHeader(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapEvent(e: RawEvent): ProviderEvent {
  return {
    providerEventId: e.id,
    sportKey: e.sport_key,
    homeTeam: e.home_team,
    awayTeam: e.away_team,
    commenceTime: new Date(e.commence_time),
  };
}

function mapEventOdds(e: RawEvent): ProviderEventOdds {
  return {
    ...mapEvent(e),
    bookmakers: (e.bookmakers ?? []).map((b) => ({
      key: b.key,
      title: b.title,
      lastUpdate: new Date(b.last_update),
      markets: b.markets.map((m) => ({
        key: m.key,
        lastUpdate: new Date(m.last_update),
        outcomes: m.outcomes.map((o) => ({
          name: o.name,
          price: o.price,
          point: o.point,
          description: o.description,
        })),
      })),
    })),
  };
}

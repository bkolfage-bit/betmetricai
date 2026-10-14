/**
 * Odds provider abstraction (§1).
 *
 * The rest of the application depends ONLY on these normalized types —
 * never on a provider's raw JSON. Adding another provider (Sportradar,
 * etc.) means writing a new adapter that implements OddsProvider.
 */

/** Discovered sport/league from the provider. */
export interface ProviderSport {
  key: string; // provider sport key, e.g. "americanfootball_nfl"
  group: string; // e.g. "American Football"
  title: string; // e.g. "NFL"
  active: boolean;
  hasOutrights: boolean;
}

/** Event discovered via the (free) events endpoint. */
export interface ProviderEvent {
  providerEventId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: Date;
}

/** Live / final score state for an event (provider /scores endpoint). */
export interface ProviderScore {
  providerEventId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: Date;
  /** true once the game has actually started */
  started: boolean;
  completed: boolean;
  /** ISO last-update timestamp from the provider (null when unknown) */
  lastUpdate: Date | null;
  homeScore: number | null;
  awayScore: number | null;
}

/** One outcome as supplied by the provider. */
export interface ProviderOutcome {
  name: string; // team name, or "Over"/"Under"
  price: number; // american odds
  point?: number; // line for spreads/totals
  description?: string; // player name on player-prop markets
}

export interface ProviderMarket {
  key: string; // h2h | spreads | totals | player_* etc.
  lastUpdate: Date;
  outcomes: ProviderOutcome[];
}

export interface ProviderBookmaker {
  key: string; // e.g. "fanduel"
  title: string; // e.g. "FanDuel"
  lastUpdate: Date;
  markets: ProviderMarket[];
}

/** Event with full odds payload. */
export interface ProviderEventOdds extends ProviderEvent {
  bookmakers: ProviderBookmaker[];
}

/** Quota headers returned by The Odds API. */
export interface QuotaInfo {
  requestsUsed: number | null;
  requestsRemaining: number | null;
  lastRequestCost: number | null;
}

export interface ProviderResult<T> {
  data: T;
  quota: QuotaInfo;
  latencyMs: number;
}

/** The contract every odds provider must implement. */
export interface OddsProvider {
  readonly name: string; // e.g. "THE_ODDS_API"
  /** Free endpoint — discover available sports/leagues. */
  listSports(): Promise<ProviderResult<ProviderSport[]>>;
  /** Free endpoint — discover events for a sport (no odds cost). */
  listEvents(sportKey: string): Promise<ProviderResult<ProviderEvent[]>>;
  /**
   * Paid endpoint — live/final scores for a sport (1 credit per call,
   * daysFrom<=3). Used to flip events scheduled->live->final with real
   * scores; never synthesized.
   */
  getScores(
    sportKey: string,
    opts: { daysFrom?: number; eventIds?: string[] },
  ): Promise<ProviderResult<ProviderScore[]>>;
  /** Paid endpoint — core/additional markets for a sport. */
  getOdds(
    sportKey: string,
    opts: {
      regions: string[];
      markets: string[];
      bookmakers?: string[];
      eventIds?: string[];
    },
  ): Promise<ProviderResult<ProviderEventOdds[]>>;
  /**
   * Paid EVENT-LEVEL endpoint — required for player-prop (feature) markets,
   * which the sport-level endpoint rejects. Cost: 1 credit per market per
   * region per call.
   */
  getEventOdds(
    sportKey: string,
    eventId: string,
    opts: {
      regions: string[];
      markets: string[];
      bookmakers?: string[];
    },
  ): Promise<ProviderResult<ProviderEventOdds>>;
}

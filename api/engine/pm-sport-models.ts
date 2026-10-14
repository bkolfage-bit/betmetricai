/**
 * Phase 2 — Sport-specific prediction-market model frameworks.
 *
 * Each sport gets an independent analyzer that reads the shared Phase-1
 * feature set and produces a sport-tuned read of the prediction market.
 * The models differ in WHAT they weight and HOW they interpret movement:
 *
 *   - which behaviors matter (injury repricing, goalie news, draw dynamics…)
 *   - how much liquidity is "enough" for the sport's typical market depth
 *   - how fast pre-game movement should be trusted (tennis/golf reprice fast,
 *     soccer draw markets move slowly)
 *
 * HARD DISCIPLINE (spec §71 + standing rules):
 *  - movement is NEVER attributed to a specific cause (injury, QB news,
 *    goalie) unless that is independently verified — we flag "repricing"
 *    behavior, we do not invent the reason;
 *  - a sport with no PM coverage returns coverage:false and a null
 *    probability — an honest empty shell, not a fabricated number;
 *  - these analyzers produce intelligence, not picks — the fusion engine
 *    (Phase 3) decides how much, if anything, they influence a probability.
 */
import type { IntelFeatures, PmBehavior } from "./pm-intel";

export interface SportPmProfile {
  sportCode: string;
  /** minimum 24h volume for the market to be trusted for THIS sport */
  minVolume: number;
  /** relative spread above which the sport's market reads as thin */
  thinSpreadRel: number;
  /** how quickly pre-game movement is meaningful (hours window to weight) */
  movementWindowH: number;
  /** behaviors this sport treats as high-signal */
  highSignal: PmBehavior[];
  /** free-text note on what this sport's model watches */
  watches: string;
}

/**
 * Sport-specific calibration of the shared features. These are structural
 * priors about how each sport's prediction market behaves — not tuned
 * numbers pulled from data we don't have yet. The fusion engine learns the
 * real weights later from forward-tested results.
 */
export const SPORT_PM_PROFILES: Record<string, SportPmProfile> = {
  NFL: {
    sportCode: "NFL", minVolume: 2000, thinSpreadRel: 0.06, movementWindowH: 24,
    highSignal: ["unusual_activity", "disagreement", "moving_toward_ai"],
    watches: "Late-week repricing and volume surges ahead of Sunday; injury-driven moves flagged as repricing, not attributed.",
  },
  NBA: {
    sportCode: "NBA", minVolume: 1500, thinSpreadRel: 0.06, movementWindowH: 12,
    highSignal: ["unusual_activity", "moving_toward_ai"],
    watches: "Same-day movement (rest/lineup news breaks hours before tip); late activity weighted heavily.",
  },
  MLB: {
    sportCode: "MLB", minVolume: 1200, thinSpreadRel: 0.07, movementWindowH: 12,
    highSignal: ["disagreement", "unusual_activity"],
    watches: "Moneyline repricing around lineup/pitcher confirmation; flagged as movement, cause not assumed.",
  },
  NHL: {
    sportCode: "NHL", minVolume: 1000, thinSpreadRel: 0.07, movementWindowH: 12,
    highSignal: ["moving_toward_ai", "unusual_activity"],
    watches: "Goalie-confirmation repricing and moneyline movement; liquidity is thinner so the bar is lower.",
  },
  NCAAF: {
    sportCode: "NCAAF", minVolume: 800, thinSpreadRel: 0.09, movementWindowH: 48,
    highSignal: ["disagreement", "unusual_activity", "uncertain"],
    watches: "Thin markets and underdog moves; wide spreads read as uncertainty, not edge.",
  },
  NCAAB: {
    sportCode: "NCAAB", minVolume: 700, thinSpreadRel: 0.10, movementWindowH: 24,
    highSignal: ["uncertain", "unusual_activity"],
    watches: "Conference-game liquidity varies wildly; tournament games deeper. Thin markets default to uncertain.",
  },
  SOCCER: {
    sportCode: "SOCCER", minVolume: 2500, thinSpreadRel: 0.06, movementWindowH: 24,
    highSignal: ["disagreement", "moving_toward_ai"],
    watches: "Three-way market incl. draw; draw probability and its movement tracked separately from the win sides.",
  },
  TENNIS: {
    sportCode: "TENNIS", minVolume: 600, thinSpreadRel: 0.10, movementWindowH: 6,
    highSignal: ["unusual_activity", "uncertain"],
    watches: "Player markets are thin and reprice fast (withdrawals); short movement window, low volume bar, uncertainty flagged often.",
  },
  GOLF: {
    sportCode: "GOLF", minVolume: 500, thinSpreadRel: 0.12, movementWindowH: 24,
    highSignal: ["uncertain"],
    watches: "Tournament-winner and matchup markets; very thin, so most reads are uncertainty-flagged.",
  },
  UFC: {
    sportCode: "UFC", minVolume: 800, thinSpreadRel: 0.09, movementWindowH: 24,
    highSignal: ["unusual_activity", "disagreement"],
    watches: "Fighter moneylines; weigh-in-week repricing and liquidity shifts flagged, cause not assumed.",
  },
};

export interface SportPmRead {
  sportCode: string;
  coverage: boolean;             // false = honest empty shell (no PM market)
  prob: number | null;           // sport-adjusted PM probability
  trust: number;                 // 0..1 — how much this sport trusts the read
  flags: PmBehavior[];           // sport-filtered behaviors
  notes: string[];               // human-readable, honest explanations
}

/**
 * Run one sport's PM model over the shared features. Returns an honest empty
 * shell (coverage:false) when there is no usable PM market for the sport.
 */
export function runSportPmModel(
  sportCode: string,
  features: IntelFeatures | null,
): SportPmRead {
  const profile = SPORT_PM_PROFILES[sportCode] ?? SPORT_PM_PROFILES.NFL;

  if (!features || features.combinedProb === null) {
    return {
      sportCode,
      coverage: false,
      prob: null,
      trust: 0,
      flags: [],
      notes: [`No prediction-market coverage for ${sportCode} on this event — nothing to read.`],
    };
  }

  const notes: string[] = [];
  const flags: PmBehavior[] = [];

  // sport-specific trust in the raw probability
  const vol = features.volume24h ?? 0;
  const volTrust = Math.min(1, vol / profile.minVolume);
  const spreadTrust =
    features.spreadRel === null
      ? 0.4
      : Math.max(0, 1 - features.spreadRel / profile.thinSpreadRel);
  const trust = Math.round(
    Math.min(1, volTrust * 0.5 + spreadTrust * 0.3 + features.dataQuality * 0.2) * 1000,
  ) / 1000;

  // keep only behaviors this sport treats as signal
  for (const b of features.behaviors) {
    if (profile.highSignal.includes(b)) flags.push(b);
  }

  // honest, non-attributing notes
  if (vol < profile.minVolume) {
    notes.push(`Volume ${Math.round(vol)} below ${sportCode} trust bar (${profile.minVolume}) — thin market.`);
  }
  if (features.spreadRel !== null && features.spreadRel > profile.thinSpreadRel) {
    notes.push(`Wide spread (${(features.spreadRel * 100).toFixed(1)}%) — uncertain pricing.`);
  }
  if (features.move360m !== null && Math.abs(features.move360m) >= 0.02) {
    notes.push(
      `Price moved ${(features.move360m >= 0 ? "+" : "") + (features.move360m * 100).toFixed(1)}pp in 6h — repricing detected (cause not attributed).`,
    );
  }
  if (features.bookDivergence !== null && Math.abs(features.bookDivergence) >= 0.04) {
    notes.push(
      `PM ${features.bookDivergence > 0 ? "higher" : "lower"} than sportsbook by ${(Math.abs(features.bookDivergence) * 100).toFixed(1)}pp.`,
    );
  }
  if (features.crossVenueDivergence !== null && features.crossVenueDivergence >= 0.04) {
    notes.push(`Kalshi and Polymarket disagree by ${(features.crossVenueDivergence * 100).toFixed(1)}pp.`);
  }
  if (notes.length === 0) notes.push("Market stable; no unusual activity.");

  return {
    sportCode,
    coverage: true,
    prob: features.combinedProb,
    trust,
    flags: flags.length ? flags : ["agreement"],
    notes,
  };
}

/** Run all applicable: convenience to get the sport's read for an event. */
export function sportPmRead(
  sportCode: string,
  features: IntelFeatures | null,
): SportPmRead {
  return runSportPmModel(sportCode, features);
}

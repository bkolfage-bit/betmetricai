/**
 * Models / common interface (§28).
 *
 * Every sport module implements SportModel. Sport-specific logic lives in
 * the sport module; shared infrastructure (probability, EV, calibration,
 * simulation, ensemble, edge score) lives in api/engine/.
 *
 * train/validate/backtest run offline against chronological data (§19/§32);
 * predict/simulate produce the standardized output consumed by the pick
 * engine (§27). The AI layer never produces these numbers.
 */
import type { ComponentVote } from "../engine/ensemble";
import type { DistParams } from "../engine/markets";

/** Sport-specific ratings payload (stored in team_ratings.ratings JSON). */
export type Ratings = Record<string, number>;

export interface PredictContext {
  neutral?: boolean;
  weather?: string | null;
  injuries?: string | null;
}

export interface ModelOutput {
  /** standardized output (§27) */
  projHomeScore: number;
  projAwayScore: number;
  projSpread: number; // projected home margin
  projTotal: number;
  homeWinProb: number; // includes OT/SO where the sport has it
  drawProb: number; // regulation draw (soccer); 0 elsewhere
  confidence: number; // 0..1
  components: ComponentVote[];
  agreement: string;
  agreementFrac: number;
  dist: DistParams;
  extras?: Record<string, unknown>; // sport-specific extras (method probs etc.)
}

export interface LiveConfig {
  gameMinutes: number; // regulation length used by the live model
  periods: number;
  marginSd: number;
  totalSd: number;
  /** scoring events per game for score advancement */
  homeScoreRate: number;
  awayScoreRate: number;
}

export interface SportModel {
  sportCode: string;
  modelId: string;
  name: string;
  modelVersion: string;
  featureVersion: string;
  components: Array<{ name: string; weight: number }>;
  live: LiveConfig;
  /** markets this sport generates picks on */
  pickMarkets: Array<"moneyline" | "spread" | "total">;
  predict(home: Ratings, away: Ratings, ctx: PredictContext): ModelOutput;
}

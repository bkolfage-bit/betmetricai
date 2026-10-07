/**
 * Engine / ensemble (§12, §17) — combines the component models of a sport
 * into one probability set. Weights come from the model registry (fitted on
 * chronological validation data), NOT a blind average. Also tracks model
 * agreement: how many components side with the ensemble.
 */

export interface ComponentVote {
  name: string;
  weight: number;
  /** probability the component assigns to the HOME side winning */
  homeWinProb: number;
  /** component's projected home margin (for spread consensus) */
  projSpread?: number;
  projTotal?: number;
}

export interface EnsembleResult {
  homeWinProb: number;
  projSpread: number;
  projTotal: number;
  /** e.g. 3 of 4 components agree with the ensemble side */
  agreementCount: number;
  agreementTotal: number;
  agreement: string; // "3/4"
  agreementFrac: number; // 0..1
  side: "home" | "away";
}

export function combine(votes: ComponentVote[]): EnsembleResult {
  const totalW = votes.reduce((s, v) => s + v.weight, 0) || 1;
  const homeWinProb =
    votes.reduce((s, v) => s + v.weight * v.homeWinProb, 0) / totalW;
  const spreads = votes.filter((v) => v.projSpread !== undefined);
  const totals = votes.filter((v) => v.projTotal !== undefined);
  const projSpread = spreads.length
    ? spreads.reduce((s, v) => s + v.weight * (v.projSpread ?? 0), 0) /
      spreads.reduce((s, v) => s + v.weight, 0)
    : 0;
  const projTotal = totals.length
    ? totals.reduce((s, v) => s + v.weight * (v.projTotal ?? 0), 0) /
      totals.reduce((s, v) => s + v.weight, 0)
    : 0;

  const side: "home" | "away" = homeWinProb >= 0.5 ? "home" : "away";
  const agree = votes.filter((v) =>
    side === "home" ? v.homeWinProb >= 0.5 : v.homeWinProb < 0.5,
  ).length;
  return {
    homeWinProb,
    projSpread,
    projTotal,
    agreementCount: agree,
    agreementTotal: votes.length,
    agreement: `${agree}/${votes.length}`,
    agreementFrac: votes.length ? agree / votes.length : 0,
    side,
  };
}

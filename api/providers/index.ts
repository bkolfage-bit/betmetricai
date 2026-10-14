/**
 * Provider registry — one place to swap or add odds providers.
 */
import type { OddsProvider } from "./types";
import { TheOddsApiProvider } from "./the-odds-api";

let cached: OddsProvider | null = null;

export function getOddsProvider(): OddsProvider {
  if (!cached) cached = new TheOddsApiProvider();
  return cached;
}

/** true when a production odds provider is configured server-side */
export function hasOddsProvider(): boolean {
  return Boolean(process.env.ODDS_API_KEY);
}

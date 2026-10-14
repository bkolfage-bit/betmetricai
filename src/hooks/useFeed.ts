import { trpc } from "@/providers/trpc";

/** Shared odds-feed freshness (polls every 15s). */
export function useFeed() {
  return trpc.odds.freshness.useQuery(undefined, {
    refetchInterval: 15000,
    staleTime: 10000,
  }).data;
}

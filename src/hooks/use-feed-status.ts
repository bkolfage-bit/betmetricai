/**
 * Live odds-feed status via SSE with automatic tRPC-polling fallback.
 * Drives the LIVE ODDS / DEMO DATA badge and staleness states.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";

export interface FeedHealthRow {
  sportCode: string;
  status: "healthy" | "warning" | "degraded" | "offline" | "unavailable";
  lastSuccessAt: string | Date | null;
  message: string | null;
}

export interface FeedStatus {
  mode: "demo" | "live";
  providerConfigured: boolean;
  quotaTier?: string;
  creditsRemaining?: number | null;
  health: FeedHealthRow[];
  /** true while connected to the realtime stream */
  realtime: boolean;
}

export function useFeedStatus(): FeedStatus {
  const [sse, setSse] = useState<Omit<FeedStatus, "realtime"> | null>(null);
  const query = trpc.feed.status.useQuery(undefined, {
    refetchInterval: sse ? false : 30_000, // fallback polling only when SSE is down
    staleTime: 20_000,
  });

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/feed/stream");
      es.addEventListener("status", (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data);
          setSse({
            mode: d.mode === "live" ? "live" : "demo",
            providerConfigured: !!d.providerConfigured,
            quotaTier: d.quotaTier,
            creditsRemaining: d.creditsRemaining ?? null,
            health: d.health ?? [],
          });
        } catch {
          /* malformed frame — ignore */
        }
      });
      es.onerror = () => {
        // browser auto-reconnects; tRPC fallback covers the gap
      };
    } catch {
      /* EventSource unavailable — fallback polling covers it */
    }
    return () => es?.close();
  }, []);

  if (sse) return { ...sse, realtime: true };
  const d = query.data;
  return {
    mode: d?.mode === "live" ? "live" : "demo",
    providerConfigured: !!d?.providerConfigured,
    health: (d?.health ?? []) as FeedHealthRow[],
    realtime: false,
  };
}

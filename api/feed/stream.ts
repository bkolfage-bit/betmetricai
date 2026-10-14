/**
 * Realtime feed status stream (SSE).
 *
 * Emits a compact status frame on connect and then every 15s:
 * feed mode, per-sport health/staleness, and quota tier. The frontend uses
 * this to flip LIVE/DEMO badges and staleness states without manual refresh.
 * No provider traffic happens here — it only reads our own tables.
 */
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { getFeedStatus } from "./service";

const TICK_MS = 15_000;

export async function feedStreamHandler(c: Context) {
  return streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });
    let seq = 0;
    while (!closed) {
      try {
        const s = await getFeedStatus();
        await stream.writeSSE({
          event: "status",
          id: String(seq++),
          data: JSON.stringify({
            ts: Date.now(),
            mode: s.mode,
            providerConfigured: s.providerConfigured,
            quotaTier: s.quota.tier,
            creditsRemaining: s.quota.remaining,
            health: s.health.map((h) => ({
              sportCode: h.sportCode,
              status: h.status,
              lastSuccessAt: h.lastSuccessAt,
              message: h.message,
            })),
          }),
        });
      } catch {
        // keep the stream alive even if a status read fails
      }
      await stream.sleep(TICK_MS);
    }
  });
}

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { handleAssistantChat } from "./assistant";
import { startSimulator } from "./lib/sim";
import { startFeedScheduler } from "./feed/scheduler";
import { feedStreamHandler } from "./feed/stream";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
// Liveness/readiness probe for hosting platforms and uptime monitors.
// 200 with db:true = fully healthy; 503 = process up but database unreachable.
app.get("/api/health", async (c) => {
  let db = false;
  try {
    const { getDb } = await import("./queries/connection");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    db = true;
  } catch { /* db down — report, don't crash */ }
  return c.json(
    {
      ok: true,
      db,
      uptime: Math.round(process.uptime()),
      ts: new Date().toISOString(),
      // Railway injects RAILWAY_* env vars into every container automatically
      // (no setup needed) — lets monitors distinguish Railway from Kimi hosting.
      railway: !!process.env.RAILWAY_ENVIRONMENT,
    },
    db ? 200 : 503,
  );
});
app.get(Paths.oauthCallback, createOAuthCallbackHandler());
app.post("/api/ai/chat", async (c) => handleAssistantChat(c.req.raw));
// realtime odds-feed status (SSE)
app.get("/api/feed/stream", (c) => feedStreamHandler(c));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

// DEMO DATA market simulator — stands down automatically when the feed is LIVE
startSimulator();
// Production odds feed — adaptive polling, gated by LIVE mode + quota tiers
startFeedScheduler();

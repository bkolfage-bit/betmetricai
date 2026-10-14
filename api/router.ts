import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { picksRouter } from "./routers/picks";
import { oddsRouter } from "./routers/odds";
import { propsRouter, alertsRouter } from "./routers/props";
import { performanceRouter } from "./routers/performance";
import { trackerRouter } from "./routers/tracker";
import { parlaysRouter, adminRouter } from "./routers/parlays";
import { modelsRouter } from "./routers/models";
import { feedRouter } from "./routers/feed";
import { pmarketsRouter } from "./routers/pmarkets";
import { savedRouter } from "./routers/saved";
import { testimonialsRouter } from "./routers/testimonials";
import { marketIntelRouter } from "./routers/market-intel";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  picks: picksRouter,
  odds: oddsRouter,
  props: propsRouter,
  alerts: alertsRouter,
  performance: performanceRouter,
  tracker: trackerRouter,
  parlays: parlaysRouter,
  admin: adminRouter,
  models: modelsRouter,
  feed: feedRouter,
  pmarkets: pmarketsRouter,
  saved: savedRouter,
  testimonials: testimonialsRouter,
  marketIntel: marketIntelRouter,
});

export type AppRouter = typeof appRouter;

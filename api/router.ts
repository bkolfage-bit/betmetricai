import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { picksRouter } from "./routers/picks";
import { oddsRouter } from "./routers/odds";
import { propsRouter, alertsRouter } from "./routers/props";
import { performanceRouter } from "./routers/performance";
import { trackerRouter } from "./routers/tracker";
import { parlaysRouter, adminRouter } from "./routers/parlays";

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
});

export type AppRouter = typeof appRouter;

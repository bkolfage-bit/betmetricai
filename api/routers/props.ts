import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  alerts,
  events,
  playerProps,
  sportsbooks,
  teams,
} from "@db/schema";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

const homeTeams = alias(teams, "home_teams");
const awayTeams = alias(teams, "away_teams");

export const propsRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        prop: playerProps,
        event: events,
        home: homeTeams,
        away: awayTeams,
        book: sportsbooks,
      })
      .from(playerProps)
      .innerJoin(events, eq(playerProps.eventId, events.id))
      .innerJoin(homeTeams, eq(events.homeTeamId, homeTeams.id))
      .innerJoin(awayTeams, eq(events.awayTeamId, awayTeams.id))
      .innerJoin(sportsbooks, eq(playerProps.sportsbookId, sportsbooks.id))
      .orderBy(desc(playerProps.edgeScore));
    return rows;
  }),
});

export const alertsRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(alerts).orderBy(desc(alerts.id)).limit(30);
  }),
});

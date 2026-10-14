/**
 * Saved picks router — the user's personal watchlist of AI picks.
 * Save/unsave from any pick card (heart button); the saved dashboard
 * shows each saved pick with its LIVE current version and, once the
 * event is final, the immutable graded result from pick_history.
 */
import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  aiPicks,
  aiPickVersions,
  events,
  pickHistory,
  savedPicks,
  sports,
  sportsbooks,
  teams,
} from "@db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const savedRouter = createRouter({
  /** Ids of the picks this user has saved — for heart button state. */
  ids: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select({ pickId: savedPicks.pickId })
      .from(savedPicks)
      .where(eq(savedPicks.userId, ctx.user.id));
    return rows.map((r) => r.pickId);
  }),

  /** Full saved-pick board: current version + event context + grading. */
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const saved = await db
      .select()
      .from(savedPicks)
      .where(eq(savedPicks.userId, ctx.user.id))
      .orderBy(desc(savedPicks.createdAt));
    if (saved.length === 0) return { upcoming: [], settled: [] };

    const pickIds = saved.map((s) => s.pickId);
    const picks = await db.select().from(aiPicks).where(inArray(aiPicks.id, pickIds));
    const versions = await db
      .select()
      .from(aiPickVersions)
      .where(inArray(aiPickVersions.pickId, pickIds))
      .orderBy(desc(aiPickVersions.version));
    const latestByPick = new Map<number, (typeof versions)[number]>();
    for (const v of versions) if (!latestByPick.has(v.pickId)) latestByPick.set(v.pickId, v);

    const eventIds = [...new Set(picks.map((p) => p.eventId))];
    const evRows = await db.select().from(events).where(inArray(events.id, eventIds));
    const teamRows = await db.select().from(teams);
    const teamMap = new Map(teamRows.map((t) => [t.id, t]));
    const bookRows = await db.select().from(sportsbooks);
    const bookMap = new Map(bookRows.map((b) => [b.id, b]));
    const sportRows = await db.select().from(sports);
    const sportMap = new Map(sportRows.map((s) => [s.id, s.code]));

    // graded outcomes for saved picks whose events have gone final
    const graded = await db
      .select()
      .from(pickHistory)
      .where(inArray(pickHistory.pickId, pickIds));
    const gradeByPick = new Map(graded.map((g) => [g.pickId ?? -1, g]));

    const savedAtByPick = new Map(saved.map((s) => [s.pickId, s.createdAt]));

    interface SavedRow {
      pick: (typeof picks)[number];
      version: (typeof versions)[number] | null;
      savedAt: Date | null;
      event: (typeof evRows)[number];
      sportCode: string;
      home: (typeof teamRows)[number] | null;
      away: (typeof teamRows)[number] | null;
      book: (typeof bookRows)[number] | null;
      grade: (typeof graded)[number] | null;
    }
    const upcoming: SavedRow[] = [];
    const settled: SavedRow[] = [];

    for (const p of picks) {
      const ev = evRows.find((e) => e.id === p.eventId);
      if (!ev) continue;
      const v = latestByPick.get(p.id) ?? null;
      const row = {
        pick: p,
        version: v,
        savedAt: savedAtByPick.get(p.id) ?? null,
        event: ev,
        sportCode: sportMap.get(ev.sportId) ?? "",
        home: teamMap.get(ev.homeTeamId) ?? null,
        away: teamMap.get(ev.awayTeamId) ?? null,
        book: v ? bookMap.get(v.sportsbookId) ?? null : null,
        grade: gradeByPick.get(p.id) ?? null,
      };
      if (ev.status === "final") settled.push(row);
      else upcoming.push(row);
    }

    // upcoming: soonest start first; settled: most recently graded first
    upcoming.sort((a, b) => a.event.startTime.getTime() - b.event.startTime.getTime());
    settled.sort(
      (a, b) => (b.grade?.placedAt.getTime() ?? 0) - (a.grade?.placedAt.getTime() ?? 0),
    );

    return { upcoming, settled };
  }),

  /** Save a pick to the user's list. Rejects picks on finished events. */
  add: authedQuery
    .input(z.object({ pickId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const picks = await db
        .select()
        .from(aiPicks)
        .where(eq(aiPicks.id, input.pickId));
      if (picks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown pick" });
      const [ev] = await db
        .select({ status: events.status })
        .from(events)
        .where(eq(events.id, picks[0].eventId));
      if (!ev || ev.status === "final") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This event has already finished — its picks are settled history.",
        });
      }
      const existing = await db
        .select({ id: savedPicks.id })
        .from(savedPicks)
        .where(and(eq(savedPicks.userId, ctx.user.id), eq(savedPicks.pickId, input.pickId)));
      if (existing.length === 0) {
        await db.insert(savedPicks).values({ userId: ctx.user.id, pickId: input.pickId });
      }
      return { saved: true };
    }),

  /** Remove a pick from the user's list. */
  remove: authedQuery
    .input(z.object({ pickId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(savedPicks)
        .where(and(eq(savedPicks.userId, ctx.user.id), eq(savedPicks.pickId, input.pickId)));
      return { saved: false };
    }),
});

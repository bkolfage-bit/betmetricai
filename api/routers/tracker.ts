import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { userBets } from "@db/schema";
import { and, desc, eq } from "drizzle-orm";
import { americanPayout } from "../lib/edge";
import { TRPCError } from "@trpc/server";

export const trackerRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select()
      .from(userBets)
      .where(eq(userBets.userId, ctx.user.id))
      .orderBy(desc(userBets.placedAt));
  }),

  add: authedQuery
    .input(
      z.object({
        sport: z.string().max(16).default("NFL"),
        eventLabel: z.string().min(1).max(128),
        market: z.string().min(1).max(32),
        selection: z.string().min(1).max(128),
        line: z.number().nullable().optional(),
        odds: z.number().int().min(-10000).max(10000),
        stake: z.number().positive().max(1_000_000),
        closingLine: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const r = await db
        .insert(userBets)
        .values({
          userId: ctx.user.id,
          sport: input.sport,
          eventLabel: input.eventLabel,
          market: input.market,
          selection: input.selection,
          line: input.line == null ? null : String(input.line),
          odds: input.odds,
          stake: String(input.stake.toFixed(2)),
          closingLine:
            input.closingLine == null ? null : String(input.closingLine),
        })
        .$returningId();
      return { id: r[0].id };
    }),

  settle: authedQuery
    .input(
      z.object({
        betId: z.number(),
        result: z.enum(["won", "lost", "push"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(userBets)
        .where(and(eq(userBets.id, input.betId), eq(userBets.userId, ctx.user.id)));
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      const bet = rows[0];
      const stake = parseFloat(bet.stake);
      const profit =
        input.result === "won"
          ? stake * americanPayout(bet.odds)
          : input.result === "lost"
            ? -stake
            : 0;
      await db
        .update(userBets)
        .set({
          result: input.result,
          profit: profit.toFixed(2),
          settledAt: new Date(),
        })
        .where(eq(userBets.id, input.betId));
      return { profit };
    }),

  remove: authedQuery
    .input(z.object({ betId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(userBets)
        .where(and(eq(userBets.id, input.betId), eq(userBets.userId, ctx.user.id)));
      return { ok: true };
    }),

  stats: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(userBets)
      .where(eq(userBets.userId, ctx.user.id));
    const pending = rows.filter((r) => r.result === "pending");
    const settled = rows.filter((r) => r.result !== "pending");
    const wins = settled.filter((r) => r.result === "won").length;
    const losses = settled.filter((r) => r.result === "lost").length;
    const decided = wins + losses;
    const profit = settled.reduce((s, r) => s + parseFloat(r.profit), 0);
    const stakedSettled = settled
      .filter((r) => r.result !== "push")
      .reduce((s, r) => s + parseFloat(r.stake), 0);
    const exposure = pending.reduce((s, r) => s + parseFloat(r.stake), 0);
    return {
      totalBets: rows.length,
      pendingCount: pending.length,
      wins,
      losses,
      pushes: settled.length - decided,
      winRate: decided > 0 ? wins / decided : 0,
      profit: Math.round(profit * 100) / 100,
      roi: stakedSettled > 0 ? profit / stakedSettled : 0,
      exposure: Math.round(exposure * 100) / 100,
    };
  }),
});

import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  adminConfig,
  aiPicks,
  aiPickVersions,
  apiLogs,
  events,
  sports,
  sportsbooks,
  teams,
  users,
} from "@db/schema";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { americanPayout, fmtLine, fmtOdds } from "../lib/edge";
import { adminQuery } from "../middleware";
import { getThresholds, setThresholds } from "../lib/config";
import { applyPickVersion } from "../engine/recompute";
import { TRPCError } from "@trpc/server";

const homeTeams = alias(teams, "home_teams");
const awayTeams = alias(teams, "away_teams");

function selectionLabel(
  market: string,
  selection: string,
  line: number | null,
  home: string,
  away: string,
): string {
  if (market === "moneyline") return `${selection === "home" ? home : away} ML`;
  if (market === "spread")
    return `${selection === "home" ? home : away} ${fmtLine(line)}`;
  return `${selection === "over" ? "Over" : "Under"} ${line}`;
}

export const parlaysRouter = createRouter({
  /**
   * AI parlay generation from verified platform picks.
   * Combines the current best +EV positions; the math is done here —
   * the AI layer only explains it.
   */
  suggest: publicQuery
    .input(
      z.object({
        legs: z.number().int().min(2).max(4).default(3),
        targetOdds: z.number().int().nullable().optional(),
        sports: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const versions = await db
        .select()
        .from(aiPickVersions)
        .orderBy(desc(aiPickVersions.version));
      const latestByPick = new Map<number, (typeof versions)[number]>();
      for (const v of versions) {
        if (!latestByPick.has(v.pickId)) latestByPick.set(v.pickId, v);
      }
      let usable = [...latestByPick.values()].filter(
        (v) =>
          (v.status === "STRONG_BET" ||
            v.status === "BET" ||
            v.status === "WATCH") &&
          parseFloat(v.ev) > 0,
      );
      if (usable.length < input.legs) {
        return {
          parlay: null,
          reason:
            "Not enough current +EV positions to build a parlay with the requested number of legs. This is a data limitation, not a model output.",
        };
      }

      const picks = await db.select().from(aiPicks);
      const pickMap = new Map(picks.map((p) => [p.id, p]));
      const evRows = await db
        .select({ event: events, home: homeTeams, away: awayTeams, sport: sports })
        .from(events)
        .innerJoin(homeTeams, eq(events.homeTeamId, homeTeams.id))
        .innerJoin(awayTeams, eq(events.awayTeamId, awayTeams.id))
        .innerJoin(sports, eq(events.sportId, sports.id));
      const evMap = new Map(evRows.map((r) => [r.event.id, r]));

      // respect the user's global sport focus
      if (input.sports && input.sports.length > 0) {
        const allowed = new Set(input.sports);
        usable = usable.filter((v) => {
          const p = pickMap.get(v.pickId);
          const ctx = p ? evMap.get(p.eventId) : undefined;
          return ctx ? allowed.has(ctx.sport.code) : false;
        });
        if (usable.length < input.legs) {
          return {
            parlay: null,
            reason:
              "Not enough +EV positions in the selected sport. Switch back to ALL SPORTS to widen the parlay pool.",
          };
        }
      }

      type Leg = {
        pickId: number;
        label: string;
        odds: number;
        modelProb: number;
        ev: number;
        edgeScore: number;
        eventId: number;
      };
      const legs: Leg[] = usable
        .map((v) => {
          const p = pickMap.get(v.pickId)!;
          const ctx = evMap.get(p.eventId)!;
          return {
            pickId: v.pickId,
            label: selectionLabel(
              p.market,
              p.selection,
              v.line === null ? null : parseFloat(v.line),
              ctx.home.abbr,
              ctx.away.abbr,
            ),
            odds: v.odds,
            modelProb: parseFloat(v.modelProb),
            ev: parseFloat(v.ev),
            edgeScore: v.edgeScore,
            eventId: p.eventId,
          };
        })
        .sort((a, b) => b.edgeScore - a.edgeScore)
        .slice(0, 10);

      // combinatorial search (distinct events only)
      let best: Leg[] | null = null;
      let bestDist = Infinity;
      const target = input.targetOdds ?? null;
      const combos = (arr: Leg[], k: number, start: number, acc: Leg[]) => {
        if (acc.length === k) {
          const eventIds = new Set(acc.map((l) => l.eventId));
          if (eventIds.size !== acc.length) return;
          const dec = acc.reduce((s, l) => s * (1 + americanPayout(l.odds)), 1);
          const american =
            dec >= 2
              ? Math.round((dec - 1) * 100)
              : Math.round(-100 / (dec - 1));
          const dist = target
            ? Math.abs(american - target)
            : -acc.reduce((s, l) => s + l.ev, 0); // no target → max total EV
          if (dist < bestDist) {
            bestDist = dist;
            best = [...acc];
          }
          return;
        }
        for (let i = start; i < arr.length; i++) {
          acc.push(arr[i]);
          combos(arr, k, i + 1, acc);
          acc.pop();
        }
      };
      combos(legs, input.legs, 0, []);
      if (!best) {
        return {
          parlay: null,
          reason:
            "Could not construct a parlay from distinct events with the current board.",
        };
      }

      const chosen = best as Leg[];
      const dec = chosen.reduce((s, l) => s * (1 + americanPayout(l.odds)), 1);
      const american =
        dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
      const combinedProb = chosen.reduce((s, l) => s * l.modelProb, 1);
      const combinedEv = combinedProb * (dec - 1) - (1 - combinedProb);
      const explanation =
        `${input.legs}-leg parlay at ${fmtOdds(american)} built from the current highest-edge positions: ` +
        chosen
          .map(
            (l) =>
              `${l.label} (model ${(l.modelProb * 100).toFixed(1)}%, EV ${(l.ev * 100).toFixed(1)}%)`,
          )
          .join("; ") +
        `. Combined model probability ${(combinedProb * 100).toFixed(1)}% against implied ${((1 / dec) * 100).toFixed(1)}%, for a combined expected value of ${(combinedEv * 100).toFixed(1)}% per unit. Legs are treated as independent; correlation between legs is not modeled. Parlays multiply variance — nothing here is a guarantee.`;

      return {
        parlay: {
          legs: chosen,
          americanOdds: american,
          combinedProb,
          impliedProb: 1 / dec,
          combinedEv,
        },
        explanation,
      };
    }),
});

export const adminRouter = createRouter({
  stats: adminQuery.query(async () => {
    const db = getDb();
    const allUsers = await db.select().from(users);
    const pro = allUsers.filter((u) => u.plan === "pro").length;
    const logs = await db
      .select()
      .from(apiLogs)
      .orderBy(desc(apiLogs.id))
      .limit(20);
    const tick = await db
      .select()
      .from(adminConfig)
      .where(eq(adminConfig.key, "sim_last_tick"));
    const thresholds = await getThresholds();
    const books = await db.select().from(sportsbooks);
    const sportRows = await db.select().from(sports);
    return {
      users: {
        total: allUsers.length,
        pro,
        free: allUsers.length - pro,
        admins: allUsers.filter((u) => u.role === "admin").length,
      },
      thresholds,
      books,
      sports: sportRows,
      logs,
      lastTick: tick[0]?.value ?? null,
    };
  }),

  updateThresholds: adminQuery
    .input(
      z.object({
        strongBet: z.number().int().min(50).max(100),
        bet: z.number().int().min(40).max(99),
        watch: z.number().int().min(30).max(98),
        hold: z.number().int().min(20).max(97),
        minEv: z.number().min(0).max(0.2),
      }),
    )
    .mutation(async ({ input }) => {
      if (
        !(input.strongBet > input.bet && input.bet > input.watch && input.watch > input.hold)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Thresholds must be strictly decreasing.",
        });
      }
      await setThresholds(input);
      // re-evaluate every pick under the new thresholds (versioned, never overwritten)
      const db = getDb();
      const picks = await db.select().from(aiPicks);
      let changed = 0;
      for (const p of picks) {
        const r = await applyPickVersion(p.id);
        if (r.changed) changed++;
      }
      return { ok: true, reEvaluated: picks.length, newVersions: changed };
    }),

  updateBook: adminQuery
    .input(
      z.object({
        bookId: z.number(),
        priority: z.number().int().min(0).max(100).optional(),
        active: z.boolean().optional(),
        affiliateUrl: z.string().url().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const set: Record<string, unknown> = {};
      if (input.priority !== undefined) set.priority = input.priority;
      if (input.active !== undefined) set.active = input.active;
      if (input.affiliateUrl !== undefined) set.affiliateUrl = input.affiliateUrl;
      if (Object.keys(set).length === 0) return { ok: false };
      await db
        .update(sportsbooks)
        .set(set)
        .where(eq(sportsbooks.id, input.bookId));
      return { ok: true };
    }),
});

/**
 * Prediction-market intelligence router.
 *
 * Read-only analytics: compares Kalshi / Polymarket implied probabilities
 * against sportsbook no-vig consensus and our independent AI models.
 * The AI models NEVER ingest prediction-market prices — the comparison is
 * computed here, at read time, so the two stay independent by construction.
 *
 * EV figures are analytical estimates AFTER estimated transaction costs
 * (Kalshi taker fee schedule; bid/ask spread on both venues). They describe
 * historical price discrepancies — they are not betting or trading advice,
 * and this platform does not execute trades or wagers.
 */
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  apiLogs,
  currentOdds,
  events,
  pmEvents,
  pmMarkets,
  pmPriceSnapshots,
  sports,
  teams,
} from "@db/schema";
import { latestPrediction } from "../engine/recompute";
import { kalshiTakerFee } from "../pm/kalshi";

interface VenueSide {
  mid: number | null;
  bid: number | null;
  ask: number | null;
}

interface VenueBook {
  home: VenueSide | null;
  away: VenueSide | null;
  draw: VenueSide | null;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  url: string | null;
  updatedAt: Date;
}

function n(v: string | null): number | null {
  return v === null ? null : parseFloat(v);
}

export const pmarketsRouter = createRouter({
  /** Comparison board: matched events with all probability sources. */
  board: publicQuery
    .input(z.object({ sport: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const now = new Date();
      const lo = new Date(now.getTime() - 12 * 3600_000);
      const hi = new Date(now.getTime() + 7 * 24 * 3600_000);

      const pmEvs = await db
        .select()
        .from(pmEvents)
        .where(
          and(
            eq(pmEvents.status, "open"),
            gte(pmEvents.startTime, lo),
            lte(pmEvents.startTime, hi),
            sql`${pmEvents.eventId} IS NOT NULL`,
            ...(input?.sport ? [eq(pmEvents.sportCode, input.sport)] : []),
          ),
        )
        .orderBy(asc(pmEvents.startTime))
        .limit(120);
      if (pmEvs.length === 0) return { rows: [], unmatched: 0, updatedAt: now };

      const [unmatchedCnt] = await db
        .select({ n: sql<number>`count(*)` })
        .from(pmEvents)
        .where(and(eq(pmEvents.status, "open"), sql`${pmEvents.eventId} IS NULL`, gte(pmEvents.startTime, lo)));

      const eventIds = [...new Set(pmEvs.map((e) => e.eventId!))];
      const ourEvents = await db.select().from(events).where(inArray(events.id, eventIds));
      const evById = new Map(ourEvents.map((e) => [e.id, e]));

      const teamIds = [...new Set(ourEvents.flatMap((e) => [e.homeTeamId, e.awayTeamId]))];
      const teamRows = teamIds.length
        ? await db.select().from(teams).where(inArray(teams.id, teamIds))
        : [];
      const teamById = new Map(teamRows.map((t) => [t.id, t]));

      const sportRows = await db.select().from(sports);
      const sportById = new Map(sportRows.map((s) => [s.id, s]));

      const mkts = await db
        .select()
        .from(pmMarkets)
        .where(and(inArray(pmMarkets.pmEventId, pmEvs.map((e) => e.id)), eq(pmMarkets.market, "moneyline")));

      const oddsRows = await db
        .select()
        .from(currentOdds)
        .where(and(inArray(currentOdds.eventId, eventIds), eq(currentOdds.market, "moneyline")));

      const rows = [];
      for (const pmEv of pmEvs) {
        const ev = evById.get(pmEv.eventId!);
        if (!ev) continue;
        const home = teamById.get(ev.homeTeamId);
        const away = teamById.get(ev.awayTeamId);
        if (!home || !away) continue;
        const sport = sportById.get(ev.sportId);

        // ---- this venue's moneyline book (per venue) ----
        // (built after grouping — see venues map below)

        // ---- sportsbook no-vig consensus ----
        const mine = oddsRows.filter((r) => r.eventId === ev.id);
        const med = (xs: number[]) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
        const impH = med(mine.filter((r) => r.outcome === "home").map((r) => parseFloat(r.impliedProb)));
        const impA = med(mine.filter((r) => r.outcome === "away").map((r) => parseFloat(r.impliedProb)));
        const impD = med(mine.filter((r) => r.outcome === "draw").map((r) => parseFloat(r.impliedProb)));
        let book: { home: number; away: number; draw: number | null } | null = null;
        if (impH !== null && impA !== null) {
          const tot = impH + impA + (impD ?? 0);
          book = { home: impH / tot, away: impA / tot, draw: impD !== null ? impD / tot : null };
        }

        // ---- independent AI model (pregame) ----
        const pred = await latestPrediction(ev.id, ev.status === "live");
        let model: { home: number; away: number; draw: number | null } | null = null;
        if (pred) {
          const hwp = parseFloat(pred.homeWinProb);
          let drawProb: number | null = null;
          try {
            drawProb = pred.details ? ((JSON.parse(pred.details) as { drawProb?: number }).drawProb ?? null) : null;
          } catch {
            drawProb = null;
          }
          const away = drawProb !== null ? 1 - hwp - drawProb : 1 - hwp;
          model = { home: hwp, away: Math.max(0, away), draw: drawProb };
        }

        rows.push({
          eventId: ev.id,
          sportCode: sport?.code ?? pmEv.sportCode,
          label: `${away.abbr} @ ${home.abbr}`,
          homeTeam: home.name,
          awayTeam: away.name,
          startTime: ev.startTime,
          status: ev.status,
          book,
          model,
          _pmEventIds: [pmEv.id],
        });
      }

      // merge venue books per event (one event can appear from both venues)
      const byEvent = new Map<number, (typeof rows)[number] & { venues: Partial<Record<"KALSHI" | "POLYMARKET", VenueBook>> }>();
      for (const r of rows) {
        const ex = byEvent.get(r.eventId);
        if (ex) ex._pmEventIds.push(...r._pmEventIds);
        else byEvent.set(r.eventId, { ...r, venues: {} });
      }
      for (const pmEv of pmEvs) {
        const target = byEvent.get(pmEv.eventId!);
        if (!target) continue;
        const mine = mkts.filter((m) => m.pmEventId === pmEv.id);
        const side = (sel: string): VenueSide | null => {
          const m = mine.find((x) => x.selection === sel);
          if (!m) return null;
          return { mid: n(m.mid), bid: n(m.bid), ask: n(m.ask) };
        };
        const vol = mine.reduce((s, m) => Math.max(s, n(m.volume) ?? 0), 0);
        const vol24 = mine.reduce((s, m) => Math.max(s, m.volume24h === null ? 0 : parseFloat(m.volume24h)), 0);
        const liq = mine.reduce((s, m) => Math.max(s, m.liquidity === null ? 0 : parseFloat(m.liquidity)), 0);
        target.venues[pmEv.venue] = {
          home: side("home"),
          away: side("away"),
          draw: side("draw"),
          volume: vol || null,
          volume24h: vol24 || null,
          liquidity: liq || null,
          url: pmEv.url,
          updatedAt: pmEv.updatedAt,
        };
      }

      // ---- discrepancies + EV after estimated transaction costs ----
      const finalRows = [...byEvent.values()].map((r) => {
        const opportunities: Array<{
          venue: "KALSHI" | "POLYMARKET";
          side: "home" | "away" | "draw";
          sideLabel: string;
          ask: number;
          estFee: number;
          modelProb: number;
          venueMid: number;
          evPerDollar: number;
          evRoi: number;
        }> = [];
        let maxAbsDivergence = 0;
        for (const [venue, vb] of Object.entries(r.venues) as Array<["KALSHI" | "POLYMARKET", VenueBook]>) {
          for (const sideKey of ["home", "away", "draw"] as const) {
            const s = vb[sideKey];
            const mp = r.model?.[sideKey === "draw" ? "draw" : sideKey];
            if (!s || s.mid === null || mp === null || mp === undefined) continue;
            maxAbsDivergence = Math.max(maxAbsDivergence, Math.abs(mp - s.mid));
            const ask = s.ask ?? s.mid; // cross the spread when no ask quoted
            if (ask === null || ask <= 0 || ask >= 1) continue;
            const fee = venue === "KALSHI" ? kalshiTakerFee(ask) : 0; // Polymarket: no taker fee
            const evPerDollar = mp - ask - fee; // $1 contract payoff economics
            opportunities.push({
              venue,
              side: sideKey,
              sideLabel:
                sideKey === "home" ? r.homeTeam : sideKey === "away" ? r.awayTeam : "Draw",
              ask,
              estFee: fee,
              modelProb: mp,
              venueMid: s.mid,
              evPerDollar,
              evRoi: evPerDollar / ask,
            });
          }
        }
        opportunities.sort((a, b) => b.evRoi - a.evRoi);
        const { _pmEventIds, ...rest } = r;
        return { ...rest, opportunities, maxAbsDivergence };
      });

      finalRows.sort((a, b) => b.maxAbsDivergence - a.maxAbsDivergence);
      return { rows: finalRows, unmatched: Number(unmatchedCnt?.n ?? 0), updatedAt: now };
    }),

  /** Probability trend for one matched event (both venues + references). */
  history: publicQuery
    .input(z.object({ eventId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const pms = await db
        .select()
        .from(pmEvents)
        .where(and(eq(pmEvents.eventId, input.eventId), eq(pmEvents.status, "open")));
      const series: Array<{
        venue: "KALSHI" | "POLYMARKET";
        side: string;
        url: string | null;
        points: Array<{ t: Date; p: number }>;
      }> = [];
      for (const pe of pms) {
        const mkts = await db
          .select()
          .from(pmMarkets)
          .where(and(eq(pmMarkets.pmEventId, pe.id), eq(pmMarkets.market, "moneyline"), inArray(pmMarkets.selection, ["home"])));
        for (const m of mkts) {
          const snaps = await db
            .select()
            .from(pmPriceSnapshots)
            .where(eq(pmPriceSnapshots.pmMarketId, m.id))
            .orderBy(asc(pmPriceSnapshots.capturedAt))
            .limit(500);
          series.push({
            venue: pe.venue,
            side: m.selection,
            url: pe.url,
            points: snaps.map((s) => ({ t: s.capturedAt, p: parseFloat(s.mid) })),
          });
        }
      }
      return { series };
    }),

  /** Venue health for attribution + admin surfaces. */
  status: publicQuery.query(async () => {
    const db = getDb();
    const per = async (venue: "KALSHI" | "POLYMARKET") => {
      const [open] = await db
        .select({ n: sql<number>`count(*)` })
        .from(pmEvents)
        .where(and(eq(pmEvents.venue, venue), eq(pmEvents.status, "open")));
      const [matched] = await db
        .select({ n: sql<number>`count(*)` })
        .from(pmEvents)
        .where(and(eq(pmEvents.venue, venue), eq(pmEvents.status, "open"), sql`${pmEvents.eventId} IS NOT NULL`));
      const [lastLog] = await db
        .select()
        .from(apiLogs)
        .where(eq(apiLogs.service, venue.toLowerCase()))
        .orderBy(desc(apiLogs.id))
        .limit(1);
      const [lastSnap] = await db
        .select({ t: sql<Date | null>`max(${pmPriceSnapshots.capturedAt})` })
        .from(pmPriceSnapshots);
      return {
        open: Number(open?.n ?? 0),
        matched: Number(matched?.n ?? 0),
        lastSyncAt: lastLog?.createdAt ?? null,
        lastSyncOk: lastLog ? lastLog.level !== "error" : null,
        lastMessage: lastLog?.message ?? null,
        lastPriceAt: lastSnap?.t ?? null,
      };
    };
    return { kalshi: await per("KALSHI"), polymarket: await per("POLYMARKET") };
  }),
});

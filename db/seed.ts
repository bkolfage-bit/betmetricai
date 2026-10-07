/**
 * BetMetricAi seed — DEMO DATA.
 *
 * Everything written here is synthetic demonstration data, clearly flagged
 * (events.isDemo = true, data_mode = DEMO). Once licensed odds/data API
 * credentials are configured, the same pipeline runs on verified feeds.
 */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import {
  adminConfig,
  aiPicks,
  alerts,
  events,
  oddsSnapshots,
  pickHistory,
  playerProps,
  predictions,
  sports,
  sportsbooks,
  teams,
} from "./schema";
import { normCdf } from "../api/lib/edge";
import { applyPickVersion } from "../api/engine/recompute";

/* deterministic RNG */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261007);

const HOURS = 3600_000;
const now = Date.now();

const NFL_TEAMS: Array<[string, string, string, number, number, number]> = [
  // city, name, abbr, elo, offEff, defEff
  ["Kansas City", "Chiefs", "KC", 1645, 7.2, 2.1],
  ["Buffalo", "Bills", "BUF", 1628, 6.8, 1.4],
  ["Baltimore", "Ravens", "BAL", 1631, 6.1, 2.8],
  ["Detroit", "Lions", "DET", 1619, 6.9, 0.9],
  ["Philadelphia", "Eagles", "PHI", 1612, 5.4, 2.6],
  ["San Francisco", "49ers", "SF", 1608, 5.9, 2.2],
  ["Cincinnati", "Bengals", "CIN", 1589, 5.1, -0.6],
  ["Green Bay", "Packers", "GB", 1594, 4.8, 1.1],
  ["Dallas", "Cowboys", "DAL", 1581, 4.2, 0.4],
  ["Miami", "Dolphins", "MIA", 1572, 4.6, -1.2],
  ["Houston", "Texans", "HOU", 1578, 3.9, 1.8],
  ["Los Angeles", "Rams", "LAR", 1585, 4.4, 0.2],
  ["Minnesota", "Vikings", "MIN", 1566, 3.5, 0.8],
  ["Pittsburgh", "Steelers", "PIT", 1561, 2.2, 2.4],
  ["Denver", "Broncos", "DEN", 1558, 2.8, 1.6],
  ["Tampa Bay", "Buccaneers", "TB", 1552, 3.1, -0.4],
];

// [homeIdx, awayIdx, startOffsetH, status, venue, weather, injuries]
const GAMES: Array<[number, number, number, string, string, string, string]> = [
  [0, 1, -0.08, "live", "GEHA Field at Arrowhead Stadium", "54°F, wind 9 mph W, clear", "BUF: CB2 doubtful (hamstring)"],
  [4, 5, -0.24, "live", "Lincoln Financial Field", "61°F, light rain", "SF: LT questionable (ankle)"],
  [2, 6, 0.6, "scheduled", "M&T Bank Stadium", "58°F, wind 6 mph", "CIN: WR1 probable (knee)"],
  [3, 7, 3.5, "scheduled", "Ford Field (dome)", "Dome — no weather impact", ""],
  [8, 9, 6.5, "scheduled", "AT&T Stadium (dome)", "Dome — no weather impact", "DAL: RG out (concussion)"],
  [10, 11, 27, "scheduled", "NRG Stadium", "Retractable roof — closed", ""],
  [12, 13, 50, "scheduled", "U.S. Bank Stadium (dome)", "Dome — no weather impact", "PIT: OLB2 out (groin)"],
  [14, 15, 74, "scheduled", "Empower Field at Mile High", "41°F, wind 14 mph, snow possible", "TB: DT1 questionable"],
];

function probToAmerican(p: number, vig = 0.045): number {
  // add vig by moving price away from fair
  const fair = p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
  const juiced = fair < 0 ? fair * (1 + vig) : fair / (1 + vig);
  return Math.round(juiced / 5) * 5;
}

async function seed() {
  const db = getDb();
  console.log("Seeding BetMetricAi DEMO dataset...");

  /* config */
  const configRows = [
    { key: "data_mode", value: "DEMO" },
    {
      key: "edge_thresholds",
      value: JSON.stringify({ strongBet: 90, bet: 80, watch: 70, hold: 60, minEv: 0.01 }),
    },
    { key: "model_version", value: "nfl-ensemble-v1.3" },
  ];
  for (const row of configRows) {
    await db
      .insert(adminConfig)
      .values(row)
      .onDuplicateKeyUpdate({ set: { value: row.value } });
  }

  /* sports */
  const sportRows = await db
    .insert(sports)
    .values([
      { code: "NFL", name: "NFL Football", modelStatus: "live" },
      { code: "NBA", name: "NBA Basketball", modelStatus: "training" },
      { code: "MLB", name: "MLB Baseball", modelStatus: "training" },
      { code: "NHL", name: "NHL Hockey", modelStatus: "training" },
      { code: "NCAAF", name: "NCAA Football", modelStatus: "planned" },
      { code: "NCAAB", name: "NCAA Basketball", modelStatus: "planned" },
      { code: "EPL", name: "Soccer", modelStatus: "planned" },
      { code: "UFC", name: "UFC / MMA", modelStatus: "planned" },
    ])
    .$returningId();
  const nflId = sportRows[0].id;

  /* teams */
  const teamIds: number[] = [];
  for (const [city, name, abbr, elo, off, def] of NFL_TEAMS) {
    const r = await db
      .insert(teams)
      .values({ sportId: nflId, city, name, abbr, elo, offEff: String(off), defEff: String(def) })
      .$returningId();
    teamIds.push(r[0].id);
  }

  /* sportsbooks */
  const BOOKS: Array<[string, string, number]> = [
    ["DraftKings", "DK", 1],
    ["FanDuel", "FD", 2],
    ["BetMGM", "MGM", 3],
    ["Caesars", "CZR", 4],
    ["bet365", "B365", 5],
    ["Fanatics", "FAN", 6],
  ];
  const bookIds: number[] = [];
  for (const [name, code, priority] of BOOKS) {
    const r = await db
      .insert(sportsbooks)
      .values({
        name,
        code,
        priority,
        affiliateUrl: `https://affiliate.betmetric.ai/go/${code.toLowerCase()}?utm_source=betmetricai&utm_medium=oddsboard`,
      })
      .$returningId();
    bookIds.push(r[0].id);
  }

  /* events + predictions */
  const eventIds: number[] = [];
  const projSpreads: number[] = [];
  const projTotals: number[] = [];
  for (let g = 0; g < GAMES.length; g++) {
    const [h, a, offsetH, status, venue, weather, injuries] = GAMES[g];
    const teamH = NFL_TEAMS[h];
    const teamA = NFL_TEAMS[a];
    const eloEdge = (teamH[3] - teamA[3]) / 25;
    const effEdge = (teamH[4] - teamA[5]) * 0.35 - (teamA[4] - teamH[5]) * 0.35;
    const hfa = venue.includes("dome") || venue.includes("Dome") ? 1.6 : 1.9;
    const projSpread = Math.round((eloEdge + effEdge + hfa) * 2) / 2; // home margin
    const windPenalty = weather.includes("wind 14") || weather.includes("rain") ? -2.5 : 0;
    const projTotal =
      Math.round((44 + (teamH[4] + teamA[4]) * 0.55 - (teamH[5] + teamA[5]) * 0.3 + windPenalty) * 2) / 2;
    const homeWinProb = normCdf(projSpread / 13.5);
    const projHome = Math.round(((projTotal + projSpread) / 2) * 10) / 10;
    const projAway = Math.round(((projTotal - projSpread) / 2) * 10) / 10;

    const startTime = new Date(now + offsetH * HOURS);
    const isLive = status === "live";
    const liveElapsedMin = isLive ? -offsetH * 60 : 0;
    const gameMin = Math.min(59, liveElapsedMin * 2);
    const quarter = Math.min(4, Math.floor(gameMin / 15) + 1);
    const clockSec = Math.max(0, Math.round((15 - (gameMin % 15)) * 60));
    let hs = 0;
    let as = 0;
    if (isLive) {
      // deterministic partial scores consistent with projection
      const frac = gameMin / 60;
      hs = Math.round(projHome * frac * (0.9 + rand() * 0.2));
      as = Math.round(projAway * frac * (0.9 + rand() * 0.2));
    }

    const r = await db
      .insert(events)
      .values({
        sportId: nflId,
        homeTeamId: teamIds[h],
        awayTeamId: teamIds[a],
        startTime,
        status: status as "live" | "scheduled" | "final",
        venue,
        weather,
        injuries: injuries || null,
        homeScore: isLive ? hs : null,
        awayScore: isLive ? as : null,
        period: isLive ? `Q${quarter}` : null,
        clock: isLive ? `${Math.floor(clockSec / 60)}:${String(clockSec % 60).padStart(2, "0")}` : null,
        isDemo: true,
      })
      .$returningId();
    eventIds.push(r[0].id);
    projSpreads.push(projSpread);
    projTotals.push(projTotal);

    await db.insert(predictions).values({
      eventId: r[0].id,
      modelVersion: "nfl-ensemble-v1.3",
      projHomeScore: String(projHome.toFixed(1)),
      projAwayScore: String(projAway.toFixed(1)),
      projSpread: String(projSpread.toFixed(1)),
      projTotal: String(projTotal.toFixed(1)),
      homeWinProb: homeWinProb.toFixed(4),
      confidence: (0.68 + rand() * 0.18).toFixed(3),
      isLive: false,
      createdAt: new Date(now - 8 * HOURS),
    });

    if (isLive) {
      const margin = hs - as;
      const progress = gameMin / 60;
      const liveSpread = margin + projSpread * (1 - progress) * 0.85;
      const sdRem = Math.max(2.5, 13.5 * Math.sqrt(1 - progress));
      await db.insert(predictions).values({
        eventId: r[0].id,
        modelVersion: "nfl-ensemble-v1.3-live",
        projHomeScore: String(Math.max(hs, hs + liveSpread / 2).toFixed(1)),
        projAwayScore: String(Math.max(as, as - liveSpread / 2).toFixed(1)),
        projSpread: liveSpread.toFixed(1),
        projTotal: String((hs + as + projTotal * (1 - progress) * 0.9).toFixed(1)),
        homeWinProb: normCdf(liveSpread / sdRem).toFixed(4),
        confidence: (0.62 + 0.2 * progress).toFixed(3),
        isLive: true,
      });
    }
  }

  /* ---------------- odds snapshots in 3 historical batches -------------- */
  const batchTimes = [
    new Date(now - 6 * HOURS),
    new Date(now - 2 * HOURS),
    new Date(now - 0.4 * HOURS),
  ];

  // per-event market path: open → mid → current (drift, sometimes against model)
  interface MarketPath {
    spread: [number, number, number];
    total: [number, number, number];
    mlHome: [number, number, number];
  }
  const paths: MarketPath[] = [];
  for (let g = 0; g < GAMES.length; g++) {
    const proj = projSpreads[g];
    // market opens slightly off the model (this is where edge comes from)
    const openBias = (rand() - 0.35) * 2.5;
    const openSpread = -Math.round((proj + openBias) * 2) / 2; // negative = home favored
    const drift1 = (rand() - 0.5) * 1;
    const drift2 = g % 3 === 0 ? -1 : g % 3 === 1 ? 0.5 : 0; // some move against home
    const spreadPath: [number, number, number] = [
      openSpread,
      Math.round((openSpread + drift1) * 2) / 2,
      Math.round((openSpread + drift1 + drift2) * 2) / 2,
    ];
    const totalOpen = Math.round((projTotals[g] + (rand() - 0.5) * 3) * 2) / 2;
    const totalPath: [number, number, number] = [
      totalOpen,
      Math.round((totalOpen + (rand() - 0.5)) * 2) / 2,
      Math.round((totalOpen + (rand() - 0.5) * 1.5) * 2) / 2,
    ];
    const mlPath = spreadPath.map((sp) => {
      const p = normCdf(-sp / 13.5); // home win prob implied by line
      return probToAmerican(p);
    }) as [number, number, number];
    paths.push({ spread: spreadPath, total: totalPath, mlHome: mlPath });
  }

  const pickIds: number[] = [];

  // choose picks: selections where the model disagrees with the CURRENT market
  for (let g = 0; g < GAMES.length; g++) {
    const curSpread = paths[g].spread[2]; // home spread (negative = home fav)
    const proj = projSpreads[g];
    const modelCoversHome = proj + curSpread; // >0 → model likes home
    const spreadSel = modelCoversHome >= 0 ? "home" : "away";
    const totalSel = projTotals[g] >= paths[g].total[2] ? "over" : "under";

    const r1 = await db
      .insert(aiPicks)
      .values({ eventId: eventIds[g], market: "spread", selection: spreadSel })
      .$returningId();
    pickIds.push(r1[0].id);
    if (g % 2 === 0) {
      const r2 = await db
        .insert(aiPicks)
        .values({ eventId: eventIds[g], market: "total", selection: totalSel })
        .$returningId();
      pickIds.push(r2[0].id);
    }
    if (g % 4 === 0) {
      const r3 = await db
        .insert(aiPicks)
        .values({ eventId: eventIds[g], market: "moneyline", selection: proj >= 0 ? "home" : "away" })
        .$returningId();
      pickIds.push(r3[0].id);
    }
  }

  // insert snapshots batch by batch, applying pick versions after each
  for (let b = 0; b < 3; b++) {
    const t = batchTimes[b];
    for (let g = 0; g < GAMES.length; g++) {
      const evId = eventIds[g];
      const isLiveEv = GAMES[g][3] === "live";
      const sp = paths[g].spread[b];
      const tot = paths[g].total[b];
      const mlH = paths[g].mlHome[b];
      const mlA = probToAmerican(1 - normCdf(-sp / 13.5));
      for (let bi = 0; bi < bookIds.length; bi++) {
        const j = rand();
        const bookSp = Math.round((sp + (j > 0.75 ? 0.5 : j < 0.2 ? -0.5 : 0)) * 2) / 2;
        const juice = Math.round((rand() - 0.5) * 12);
        const rows = [
          { eventId: evId, sportsbookId: bookIds[bi], market: "spread" as const, selection: "home", line: String(bookSp), odds: -110 + juice, isLive: isLiveEv && b === 2, capturedAt: t },
          { eventId: evId, sportsbookId: bookIds[bi], market: "spread" as const, selection: "away", line: String(-bookSp), odds: -110 - juice, isLive: isLiveEv && b === 2, capturedAt: t },
          { eventId: evId, sportsbookId: bookIds[bi], market: "total" as const, selection: "over", line: String(tot), odds: -110 + Math.round(juice / 2), isLive: isLiveEv && b === 2, capturedAt: t },
          { eventId: evId, sportsbookId: bookIds[bi], market: "total" as const, selection: "under", line: String(tot), odds: -110 - Math.round(juice / 2), isLive: isLiveEv && b === 2, capturedAt: t },
          { eventId: evId, sportsbookId: bookIds[bi], market: "moneyline" as const, selection: "home", line: null, odds: mlH + Math.round(juice / 2), isLive: isLiveEv && b === 2, capturedAt: t },
          { eventId: evId, sportsbookId: bookIds[bi], market: "moneyline" as const, selection: "away", line: null, odds: mlA - Math.round(juice / 2), isLive: isLiveEv && b === 2, capturedAt: t },
        ];
        await db.insert(oddsSnapshots).values(rows);
      }
    }
    // create/refresh pick versions at this point in the timeline
    for (const pid of pickIds) {
      await applyPickVersion(pid, { force: true, createdAt: t });
    }
    console.log(`  batch ${b + 1}/3 applied`);
  }

  /* ------------------------------ player props -------------------------- */
  const PROP_PLAYERS: Array<[number, string, string, string, number, number]> = [
    // gameIdx, player, teamAbbr, market, line, projValue
    [0, "Patrick Mahomes", "KC", "Passing Yards", 268.5, 281],
    [0, "Josh Allen", "BUF", "Passing Yards", 254.5, 246],
    [0, "James Cook", "BUF", "Rushing Yards", 72.5, 81],
    [2, "Lamar Jackson", "BAL", "Rushing Yards", 58.5, 64],
    [2, "Ja'Marr Chase", "CIN", "Receiving Yards", 84.5, 79],
    [3, "Jahmyr Gibbs", "DET", "Rushing Yards", 78.5, 88],
    [3, "Jordan Love", "GB", "Passing Yards", 244.5, 238],
    [4, "CeeDee Lamb", "DAL", "Receptions", 6.5, 7.4],
    [4, "Tyreek Hill", "MIA", "Receiving Yards", 76.5, 71],
    [5, "C.J. Stroud", "HOU", "Passing Yards", 238.5, 249],
    [6, "Justin Jefferson", "MIN", "Receiving Yards", 88.5, 97],
    [7, "Bo Nix", "DEN", "Passing TDs", 1.5, 1.9],
  ];
  for (const [gi, player, abbr, market, line, proj] of PROP_PLAYERS) {
    const probOver = normCdf((proj - line) / (market.includes("TD") ? 0.9 : line * 0.22));
    const evOver = probOver * 0.909 - (1 - probOver);
    const edge = Math.max(
      0,
      Math.min(100, Math.round((probOver - 0.524) * 400 + evOver * 500 + 55)),
    );
    const bi = Math.floor(rand() * bookIds.length);
    await db.insert(playerProps).values({
      eventId: eventIds[gi],
      sportsbookId: bookIds[bi],
      player,
      teamAbbr: abbr,
      market,
      line: String(line),
      overOdds: -110 + Math.round((rand() - 0.5) * 20),
      underOdds: -110 + Math.round((rand() - 0.5) * 20),
      projValue: String(proj),
      probOver: probOver.toFixed(4),
      evOver: evOver.toFixed(4),
      edgeScore: edge,
    });
  }

  /* ------------------------- graded pick history ------------------------ */
  const histTeams = NFL_TEAMS.map((t) => t[2]);
  let cursor = now - 90 * 24 * HOURS;
  const histRows: Array<typeof pickHistory.$inferInsert> = [];
  for (let i = 0; i < 148; i++) {
    cursor += (8 + rand() * 18) * HOURS;
    if (cursor > now - 2 * HOURS) break;
    const market = rand() < 0.55 ? "spread" : rand() < 0.75 ? "total" : "moneyline";
    const edgeScore = 62 + Math.floor(rand() * 36);
    // higher-edge picks win more often (realistic calibration)
    const winProb = 0.48 + (edgeScore - 62) * 0.004;
    const outcome = rand();
    const result = outcome < winProb ? "won" : outcome < winProb + 0.02 ? "push" : "lost";
    const odds = market === "moneyline" ? (rand() < 0.6 ? -110 - Math.floor(rand() * 60) : 105 + Math.floor(rand() * 45)) : -110 + Math.floor((rand() - 0.5) * 16);
    const payout = odds > 0 ? odds / 100 : 100 / -odds;
    const units = result === "won" ? payout : result === "push" ? 0 : -1;
    const t1 = histTeams[Math.floor(rand() * histTeams.length)];
    let t2 = histTeams[Math.floor(rand() * histTeams.length)];
    if (t2 === t1) t2 = histTeams[(histTeams.indexOf(t1) + 5) % histTeams.length];
    histRows.push({
      sportCode: "NFL",
      market,
      eventLabel: `${t2} @ ${t1}`,
      selection:
        market === "spread"
          ? (() => { const ln = (rand() < 0.5 ? -1 : 1) * (2 + Math.floor(rand() * 6)) + (rand() < 0.5 ? 0.5 : 0); return `${rand() < 0.5 ? t1 : t2} ${ln > 0 ? "+" : ""}${ln}`; })()
          : market === "total"
            ? `${rand() < 0.5 ? "Over" : "Under"} ${40 + Math.floor(rand() * 12) + 0.5}`
            : `${rand() < 0.5 ? t1 : t2} ML`,
      odds,
      edgeScore,
      result: result as "won" | "lost" | "push",
      units: units.toFixed(2),
      clv: ((rand() - 0.35) * 6).toFixed(3),
      placedAt: new Date(cursor),
    });
  }
  for (const row of histRows) await db.insert(pickHistory).values(row);

  /* alerts */
  await db.insert(alerts).values([
    {
      type: "pick_change",
      title: "Pick status changed: BET → STRONG_BET",
      message: "Line moved half a point toward the model projection, expanding the probability edge.",
    },
    {
      type: "line_move",
      title: "Significant line movement detected",
      message: "A market moved a full point within 30 minutes — pick engine recalculated all affected positions.",
    },
    {
      type: "injury",
      title: "Injury report updated",
      message: "Injury data refreshed and folded into model features. Affected picks were re-evaluated.",
    },
  ]);

  console.log(`Seeded: ${eventIds.length} events, ${pickIds.length} picks, ${histRows.length} graded history rows.`);
  console.log("Done. DATA MODE = DEMO.");
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});

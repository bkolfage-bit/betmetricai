/**
 * ASK THE AI — the OpenAI-compatible intelligence layer.
 *
 * Architecture rule: the model NEVER invents odds, probabilities, injuries,
 * weather or performance. It receives a verified snapshot of platform data
 * from the quantitative backend and explains it in natural language.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { getDb } from "./queries/connection";
import {
  aiPicks,
  aiPickVersions,
  events,
  sportsbooks,
  teams,
} from "@db/schema";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { fmtLine, fmtOdds } from "./lib/edge";
import { AiMisconfigured, classifyAiError, listModels } from "./lib/ai-client";

const homeTeams = alias(teams, "home_teams");
const awayTeams = alias(teams, "away_teams");

// Lazy: building the client at module scope would crash server boot when the
// AI gateway env vars are absent (e.g. before AI_BASE_URL/AI_API_KEY are set
// on off-Kimi hosting). Kimi gateway vars take priority; AI_* are the generic
// OpenAI-compatible fallback.
function aiGw() {
  const baseURL = process.env.KIMI_AGENTGW_BASE_URL ?? process.env.AI_BASE_URL;
  const apiKey = process.env.KIMI_AGENTGW_API_KEY ?? process.env.AI_API_KEY;
  if (!baseURL || !apiKey) {
    throw new AiMisconfigured(
      "AI assistant not configured: set KIMI_AGENTGW_* or AI_BASE_URL/AI_API_KEY.",
    );
  }
  return createOpenAICompatible({
    name: "kimi-gw",
    baseURL,
    apiKey,
    includeUsage: true,
    supportsStructuredOutputs: true,
  });
}

const SYSTEM_PROMPT = `You are the intelligence and explanation layer for BetMetricAi, a sports betting analytics platform.

Rules you must follow at all times:
- Use only the verified structured information supplied by the backend (provided below as PLATFORM DATA) and the conversation history.
- Never invent odds, statistics, injuries, probabilities, weather information, betting splits, sportsbook information, or performance records.
- Do not modify quantitative model outputs. Explain the supplied model results clearly.
- Always distinguish between PREDICTION (how likely something is) and BETTING VALUE (whether the current sportsbook price makes it a good bet).
- Never describe any outcome as guaranteed, certain, risk-free, or a "lock". Sports betting involves substantial risk.
- If information is missing or stale, clearly state that it is unavailable or insufficient instead of guessing.
- When the platform data does not contain what the user asked for, say so and point them to what IS available.
- Keep answers concise and concrete. Use the platform's vocabulary: AI Edge Score (0-100), statuses STRONG_BET / BET / WATCH / HOLD / PASS, expected value (EV), probability edge, closing line value (CLV).
- The current platform runs in DEMO DATA mode: all games, odds and lines are simulated demonstration data flowing through the real quantitative pipeline. Mention this when relevant.
- Include brief responsible-gambling context when recommending anything (e.g. bet sizing discipline, only wager what you can afford to lose).`;

/** Verified snapshot of current platform state for the model to explain. */
async function buildPlatformSnapshot(): Promise<string> {
  const db = getDb();
  const versions = await db
    .select()
    .from(aiPickVersions)
    .orderBy(desc(aiPickVersions.version));
  const latestByPick = new Map<number, (typeof versions)[number]>();
  for (const v of versions) {
    if (!latestByPick.has(v.pickId)) latestByPick.set(v.pickId, v);
  }
  const picks = await db.select().from(aiPicks);
  const evRows = await db
    .select({ event: events, home: homeTeams, away: awayTeams })
    .from(events)
    .innerJoin(homeTeams, eq(events.homeTeamId, homeTeams.id))
    .innerJoin(awayTeams, eq(events.awayTeamId, awayTeams.id));
  const evMap = new Map(evRows.map((r) => [r.event.id, r]));
  const books = await db.select().from(sportsbooks);
  const bookMap = new Map(books.map((b) => [b.id, b.name]));

  const pickRows = picks
    .map((p) => {
      const v = latestByPick.get(p.id);
      if (!v) return null;
      const ctx = evMap.get(p.eventId);
      if (!ctx) return null;
      const label =
        p.market === "moneyline"
          ? `${p.selection === "home" ? ctx.home.name : ctx.away.name} ML`
          : p.market === "spread"
            ? `${p.selection === "home" ? ctx.home.name : ctx.away.name} ${fmtLine(v.line === null ? null : parseFloat(v.line))}`
            : `${p.selection === "over" ? "Over" : "Under"} ${v.line}`;
      return {
        event: `${ctx.away.name} @ ${ctx.home.name}`,
        eventStatus: ctx.event.status,
        score:
          ctx.event.status !== "scheduled"
            ? `${ctx.event.awayScore}-${ctx.event.homeScore} ${ctx.event.period ?? ""} ${ctx.event.clock ?? ""}`.trim()
            : undefined,
        market: p.market,
        selection: label,
        bestSportsbook: bookMap.get(v.sportsbookId),
        odds: fmtOdds(v.odds),
        modelProbability: parseFloat(v.modelProb),
        impliedProbability: parseFloat(v.impliedProb),
        probabilityEdge: parseFloat(v.probEdge),
        expectedValuePerUnit: parseFloat(v.ev),
        aiEdgeScore: v.edgeScore,
        status: v.status,
        betUpTo: v.betUpTo,
        lastUpdated: v.createdAt,
        lastChangeReason: v.changeReason ?? undefined,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b!.aiEdgeScore ?? 0) - (a!.aiEdgeScore ?? 0));

  return JSON.stringify(
    {
      dataMode: "DEMO (simulated data through the real quantitative pipeline)",
      sport: "NFL",
      asOf: new Date().toISOString(),
      currentPicks: pickRows,
      liveEvents: evRows
        .filter((r) => r.event.status === "live")
        .map((r) => ({
          event: `${r.away.name} @ ${r.home.name}`,
          score: `${r.event.awayScore}-${r.event.homeScore}`,
          period: r.event.period,
          clock: r.event.clock,
        })),
    },
    null,
    1,
  );
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function handleAssistantChat(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };
    const messages = (body.messages ?? []).slice(-12);
    if (messages.length === 0) {
      return Response.json({ error: "No messages supplied" }, { status: 400 });
    }

    const snapshot = await buildPlatformSnapshot();
    const { defaultModelId } = await listModels();

    const result = streamText({
      model: aiGw()(defaultModelId),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "system",
          content: `VERIFIED PLATFORM DATA (source of truth — explain this, never contradict it):\n${snapshot}`,
        },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      providerOptions: {
        "kimi-gw": { max_completion_tokens: 1200 },
      },
    });

    return result.toTextStreamResponse({
      headers: { "X-Data-Mode": "DEMO" },
    });
  } catch (err) {
    const classified = classifyAiError(err);
    const status =
      classified.name === "AiTransient"
        ? 503
        : classified.name === "AiMisconfigured"
          ? 500
          : 503;
    return Response.json(
      { error: classified.message, kind: classified.name },
      { status },
    );
  }
}

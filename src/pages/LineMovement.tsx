import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { EmptyState, SectionHead } from "@/components/bits";
import { Seo } from "@/components/Seo";
import { useSportFilter } from "@/providers/sport-filter";
import { fmtLine, fmtOdds, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function LineChart({
  points,
  isMoneyline,
}: {
  points: Array<{ at: Date | string; line: number | null; odds: number }>;
  isMoneyline: boolean;
}) {
  const W = 860;
  const H = 260;
  const PAD = { l: 44, r: 14, t: 16, b: 28 };
  const values = points.map((p) => (isMoneyline ? p.odds : (p.line ?? 0)));
  if (values.length < 2) return <EmptyState title="Not enough history yet" hint="Price history builds automatically as the market moves — check back closer to game time." />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => PAD.l + (i / (values.length - 1)) * (W - PAD.l - PAD.r);
  const y = (val: number) => PAD.t + (1 - (val - min) / span) * (H - PAD.t - PAD.b);
  const d = values.map((val, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(" ");
  const ticks = 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* grid */}
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const val = min + (span * i) / ticks;
        const yy = y(val);
        return (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} stroke="hsl(var(--border))" strokeWidth={0.5} />
            <text x={PAD.l - 6} y={yy + 3} textAnchor="end" fontSize={9} fill="hsl(var(--muted-foreground))" fontFamily="JetBrains Mono">
              {isMoneyline ? fmtOdds(Math.round(val)) : fmtLine(Math.round(val * 2) / 2)}
            </text>
          </g>
        );
      })}
      {/* zero line for spreads */}
      {!isMoneyline && min < 0 && max > 0 && (
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="hsl(var(--muted-foreground))" strokeWidth={0.75} strokeDasharray="4 4" />
      )}
      <path d={`${d} L${x(values.length - 1)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`} fill="rgba(34,211,238,0.07)" />
      <path d={d} fill="none" stroke="#22d3ee" strokeWidth={1.75} />
      {values.map((val, i) => (
        <circle key={i} cx={x(i)} cy={y(val)} r={i === values.length - 1 ? 3.5 : 2} fill={i === values.length - 1 ? "#22d3ee" : "hsl(var(--card))"} stroke="#22d3ee" strokeWidth={1.25} />
      ))}
      {/* time labels — evenly spaced, never overlapping the last label */}
      {points.map((p, i) => {
        const step = Math.max(1, Math.round((points.length - 1) / 5));
        const show = i === points.length - 1 || (i % step === 0 && points.length - 1 - i >= Math.max(1, Math.floor(step / 2)));
        return show ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={8.5} fill="hsl(var(--muted-foreground))" fontFamily="JetBrains Mono">
            {fmtTime(p.at)}
          </text>
        ) : null;
      })}
    </svg>
  );
}

export default function LineMovement() {
  const { data: allEvents } = trpc.odds.events.useQuery();
  const { sport } = useSportFilter();
  const events = useMemo(
    () => (allEvents ?? []).filter((e) => !sport || e.sport.code === sport),
    [allEvents, sport],
  );
  const [eventId, setEventId] = useState<number | null>(null);
  const [market, setMarket] = useState<"spread" | "total" | "moneyline">("spread");
  const [selection, setSelection] = useState("home");

  const evId = eventId ?? events?.[0]?.event.id ?? null;
  const currentSport = events.find((e) => e.event.id === evId)?.sport.code ?? null;
  const { data: history } = trpc.odds.lineHistory.useQuery(
    { eventId: evId!, market, selection },
    { enabled: evId !== null, refetchInterval: 20000 },
  );

  const selections = useMemo(() => {
    if (market === "moneyline")
      return currentSport === "SOCCER" ? ["home", "draw", "away"] : ["home", "away"];
    if (market === "spread") return ["home", "away"];
    return ["over", "under"];
  }, [market, currentSport]);

  const points = history ?? [];
  const first = points[0];
  const last = points[points.length - 1];
  const move =
    first && last
      ? market === "moneyline"
        ? last.odds - first.odds
        : (last.line ?? 0) - (first.line ?? 0)
      : 0;

  return (
    <div className="flex flex-col gap-6">
    <Seo title="Line Movement Tracker — Odds History" description="Track how sportsbook odds and lines move from open to game time across NFL, NBA, MLB, NHL and more — full price history on every market." path="/line-movement" />

      <SectionHead
        title="Line movement"
        sub="Watch how odds and lines move from open to game time. Sharp movement often signals where the smart money went — and every historical price is stored, never rewritten."
      />

      <div className="flex flex-wrap gap-3">
        <select
          value={evId ?? ""}
          onChange={(e) => setEventId(Number(e.target.value))}
          className="min-h-[44px] max-w-full rounded-sm border border-border bg-card px-3 font-mono2 text-xs text-foreground"
        >
          {(events ?? []).map(({ event, home, away, sport: sp }) => (
            <option key={event.id} value={event.id}>
              [{sp.code}] {away.abbr} @ {home.abbr} — {fmtTime(event.startTime)}
            </option>
          ))}
        </select>
        <div className="flex gap-1.5">
          {(["spread", "total", "moneyline"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMarket(m);
                setSelection(m === "total" ? "over" : "home");
              }}
              className={cn(
                "min-h-[44px] rounded-sm border px-3 font-mono2 text-[10px] font-bold tracking-[0.12em]",
                market === m ? "border-primary bg-live-dim text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {selections.map((s) => (
            <button
              key={s}
              onClick={() => setSelection(s)}
              className={cn(
                "min-h-[44px] rounded-sm border px-3 font-mono2 text-[10px] font-bold tracking-[0.12em]",
                selection === s ? "border-primary bg-live-dim text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* open / current / move */}
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2">
        {[
          ["OPEN", first ? (market === "moneyline" ? fmtOdds(first.odds) : fmtLine(first.line)) : "—"],
          ["CURRENT", last ? (market === "moneyline" ? fmtOdds(last.odds) : fmtLine(last.line)) : "—"],
          [
            "MOVE",
            points.length > 1
              ? market === "moneyline"
                ? `${move > 0 ? "+" : ""}${Math.round(move)}`
                : `${move > 0 ? "+" : ""}${move.toFixed(1)}`
              : "—",
          ],
        ].map(([k, val], i) => (
          <div key={k} className="bg-card px-4 py-3 text-center">
            <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
            <p className={cn("mt-1 text-lg font-bold tabular-nums", i === 2 && "text-primary")}>{val}</p>
          </div>
        ))}
      </div>

      <div className="panel rounded-sm p-4">
        <LineChart points={points} isMoneyline={market === "moneyline"} />
      </div>
    </div>
  );
}

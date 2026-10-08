import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSportFilter } from "@/providers/sport-filter";
import { EmptyState, SectionHead } from "@/components/bits";
import { Seo } from "@/components/Seo";
import { ProTeaser } from "@/components/ProTeaser";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { fmtOdds, num, pct, signedPct, timeAgo } from "@/lib/format";

export default function Props() {
  const { data } = trpc.props.list.useQuery(undefined, { refetchInterval: 20000 });
  const { isVisible } = useSportFilter();
  const { user } = useAuth();
  const isPro = user?.plan === "pro" || user?.role === "admin";
  const [market, setMarket] = useState("ALL");

  const visible = useMemo(
    () => (data ?? []).filter((r) => isVisible(r.sportCode)),
    [data, isVisible],
  );
  const markets = useMemo(
    () => ["ALL", ...new Set(visible.map((r) => r.prop.market))],
    [visible],
  );
  const rows = visible.filter((r) => market === "ALL" || r.prop.market === market);

  return (
    <div className="flex flex-col gap-6">
    <Seo title="AI Player Props — Projections vs Sportsbook Lines" description="AI player prop analysis: points, yards, strikeouts and more — our projections compared against sportsbook lines with edge scores and expected value." path="/props" />

      <SectionHead
        title="Player props"
        sub="Individual player stat lines — points, yards, strikeouts and more — compared against our AI's projection for that player. Only markets with enough reliable player data are shown."
      />

      <div className="flex flex-wrap gap-1.5">
        {markets.map((m) => (
          <button
            key={m}
            onClick={() => setMarket(m)}
            className={cn(
              "min-h-[44px] rounded-sm border px-3 font-mono2 text-[10px] font-bold tracking-[0.12em]",
              market === m
                ? "border-primary bg-live-dim text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      {isPro ? (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ prop, home, away, book, sportCode }) => {
          const probOver = num(prop.probOver);
          const lean = probOver >= 0.5 ? "OVER" : "UNDER";
          const leanProb = Math.max(probOver, 1 - probOver);
          const ev = num(prop.evOver);
          const strong = prop.edgeScore >= 70;
          return (
            <div key={prop.id} className="panel flex flex-col gap-3 rounded-sm p-4 transition-colors hover:border-primary/30">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{prop.player}</p>
                  <p className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {sportCode} · {prop.teamAbbr} · {prop.market} · {away.abbr}@{home.abbr}
                  </p>
                </div>
                <span className={cn("font-mono2 text-lg font-extrabold tabular-nums", strong ? "text-pos" : "text-muted-foreground")}>
                  {prop.edgeScore}
                </span>
              </div>

              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="label-caps" style={{ fontSize: 8 }}>Line / projection</p>
                  <p className="font-mono2 text-sm tabular-nums">
                    <b>{String(prop.line)}</b>
                    <span className="text-muted-foreground"> / proj </span>
                    <b className="text-primary">{String(prop.projValue)}</b>
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-sm px-2 py-1 font-mono2 text-[10px] font-bold tracking-[0.14em]",
                    lean === "OVER" ? "bg-pos-dim text-pos" : "bg-live-dim text-live",
                  )}
                >
                  {lean} {pct(leanProb, 0)}
                </span>
              </div>

              {/* prob bar */}
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("absolute inset-y-0 left-0", lean === "OVER" ? "bg-pos" : "bg-live")}
                  style={{ width: `${leanProb * 100}%`, background: lean === "OVER" ? "#34d399" : "#22d3ee" }}
                />
              </div>

              <div className="flex items-center justify-between border-t border-border pt-2.5 font-mono2 text-[10px] text-muted-foreground">
                <span>
                  {book.name} O{fmtOdds(prop.overOdds)} / U{fmtOdds(prop.underOdds)}
                </span>
                <span className={ev >= 0 ? "text-pos" : "text-neg"}>EV(over) {signedPct(ev)}</span>
                <span>{timeAgo(prop.updatedAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
      ) : (
        <ProTeaser
          title="Player props are part of Pro"
          sub="Every prop card carries our AI's projection for the player, the over/under lean, the sportsbook's prices and the expected value. Upgrade to see them unblurred."
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ prop, home, away, book, sportCode }) => {
              const probOver = num(prop.probOver);
              const lean = probOver >= 0.5 ? "OVER" : "UNDER";
              const leanProb = Math.max(probOver, 1 - probOver);
              return (
                <div key={prop.id} className="panel flex flex-col gap-3 rounded-sm p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">{prop.player}</p>
                      <p className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {sportCode} · {prop.teamAbbr} · {prop.market} · {away.abbr}@{home.abbr}
                      </p>
                    </div>
                    <span className="font-mono2 text-lg font-extrabold tabular-nums text-muted-foreground">
                      {prop.edgeScore}
                    </span>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="label-caps" style={{ fontSize: 8 }}>Line / projection</p>
                      <p className="font-mono2 text-sm tabular-nums">
                        <b>{String(prop.line)}</b>
                        <span className="text-muted-foreground"> / proj </span>
                        <b className="text-primary">{String(prop.projValue)}</b>
                      </p>
                    </div>
                    <span className="rounded-sm bg-pos-dim px-2 py-1 font-mono2 text-[10px] font-bold tracking-[0.14em] text-pos">
                      {lean} {pct(leanProb, 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2.5 font-mono2 text-[10px] text-muted-foreground">
                    <span>{book.name} O{fmtOdds(prop.overOdds)} / U{fmtOdds(prop.underOdds)}</span>
                    <span>{timeAgo(prop.updatedAt)}</span>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="panel col-span-full rounded-sm p-10 text-center font-mono2 text-xs text-muted-foreground">
                Loading player projections…
              </div>
            )}
          </div>
        </ProTeaser>
      )}
      {isPro && rows.length === 0 && (
        <EmptyState title="No props in this market" hint="We only publish a prop when there's enough reliable player data behind the projection — nothing is guessed." />
      )}
    </div>
  );
}

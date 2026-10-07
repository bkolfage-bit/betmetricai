import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useFeed } from "@/hooks/useFeed";
import { EdgeGauge, Freshness, StatusBadge } from "@/components/bits";
import { fmtLine, fmtOdds, fmtTime, num, pct, signedPct, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronDown, TrendingUp } from "lucide-react";
import type { PickListRow } from "@contracts/router-types";

type PickRow = PickListRow;

export function selectionLabel(p: PickRow): string {
  const v = p.version;
  if (p.pick.market === "moneyline")
    return `${p.pick.selection === "home" ? p.home.name : p.away.name} ML`;
  if (p.pick.market === "spread")
    return `${p.pick.selection === "home" ? p.home.name : p.away.name} ${fmtLine(v?.line)}`;
  return `${p.pick.selection === "over" ? "Over" : "Under"} ${v?.line ?? ""}`;
}

function VersionTimeline({ pickId }: { pickId: number }) {
  const { data } = trpc.picks.detail.useQuery({ pickId });
  if (!data) return <div className="py-4 font-mono2 text-[10px] text-muted-foreground">LOADING TIMELINE…</div>;
  const bestBookId = data.versions[0]?.sportsbookId;
  return (
    <div className="grid gap-6 py-4 lg:grid-cols-2">
      {/* version timeline */}
      <div>
        <p className="label-caps mb-3">Pick timeline — history is never overwritten</p>
        <div className="relative ml-1.5 border-l border-border pl-4">
          {data.versions.map((v) => (
            <div key={v.id} className="relative mb-4 last:mb-0">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono2 text-[10px] text-muted-foreground">V{v.version}</span>
                <StatusBadge status={v.status} />
                <span className="font-mono2 text-xs font-bold tabular-nums">
                  {v.line !== null ? fmtLine(v.line) : ""} {fmtOdds(v.odds)}
                </span>
                <span className="font-mono2 text-[10px] text-muted-foreground">{timeAgo(v.createdAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono2 text-[10px] text-muted-foreground">
                <span>EDGE <b className="text-foreground">{v.edgeScore}</b></span>
                <span>MODEL <b className="text-foreground">{pct(v.modelProb)}</b></span>
                <span>IMPLIED <b className="text-foreground">{pct(v.impliedProb)}</b></span>
                <span>EV <b className={num(v.ev) >= 0 ? "text-pos" : "text-neg"}>{signedPct(v.ev)}</b></span>
              </div>
              {v.changeReason && (
                <p className="mt-1 max-w-md text-[11px] leading-relaxed text-muted-foreground">
                  {v.changeReason}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
      {/* sportsbook comparison */}
      <div>
        <p className="label-caps mb-3">Sportsbook comparison — best current price</p>
        <div className="panel divide-y divide-border">
          {data.offers
            .slice()
            .sort((a, b) => (a.book?.priority ?? 9) - (b.book?.priority ?? 9))
            .map((o) => (
              <div
                key={o.id}
                className={cn(
                  "flex items-center justify-between px-3 py-2 font-mono2 text-xs",
                  o.sportsbookId === bestBookId && "bg-live-dim",
                )}
              >
                <span className="flex items-center gap-2">
                  {o.sportsbookId === bestBookId && <span className="led led-live" />}
                  {o.book?.name ?? `Book #${o.sportsbookId}`}
                </span>
                <span className="tabular-nums">
                  {o.line !== null && <span className="mr-2 text-muted-foreground">{fmtLine(o.line)}</span>}
                  <b className={o.sportsbookId === bestBookId ? "text-primary" : ""}>{fmtOdds(o.odds)}</b>
                </span>
              </div>
            ))}
        </div>
        {data.prediction && (
          <div className="mt-4">
            <p className="label-caps mb-2">Quant model output ({data.prediction.modelVersion})</p>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2 text-xs sm:grid-cols-4">
              {[
                ["PROJ SCORE", `${num(data.prediction.projAwayScore)} – ${num(data.prediction.projHomeScore)}`],
                ["PROJ SPREAD", fmtLine(data.prediction.projSpread)],
                ["PROJ TOTAL", `${data.prediction.projTotal}`],
                ["CONFIDENCE", pct(data.prediction.confidence, 0)],
              ].map(([k, val]) => (
                <div key={k} className="bg-card px-3 py-2">
                  <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
                  <p className="mt-0.5 font-bold tabular-nums">{val}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PickCard({ row, defaultOpen = false }: { row: PickRow; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const feed = useFeed();
  const v = row.version;
  if (!v) return null;
  const evNum = num(v.ev);
  const live = row.event.status === "live";

  return (
    <div className="panel overflow-hidden rounded-sm transition-colors hover:border-primary/30">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full flex-col gap-3 px-4 py-3 text-left min-h-[44px]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {live ? (
              <span className="flex items-center gap-1.5 text-live">
                <span className="led led-live" /> LIVE {row.event.period} {row.event.clock} · {row.event.awayScore}–{row.event.homeScore}
              </span>
            ) : (
              <span>{fmtTime(row.event.startTime)}</span>
            )}
            <span className="text-muted-foreground/50">/</span>
            <span>{row.pick.market}</span>
            {row.versionCount > 1 && (
              <span className="flex items-center gap-1 text-primary">
                <TrendingUp className="h-3 w-3" /> {row.versionCount} versions
              </span>
            )}
          </div>
          <Freshness
            at={feed?.lastTick ?? null}
            live={live}
            text={`pick v${v.version} · ${timeAgo(v.createdAt)}`}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {row.away.abbr} @ {row.home.abbr}
            </p>
            <p className="mt-0.5 truncate text-base font-bold tracking-tight sm:text-lg">
              {selectionLabel(row)}
            </p>
            <p className="mt-0.5 font-mono2 text-[11px] text-muted-foreground">
              Best price: <span className="text-primary">{row.book?.name} {fmtOdds(v.odds)}</span>
              {v.betUpTo !== null && (
                <span className="ml-3">
                  Bet up to:{" "}
                  <span className="text-foreground">
                    {row.pick.market === "moneyline"
                      ? fmtOdds(num(v.betUpTo))
                      : row.pick.market === "total"
                        ? String(v.betUpTo)
                        : fmtLine(v.betUpTo)}
                  </span>
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            <div className="hidden text-right sm:block">
              <p className="label-caps" style={{ fontSize: 8 }}>Model vs implied</p>
              <p className="font-mono2 text-xs tabular-nums">
                <b>{pct(v.modelProb)}</b>
                <span className="text-muted-foreground"> / {pct(v.impliedProb)}</span>
              </p>
              <p className={cn("font-mono2 text-[10px] tabular-nums", evNum >= 0 ? "text-pos" : "text-neg")}>
                EV {signedPct(v.ev)} · edge {signedPct(v.probEdge)}
              </p>
            </div>
            <EdgeGauge score={v.edgeScore} />
            <StatusBadge status={v.status} />
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
        </div>
      </button>
      {open && (
        <div className="hairline-t animate-fade-up px-4">
          <VersionTimeline pickId={row.pick.id} />
        </div>
      )}
    </div>
  );
}

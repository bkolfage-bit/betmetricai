import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EmptyState, SectionHead } from "@/components/bits";
import { useSportFilter } from "@/providers/sport-filter";
import { fmtTime, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronDown, ExternalLink, ShieldCheck } from "lucide-react";

type BoardRow = NonNullable<
  ReturnType<typeof useBoard>["data"]
>["rows"][number];

function useBoard(sport: string | null) {
  return trpc.pmarkets.board.useQuery(sport ? { sport } : undefined, {
    refetchInterval: 60_000,
  });
}

const VENUE_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  POLYMARKET: { label: "POLYMARKET", cls: "text-violet-300", dot: "#a78bfa" },
  KALSHI: { label: "KALSHI", cls: "text-emerald-300", dot: "#34d399" },
};

function fmtVol(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function ProbCell({
  side,
  align = "left",
}: {
  side: { mid: number | null; bid: number | null; ask: number | null } | null | undefined;
  align?: "left" | "right";
}) {
  if (!side || side.mid === null) return <span className="text-muted-foreground/50">—</span>;
  return (
    <div className={cn("flex flex-col", align === "right" && "items-end")}>
      <span className="font-mono2 text-sm text-foreground">{pct(side.mid)}</span>
      {side.bid !== null && side.ask !== null && (
        <span className="font-mono2 text-[9px] text-muted-foreground">
          {pct(side.bid, 0)} / {pct(side.ask, 0)}
        </span>
      )}
    </div>
  );
}

function ModelCell({ p }: { p: number | null | undefined }) {
  if (p === null || p === undefined) return <span className="text-muted-foreground/50">—</span>;
  return <span className="font-mono2 text-sm font-semibold text-cyan-300">{pct(p)}</span>;
}

/** Multi-venue probability trend (home side) with model/book references. */
function TrendChart({ eventId, model, book }: { eventId: number; model: number | null; book: number | null }) {
  const { data } = trpc.pmarkets.history.useQuery({ eventId });
  const W = 860;
  const H = 240;
  const PAD = { l: 44, r: 14, t: 14, b: 26 };
  const series = (data?.series ?? []).filter((s) => s.points.length >= 2);
  if (data && series.length === 0) {
    return (
      <EmptyState
        title="History accumulating"
        hint="Price history builds automatically as traders buy and sell — the trend chart appears once enough trades have been recorded."
      />
    );
  }
  if (!data) return <div className="h-40 animate-pulse rounded-sm bg-muted/20" />;

  const allT = series.flatMap((s) => s.points.map((p) => new Date(p.t).getTime()));
  const allP = series.flatMap((s) => s.points.map((p) => p.p));
  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const pMin = Math.max(0, Math.min(...allP, model ?? 1, book ?? 1) - 0.03);
  const pMax = Math.min(1, Math.max(...allP, model ?? 0, book ?? 0) + 0.03);
  const x = (t: number) => PAD.l + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - (p - pMin) / Math.max(0.01, pMax - pMin)) * (H - PAD.t - PAD.b);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {Array.from({ length: 5 }, (_, i) => {
          const p = pMin + ((pMax - pMin) * i) / 4;
          return (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} stroke="hsl(var(--border))" strokeWidth={0.5} />
              <text x={PAD.l - 6} y={y(p) + 3} textAnchor="end" fontSize={9} fill="hsl(var(--muted-foreground))" fontFamily="JetBrains Mono">
                {pct(p, 0)}
              </text>
            </g>
          );
        })}
        {model !== null && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(model)} y2={y(model)} stroke="#22d3ee" strokeWidth={1} strokeDasharray="5 4" />
        )}
        {book !== null && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(book)} y2={y(book)} stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="2 4" />
        )}
        {series.map((s, si) => {
          const color = VENUE_STYLE[s.venue]?.dot ?? "#a78bfa";
          const d = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"}${x(new Date(p.t).getTime()).toFixed(1)},${y(p.p).toFixed(1)}`)
            .join(" ");
          return <path key={si} d={d} fill="none" stroke={color} strokeWidth={1.75} />;
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
          <text key={i} x={x(tMin + f * (tMax - tMin))} y={H - 8} textAnchor="middle" fontSize={8.5} fill="hsl(var(--muted-foreground))" fontFamily="JetBrains Mono">
            {fmtTime(new Date(tMin + f * (tMax - tMin)))}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 font-mono2 text-[10px] text-muted-foreground">
        {series.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4" style={{ background: VENUE_STYLE[s.venue]?.dot }} />
            {VENUE_STYLE[s.venue]?.label} HOME PROB
          </span>
        ))}
        {model !== null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4 border-t border-dashed border-cyan-400" />
            AI MODEL (INDEPENDENT)
          </span>
        )}
        {book !== null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4 border-t border-dotted border-muted-foreground" />
            SPORTSBOOKS (FAIR ODDS)
          </span>
        )}
      </div>
    </div>
  );
}

function Row({ row }: { row: BoardRow }) {
  const [open, setOpen] = useState(false);
  const best = row.opportunities[0] ?? null;
  const poly = row.venues.POLYMARKET;
  const kal = row.venues.KALSHI;
  const div = best ? best.modelProb - best.venueMid : 0;

  return (
    <div className="panel rounded-sm">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-3 text-left">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-5 lg:gap-y-2">
          <div className="min-w-[170px]">
            <div className="flex items-center gap-2">
              <span className="rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 font-mono2 text-[9px] text-muted-foreground">{row.sportCode}</span>
              <span className="font-mono2 text-[10px] text-muted-foreground">{fmtTime(row.startTime)}</span>
              {row.status === "live" && <span className="rounded-sm bg-red-500/15 px-1.5 py-0.5 font-mono2 text-[9px] text-red-400">LIVE</span>}
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">{row.homeTeam}</div>
            <div className="text-xs text-muted-foreground">vs {row.awayTeam}</div>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <div className="font-mono2 text-[9px] tracking-wider text-cyan-400/80">AI MODEL</div>
              <div className="flex gap-3">
                <ModelCell p={row.model?.home} />
                <ModelCell p={row.model?.away} />
              </div>
            </div>
            <div>
              <div className="font-mono2 text-[9px] tracking-wider text-muted-foreground">SPORTSBOOKS</div>
              <div className="flex gap-3">
                {row.book ? (
                  <>
                    <span className="font-mono2 text-sm text-foreground/90">{pct(row.book.home)}</span>
                    <span className="font-mono2 text-sm text-muted-foreground">{pct(row.book.away)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </div>
            </div>
            <div>
              <div className={cn("font-mono2 text-[9px] tracking-wider", VENUE_STYLE.POLYMARKET.cls)}>POLYMARKET</div>
              <div className="flex gap-3">
                <ProbCell side={poly?.home} />
                <ProbCell side={poly?.away} />
              </div>
            </div>
            <div>
              <div className={cn("font-mono2 text-[9px] tracking-wider", VENUE_STYLE.KALSHI.cls)}>KALSHI</div>
              <div className="flex gap-3">
                <ProbCell side={kal?.home} />
                <ProbCell side={kal?.away} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 lg:justify-start">
            {best && best.evRoi > 0 ? (
              <div className="text-left lg:text-right">
                <div className="font-mono2 text-[9px] tracking-wider text-muted-foreground">EST EV AFTER COSTS</div>
                <div className={cn("font-mono2 text-sm font-semibold", best.evRoi > 0.03 ? "text-emerald-400" : "text-foreground")}>
                  +{pct(best.evRoi)}
                </div>
                <div className="max-w-[150px] truncate font-mono2 text-[9px] text-muted-foreground">
                  {VENUE_STYLE[best.venue].label} · {best.sideLabel}
                </div>
              </div>
            ) : (
              <div className="text-left lg:text-right">
                <div className="font-mono2 text-[9px] tracking-wider text-muted-foreground">Δ AI vs MKT</div>
                <div className={cn("font-mono2 text-sm", Math.abs(div) >= 0.05 ? "text-amber-300" : "text-muted-foreground")}>
                  {best ? `${div >= 0 ? "+" : ""}${pct(div)}` : "—"}
                </div>
              </div>
            )}
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/60 px-4 py-4">
          <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
            <div>
              <div className="mb-2 font-mono2 text-[10px] tracking-wider text-muted-foreground">
                MARKET SENTIMENT — HOME WIN PROBABILITY
              </div>
              <TrendChart eventId={row.eventId} model={row.model?.home ?? null} book={row.book?.home ?? null} />
            </div>
            <div className="flex flex-col gap-3">
              <div className="font-mono2 text-[10px] tracking-wider text-muted-foreground">LIQUIDITY & SOURCES</div>
              {(["POLYMARKET", "KALSHI"] as const).map((v) => {
                const vb = row.venues[v];
                if (!vb) return null;
                return (
                  <div key={v} className="rounded-sm border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className={cn("font-mono2 text-[10px] font-semibold", VENUE_STYLE[v].cls)}>{VENUE_STYLE[v].label}</span>
                      {vb.url && (
                        <a href={vb.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono2 text-[9px] text-muted-foreground hover:text-foreground">
                          SOURCE <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 font-mono2 text-[10px] text-muted-foreground">
                      <div>VOL <span className="text-foreground">{fmtVol(vb.volume)}</span></div>
                      <div>24H <span className="text-foreground">{fmtVol(vb.volume24h)}</span></div>
                      <div>LIQ <span className="text-foreground">{fmtVol(vb.liquidity)}</span></div>
                    </div>
                  </div>
                );
              })}
              {row.opportunities.length > 0 && (
                <div className="rounded-sm border border-border/60 bg-muted/20 p-3">
                  <div className="font-mono2 text-[10px] tracking-wider text-muted-foreground">EV BREAKDOWN (ANALYTICAL)</div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {row.opportunities.slice(0, 3).map((o, i) => (
                      <div key={i} className="flex items-center justify-between font-mono2 text-[10px]">
                        <span className="truncate text-muted-foreground">
                          {VENUE_STYLE[o.venue].label} {o.sideLabel}
                        </span>
                        <span className={cn(o.evRoi > 0 ? "text-emerald-400" : "text-red-400")}>
                          {o.evRoi >= 0 ? "+" : ""}{pct(o.evRoi)}
                          <span className="text-muted-foreground/70"> (cost {pct(o.ask + o.estFee, 1)})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PredictionMarkets() {
  const { sport } = useSportFilter();
  const { data, isLoading } = useBoard(sport);
  const status = trpc.pmarkets.status.useQuery(undefined, { refetchInterval: 60_000 });

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Prediction market intelligence"
        sub="See what real money is saying: live prices from the Kalshi and Polymarket prediction markets — where traders bet actual dollars on outcomes — compared side-by-side with sportsbook odds and our AI's independent estimate. Analytics only: this platform never trades and never takes wagers."
      />

      {/* source attribution + venue health */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["POLYMARKET", "KALSHI"] as const).map((v) => {
          const s = v === "POLYMARKET" ? status.data?.polymarket : status.data?.kalshi;
          return (
            <div key={v} className="panel rounded-sm p-4">
              <div className="flex items-center justify-between">
                <span className={cn("font-mono2 text-[10px] font-semibold tracking-wider", VENUE_STYLE[v].cls)}>{VENUE_STYLE[v].label}</span>
                <span className={cn("h-1.5 w-1.5 rounded-full", s?.lastSyncOk ? "bg-emerald-400" : s ? "bg-red-400" : "bg-muted-foreground")} />
              </div>
              <div className="mt-2 font-mono2 text-[10px] text-muted-foreground">
                {s ? (
                  <>
                    {s.open} open · {s.matched} matched
                    <div className="mt-1 truncate">{s.lastSyncAt ? `sync ${fmtTime(s.lastSyncAt)}` : "awaiting first sync"}</div>
                  </>
                ) : (
                  "…"
                )}
              </div>
            </div>
          );
        })}
        <div className="panel rounded-sm p-4">
          <div className="font-mono2 text-[10px] font-semibold tracking-wider text-muted-foreground">SPORTSBOOK FEED</div>
          <div className="mt-2 font-mono2 text-[10px] text-muted-foreground">The Odds API · fair odds (margin removed)</div>
        </div>
        <div className="panel rounded-sm p-4">
          <div className="flex items-center gap-1.5 font-mono2 text-[10px] font-semibold tracking-wider text-cyan-400">
            <ShieldCheck className="h-3 w-3" /> AI MODELS
          </div>
          <div className="mt-2 font-mono2 text-[10px] text-muted-foreground">Independent — never trained on market prices</div>
        </div>
      </div>

      {data && data.unmatched > 0 && (
        <div className="rounded-sm border border-border/60 bg-muted/20 px-4 py-2 font-mono2 text-[10px] text-muted-foreground">
          {data.unmatched} further venue market(s) tracked without a sportsbook-feed counterpart — shown once matched to a game.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {isLoading && <div className="panel h-24 animate-pulse rounded-sm" />}
        {data && data.rows.length === 0 && (
          <EmptyState
            title="No matched prediction markets right now"
            hint="We check Kalshi and Polymarket every 10 minutes for sports markets and automatically match them to games on our odds feed. Matched markets appear here as soon as they're found."
          />
        )}
        {data?.rows.map((r) => <Row key={r.eventId} row={r} />)}
      </div>

      <div className="rounded-sm border border-border/60 bg-muted/10 p-4 font-mono2 text-[10px] leading-relaxed text-muted-foreground">
        INFORMATIONAL ANALYTICS ONLY. Prediction-market prices are public market data from Kalshi (api.elections.kalshi.com) and Polymarket
        (gamma-api.polymarket.com / clob.polymarket.com), converted into win probabilities so they can be compared side-by-side. EV figures are
        estimates after estimated transaction costs (each venue's fees and the gap between buy and sell prices) and describe price differences —
        they are not betting, trading, or investment advice. BetMetric AI does not execute trades or wagers and is not affiliated with Kalshi or Polymarket.
      </div>
    </div>
  );
}

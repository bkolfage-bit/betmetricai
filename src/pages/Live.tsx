import { trpc } from "@/providers/trpc";
import { useSportFilter } from "@/providers/sport-filter";
import { EmptyState, Freshness, SectionHead, StatusBadge } from "@/components/bits";
import { PickCard } from "@/components/PickCard";
import { fmtLine, fmtOdds, num, pct, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PickListRow } from "@contracts/router-types";

export default function Live() {
  const { data: events } = trpc.odds.events.useQuery(undefined, { refetchInterval: 10000 });
  const { data: picks } = trpc.picks.list.useQuery(undefined, { refetchInterval: 10000 });

  const { isVisible } = useSportFilter();
  const liveEvents = (events ?? []).filter(
    (e) => e.event.status === "live" && isVisible(e.sport.code),
  );
  const livePicks = (picks ?? []).filter(
    (p) => p.event.status === "live" && isVisible(p.sportCode),
  );

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Live betting intelligence"
        sub="When a game starts, the live model takes over: score, clock, possession context and live prices feed a rolling projection."
        right={<Freshness at={new Date()} live />}
      />

      {liveEvents.length === 0 && (
        <EmptyState
          title="No games live right now"
          hint="Scheduled games switch to the live model automatically at kickoff. The board below updates the moment they do."
        />
      )}

      {liveEvents.map(({ event, home, away }) => (
        <div key={event.id} className="panel overflow-hidden rounded-sm">
          {/* score bug */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/60 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 font-mono2 text-[10px] font-bold tracking-[0.16em] text-live">
                <span className="led led-live" /> LIVE
              </span>
              <span className="font-mono2 text-[10px] text-muted-foreground">
                {event.period} · {event.clock}
              </span>
            </div>
            <Freshness at={new Date()} live />
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-5 sm:px-8">
            <div className="text-right">
              <p className="font-mono2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{away.city}</p>
              <p className="text-lg font-extrabold sm:text-xl">{away.name}</p>
            </div>
            <div className="flex items-center gap-3 font-mono2 text-3xl font-extrabold tabular-nums sm:text-4xl">
              <span className={cn(num(event.awayScore) > num(event.homeScore) ? "text-primary" : "")}>{event.awayScore ?? 0}</span>
              <span className="text-muted-foreground/50 text-xl">–</span>
              <span className={cn(num(event.homeScore) > num(event.awayScore) ? "text-primary" : "")}>{event.homeScore ?? 0}</span>
            </div>
            <div>
              <p className="font-mono2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{home.city}</p>
              <p className="text-lg font-extrabold sm:text-xl">{home.name}</p>
            </div>
          </div>
          {(event.weather || event.injuries) && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-2 font-mono2 text-[10px] text-muted-foreground sm:px-8">
              {event.weather && <span>WX: {event.weather}</span>}
              {event.injuries && <span className="text-warn">INJ: {event.injuries}</span>}
            </div>
          )}
        </div>
      ))}

      {/* live model positions */}
      <section>
        <SectionHead title="Live model positions" sub="Live win probability, live spread/total projections and live expected value against the current in-game price." />
        <div className="flex flex-col gap-3">
          {livePicks.length === 0 && (
            <EmptyState title="No live positions" hint="Live +EV windows open when the in-game market price lags the live model." />
          )}
          {livePicks.map((row) => (
            <LivePickRow key={row.pick.id} row={row} />
          ))}
        </div>
      </section>
    </div>
  );
}

function LivePickRow({ row }: { row: PickListRow }) {
  const v = row.version!;
  const evNum = num(v.ev);
  return (
    <div className="panel flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-sm px-4 py-3">
      <div className="min-w-0">
        <p className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {row.away.abbr} @ {row.home.abbr} · live {row.pick.market}
        </p>
        <p className="mt-0.5 font-bold">
          {row.pick.market === "moneyline"
            ? `${row.pick.selection === "home" ? row.home.name : row.away.name} ML`
            : row.pick.market === "spread"
              ? `${row.pick.selection === "home" ? row.home.name : row.away.name} ${fmtLine(v.line)}`
              : `${row.pick.selection === "over" ? "Over" : "Under"} ${v.line}`}
          <span className="ml-2 font-mono2 text-xs text-primary">{fmtOdds(v.odds)}</span>
        </p>
        <p className="mt-0.5 font-mono2 text-[10px] text-muted-foreground">
          via {row.book?.name}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono2">
        <div>
          <p className="label-caps" style={{ fontSize: 8 }}>Live model</p>
          <p className="text-sm font-bold tabular-nums">{pct(v.modelProb)}</p>
        </div>
        <div>
          <p className="label-caps" style={{ fontSize: 8 }}>Implied</p>
          <p className="text-sm tabular-nums text-muted-foreground">{pct(v.impliedProb)}</p>
        </div>
        <div>
          <p className="label-caps" style={{ fontSize: 8 }}>Live EV</p>
          <p className={cn("text-sm font-bold tabular-nums", evNum >= 0 ? "text-pos" : "text-neg")}>{signedPct(v.ev)}</p>
        </div>
        <div>
          <p className="label-caps" style={{ fontSize: 8 }}>AI Edge</p>
          <p className="text-sm font-bold text-primary tabular-nums">{v.edgeScore}</p>
        </div>
        <StatusBadge status={v.status} />
      </div>
    </div>
  );
}

export { PickCard };

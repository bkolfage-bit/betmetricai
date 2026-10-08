import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Lock, Sparkles } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { EmptyState, SectionHead, StatusBadge } from "@/components/bits";
import { useSportFilter } from "@/providers/sport-filter";
import { cn } from "@/lib/utils";
import { fmtLine, fmtOdds, fmtTime, num, pct, signedPct, timeAgo } from "@/lib/format";

export default function PlusEV() {
  const { sport } = useSportFilter();
  const { data } = trpc.picks.list.useQuery(sport ? { sport } : undefined, { refetchInterval: 15000 });
  const [minEv, setMinEv] = useState(0);

  const rows = useMemo(() => {
    return (data?.picks ?? [])
      .filter((p) => p.version && num(p.version.ev) > minEv / 100)
      .sort((a, b) => num(b.version!.ev) - num(a.version!.ev));
  }, [data, minEv]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="+EV opportunities"
        sub="Positions where the model probability beats the no-vig implied probability at the best available price. Sorted by expected value per unit."
        right={
          <label className="flex items-center gap-2 font-mono2 text-[10px] text-muted-foreground">
            MIN EV
            <select
              value={minEv}
              onChange={(e) => setMinEv(Number(e.target.value))}
              className="min-h-[36px] rounded-sm border border-border bg-card px-2 font-mono2 text-xs text-foreground"
            >
              {[0, 2, 4, 6, 8].map((v) => (
                <option key={v} value={v}>{v}%</option>
              ))}
            </select>
          </label>
        }
      />

      <div className="panel overflow-x-auto rounded-sm">
        <table className="w-full min-w-[760px] border-collapse font-mono2 text-xs">
          <thead>
            <tr className="border-b border-border text-left">
              {["SPORT", "EVENT", "DATE", "SELECTION", "BOOK", "PRICE", "MODEL", "IMPLIED", "EDGE", "EV/UNIT", "AI EDGE", "STATUS", "UPDATED"].map((h) => (
                <th key={h} className="label-caps px-3 py-2.5 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const v = p.version!;
              return (
                <tr key={p.pick.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-secondary/50">
                  <td className="px-3 py-2.5 font-bold text-muted-foreground">{p.sportCode}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {p.away.abbr} @ {p.home.abbr}
                    {p.event.status === "live" && <span className="ml-2 text-live">●LIVE</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                    {fmtTime(p.event.startTime)}
                  </td>
                  <td className="px-3 py-2.5 font-bold whitespace-nowrap">
                    {p.pick.market === "moneyline"
                      ? `${p.pick.selection === "home" ? p.home.abbr : p.pick.selection === "draw" ? "Draw" : p.away.abbr} ML`
                      : p.pick.market === "spread"
                        ? `${p.pick.selection === "home" ? p.home.abbr : p.away.abbr} ${fmtLine(v.line)}`
                        : `${p.pick.selection === "over" ? "Over" : "Under"} ${v.line}`}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{p.book?.name}</td>
                  <td className="px-3 py-2.5 tabular-nums">{fmtOdds(v.odds)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold">{pct(v.modelProb)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{pct(v.impliedProb)}</td>
                  <td className={cn("px-3 py-2.5 tabular-nums", num(v.probEdge) >= 0 ? "text-pos" : "text-neg")}>{signedPct(v.probEdge)}</td>
                  <td className={cn("px-3 py-2.5 tabular-nums font-bold", num(v.ev) >= 0 ? "text-pos" : "text-neg")}>{signedPct(v.ev)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold text-primary">{v.edgeScore}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={v.status} /></td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{timeAgo(v.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-6">
            <EmptyState
              title="No +EV positions at this threshold"
              hint="The screen only lists prices the model beats. When the market moves, new windows open automatically."
            />
          </div>
        )}
      </div>

      <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
        * EV is expected value per 1 unit staked, computed from the model probability
        and the best available price after removing the vig. +EV does not mean the
        bet will win — it means the price is in your favor over the long run.
      </p>

      {(data?.lockedCount ?? 0) > 0 && (
        <Link
          to="/premium"
          className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-[#fbbf24]/40 bg-warn-dim px-5 py-4 transition-colors hover:border-[#fbbf24]/70"
        >
          <div className="flex items-center gap-3">
            <Lock className="h-4 w-4 text-warn" />
            <p className="text-xs text-muted-foreground">
              <span className="font-bold text-foreground">{data!.lockedCount} more +EV position{data!.lockedCount === 1 ? "" : "s"}</span>{" "}
              locked on the FREE plan — including every AI Edge above 90.
            </p>
          </div>
          <span className="flex items-center gap-1.5 font-mono2 text-[10px] font-bold tracking-[0.14em] text-warn">
            <Sparkles className="h-3.5 w-3.5" /> UNLOCK WITH PRO
          </span>
        </Link>
      )}
    </div>
  );
}

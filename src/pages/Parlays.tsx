import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSportFilter } from "@/providers/sport-filter";
import { SectionHead } from "@/components/bits";
import { fmtOdds, pct, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Layers, Sparkles } from "lucide-react";

export default function Parlays() {
  const [legs, setLegs] = useState(3);
  const [target, setTarget] = useState<string>("600");
  const [useTarget, setUseTarget] = useState(true);
  const [req, setReq] = useState<{ legs: number; targetOdds: number | null } | null>(null);

  const { sport } = useSportFilter();
  const { data, isFetching } = trpc.parlays.suggest.useQuery(
    { ...(req ?? { legs, targetOdds: null }), sports: sport ? [sport] : undefined },
    { enabled: req !== null },
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="AI parlay builder"
        sub="Parlays composed from the current highest-edge positions. Combined probability and EV are computed by the quantitative engine — the AI explains them."
      />

      {/* builder controls */}
      <div className="panel flex flex-wrap items-end gap-5 rounded-sm p-5">
        <div>
          <p className="label-caps mb-2">Legs</p>
          <div className="flex gap-1.5">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setLegs(n)}
                className={cn(
                  "min-h-[44px] min-w-[44px] rounded-sm border font-mono2 text-sm font-bold",
                  legs === n ? "border-primary bg-live-dim text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label-caps mb-2">Target payout</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseTarget(!useTarget)}
              className={cn(
                "min-h-[44px] rounded-sm border px-3 font-mono2 text-[10px] font-bold tracking-[0.12em]",
                useTarget ? "border-primary bg-live-dim text-primary" : "border-border text-muted-foreground",
              )}
            >
              {useTarget ? "TARGET ON" : "MAX EV"}
            </button>
            {useTarget && (
              <div className="flex items-center rounded-sm border border-border bg-card px-3">
                <span className="font-mono2 text-sm text-muted-foreground">+</span>
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
                  inputMode="numeric"
                  className="min-h-[44px] w-20 bg-transparent font-mono2 text-sm font-bold outline-none"
                  placeholder="600"
                />
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setReq({ legs, targetOdds: useTarget ? parseInt(target || "600", 10) : null })}
          className="flex min-h-[44px] items-center gap-2 rounded-sm bg-primary px-6 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground transition-transform hover:scale-[1.03] active:scale-95"
        >
          <Sparkles className="h-4 w-4" /> GENERATE PARLAY
        </button>
      </div>

      {isFetching && (
        <div className="panel animate-pulse rounded-sm p-8 text-center font-mono2 text-xs text-muted-foreground">
          SEARCHING COMBINATIONS…
        </div>
      )}

      {!isFetching && data && !data.parlay && (
        <div className="panel rounded-sm border-dashed p-6">
          <p className="font-mono2 text-xs text-muted-foreground">{data.reason}</p>
        </div>
      )}

      {!isFetching && data?.parlay && (
        <div className="panel animate-fade-up overflow-hidden rounded-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/60 px-5 py-3">
            <span className="label-caps flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-primary" /> {data.parlay.legs.length}-leg parlay
            </span>
            <span className="font-mono2 text-2xl font-extrabold text-pos tabular-nums">
              {fmtOdds(data.parlay.americanOdds)}
            </span>
          </div>
          <div className="divide-y divide-border">
            {data.parlay.legs.map((l, i) => (
              <div key={l.pickId} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono2 text-[10px] text-muted-foreground">LEG {i + 1}</span>
                  <span className="font-bold">{l.label}</span>
                  <span className="font-mono2 text-xs text-primary tabular-nums">{fmtOdds(l.odds)}</span>
                </div>
                <div className="flex gap-5 font-mono2 text-[10px] text-muted-foreground">
                  <span>MODEL <b className="text-foreground">{pct(l.modelProb)}</b></span>
                  <span>EV <b className="text-pos">{signedPct(l.ev)}</b></span>
                  <span>EDGE <b className="text-primary">{l.edgeScore}</b></span>
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-px border-t border-border bg-border font-mono2 text-xs sm:grid-cols-3">
            {[
              ["COMBINED MODEL PROB", pct(data.parlay.combinedProb), "text-foreground"],
              ["IMPLIED PROBABILITY", pct(data.parlay.impliedProb), "text-muted-foreground"],
              ["COMBINED EV / UNIT", signedPct(data.parlay.combinedEv), data.parlay.combinedEv >= 0 ? "text-pos" : "text-neg"],
            ].map(([k, val, cls]) => (
              <div key={k as string} className="bg-card px-5 py-3">
                <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
                <p className={cn("mt-0.5 text-sm font-bold tabular-nums", cls as string)}>{val}</p>
              </div>
            ))}
          </div>
          <p className="border-t border-border px-5 py-4 text-xs leading-relaxed text-muted-foreground">
            {data.explanation}
          </p>
        </div>
      )}

      {!data && !isFetching && (
        <div className="panel rounded-sm border-dashed p-10 text-center">
          <Layers className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 font-mono2 text-xs text-muted-foreground">
            CONFIGURE LEGS AND TARGET, THEN GENERATE. PARLAYS MULTIPLY VARIANCE — STAKE ACCORDINGLY.
          </p>
        </div>
      )}
    </div>
  );
}

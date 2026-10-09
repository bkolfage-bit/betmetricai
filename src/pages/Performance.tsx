import { trpc } from "@/providers/trpc";
import { SectionHead, Sparkline } from "@/components/bits";
import { Seo } from "@/components/Seo";
import { useSportFilter } from "@/providers/sport-filter";
import { fmtOdds, fmtTime, num, pct, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Performance() {
  const { sport } = useSportFilter();
  const { data } = trpc.performance.summary.useQuery(
    sport ? { sport } : undefined,
    // picks settle automatically as games go final — keep the audit trail fresh
    { refetchInterval: 60_000 },
  );
  if (!data) {
    return <div className="panel animate-pulse rounded-sm p-10 text-center font-mono2 text-xs text-muted-foreground">LOADING AUDIT TRAIL…</div>;
  }
  const o = data.overall;
  const curve = data.curve.filter((_, i) => i % 2 === 0).map((c) => c.units);

  return (
    <div className="flex flex-col gap-8">
    <Seo title="AI Performance — Full Transparency" description="Our complete audited track record: win rate, ROI, units, closing line value and every graded pick — wins and losses, never restated." path="/performance" />

      <SectionHead
        title="AI performance — full transparency"
        sub="Every graded pick is auditable. Losing picks are never hidden, records are never restated."
      />

      {/* headline stats */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2 sm:grid-cols-4 lg:grid-cols-8">
        {[
          ["PICKS", `${o.total}`],
          ["RECORD", `${o.wins}-${o.losses}-${o.pushes}`],
          ["WIN RATE", pct(o.winRate)],
          ["ROI", signedPct(o.roi)],
          ["UNITS", `${o.units >= 0 ? "+" : ""}${o.units.toFixed(1)}u`],
          ["AVG CLV (NO-VIG)", o.avgClvNoVig !== null ? `${o.avgClvNoVig >= 0 ? "+" : ""}${o.avgClvNoVig.toFixed(2)}%` : "—"],
          ["+CLV RATE", o.posClvNoVigPct !== null ? pct(o.posClvNoVigPct, 0) : pct(o.posClvPct, 0)],
          ["MAX DRAWDOWN", `${o.maxDrawdown.toFixed(1)}u`],
        ].map(([k, val], i) => (
          <div key={k} className="bg-card px-4 py-3.5">
            <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
            <p className={cn(
              "mt-1 text-base font-bold tabular-nums",
              [3, 4, 5].includes(i) && (parseFloat(String(val)) >= 0 ? "text-pos" : "text-neg"),
              i === 7 && "text-neg",
            )}>{val}</p>
          </div>
        ))}
      </div>

      {/* model vs market — the calibration scoreboard */}
      {o.modelBrier !== null && o.marketBrier !== null && (
        <section className="panel rounded-sm p-5">
          <p className="label-caps mb-1">Our AI vs the market — Brier score</p>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            Every graded pick is scored on how accurate its probability was (Brier score — lower is
            better, 0 is perfect, 0.25 is a coin flip). We publish our number next to the score the
            market's closing price achieved on the same picks. When our number is lower, the model
            is genuinely better informed than the market on the picks we publish.
          </p>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2">
            {[
              ["OUR AI", o.modelBrier.toFixed(4), o.modelBrier <= o.marketBrier ? "text-pos" : "text-neg"],
              ["THE MARKET (CLOSING PRICE)", o.marketBrier.toFixed(4), "text-muted-foreground"],
              ["PICKS SCORED", `${o.brierSample}`, "text-foreground"],
            ].map(([k, val, cls]) => (
              <div key={k as string} className="bg-card px-4 py-3.5">
                <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
                <p className={cn("mt-1 text-base font-bold tabular-nums", cls as string)}>{val}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* units curve */}
      <section className="panel rounded-sm p-5">
        <p className="label-caps mb-4">Cumulative units — last 90 days</p>
        <div className="overflow-x-auto">
          <Sparkline points={curve} width={900} height={180} color="#34d399" baseline={0} />
        </div>
      </section>

      {/* by sport */}
      <section className="panel overflow-x-auto rounded-sm">
        <p className="label-caps border-b border-border px-4 py-3">Performance by sport — every model, fully audited</p>
        <table className="w-full min-w-[720px] border-collapse font-mono2 text-xs">
          <thead>
            <tr className="border-b border-border text-left">
              {["SPORT", "PICKS", "WIN%", "ROI", "UNITS", "AVG CLV (NO-VIG)", "+CLV RATE"].map((h) => (
                <th key={h} className="label-caps px-4 py-2 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.sports.map((sp) => (
              <tr key={sp.sportCode} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5 font-bold">{sp.sportCode}</td>
                <td className="px-4 py-2.5 tabular-nums">{sp.total}</td>
                <td className="px-4 py-2.5 tabular-nums">{pct(sp.winRate, 0)}</td>
                <td className={cn("px-4 py-2.5 tabular-nums", sp.roi >= 0 ? "text-pos" : "text-neg")}>{signedPct(sp.roi)}</td>
                <td className={cn("px-4 py-2.5 tabular-nums", sp.units >= 0 ? "text-pos" : "text-neg")}>{sp.units.toFixed(1)}u</td>
                <td className={cn("px-4 py-2.5 tabular-nums", (sp.avgClvNoVig ?? sp.avgClv) >= 0 ? "text-pos" : "text-neg")}>
                  {sp.avgClvNoVig !== null ? `${sp.avgClvNoVig.toFixed(2)}%` : `${sp.avgClv.toFixed(2)}%*`}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{pct(sp.posClvNoVigPct ?? sp.posClvPct, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* by market */}
        <section className="panel overflow-hidden rounded-sm">
          <p className="label-caps border-b border-border px-4 py-3">Performance by market</p>
          <table className="w-full border-collapse font-mono2 text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                {["MARKET", "PICKS", "WIN%", "ROI", "UNITS", "AVG CLV"].map((h) => (
                  <th key={h} className="label-caps px-4 py-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.markets.map((m) => (
                <tr key={m.market} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-bold uppercase">{m.market}</td>
                  <td className="px-4 py-2.5 tabular-nums">{m.total}</td>
                  <td className="px-4 py-2.5 tabular-nums">{pct(m.winRate, 0)}</td>
                  <td className={cn("px-4 py-2.5 tabular-nums", m.roi >= 0 ? "text-pos" : "text-neg")}>{signedPct(m.roi)}</td>
                  <td className={cn("px-4 py-2.5 tabular-nums", m.units >= 0 ? "text-pos" : "text-neg")}>{m.units.toFixed(1)}u</td>
                  <td className={cn("px-4 py-2.5 tabular-nums", m.avgClv >= 0 ? "text-pos" : "text-neg")}>{m.avgClv.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* by month */}
        <section className="panel overflow-hidden rounded-sm">
          <p className="label-caps border-b border-border px-4 py-3">Performance by month</p>
          <table className="w-full border-collapse font-mono2 text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                {["MONTH", "PICKS", "WIN%", "ROI", "UNITS"].map((h) => (
                  <th key={h} className="label-caps px-4 py-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-bold">{m.month}</td>
                  <td className="px-4 py-2.5 tabular-nums">{m.total}</td>
                  <td className="px-4 py-2.5 tabular-nums">{pct(m.winRate, 0)}</td>
                  <td className={cn("px-4 py-2.5 tabular-nums", m.roi >= 0 ? "text-pos" : "text-neg")}>{signedPct(m.roi)}</td>
                  <td className={cn("px-4 py-2.5 tabular-nums", m.units >= 0 ? "text-pos" : "text-neg")}>{m.units.toFixed(1)}u</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* recent graded picks */}
      <section className="panel overflow-x-auto rounded-sm">
        <p className="label-caps border-b border-border px-4 py-3">Recent graded picks — the full audit trail</p>
        <table className="w-full min-w-[720px] border-collapse font-mono2 text-xs">
          <thead>
            <tr className="border-b border-border text-left">
              {["DATE", "SPORT", "EVENT", "SELECTION", "ODDS", "EDGE", "RESULT", "UNITS", "CLV"].map((h) => (
                <th key={h} className="label-caps px-4 py-2 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-secondary/50">
                <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{fmtTime(r.placedAt)}</td>
                <td className="px-4 py-2.5 font-bold text-muted-foreground">{r.sportCode}</td>
                <td className="px-4 py-2.5">{r.eventLabel}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-bold">{r.selection}</td>
                <td className="px-4 py-2.5 tabular-nums">{fmtOdds(r.odds)}</td>
                <td className="px-4 py-2.5 tabular-nums text-primary">{r.edgeScore}</td>
                <td className={cn("px-4 py-2.5 font-bold uppercase", r.result === "won" ? "text-pos" : r.result === "lost" ? "text-neg" : "text-muted-foreground")}>
                  {r.result}
                </td>
                <td className={cn("px-4 py-2.5 tabular-nums", num(r.units) >= 0 ? "text-pos" : "text-neg")}>{num(r.units).toFixed(2)}</td>
                <td className={cn("px-4 py-2.5 tabular-nums", num(r.clvNoVig ?? r.clv) >= 0 ? "text-pos" : "text-neg")}>
                  {r.clvNoVig !== null ? `${num(r.clvNoVig).toFixed(2)}%` : `${num(r.clv).toFixed(2)}%*`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex flex-col gap-1.5">
        <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
          * How to read these numbers: UNITS show total profit measured in flat
          one-unit stakes (one unit = your normal bet size), so results are
          comparable no matter how big each bet was. ROI is profit as a
          percentage of the total amount staked. WIN RATE counts wins and
          losses only — pushes (ties/refunds) are excluded.
        </p>
        <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
          * CLV (Closing Line Value) measures whether our pick got a better
          price than the final odds right before the game started — the
          "closing line" is widely considered the sharpest price the market
          produces. We measure it against the NO-VIG closing price (the
          sportsbook's margin removed), which is the honest version — a price
          can appear to beat the raw close while the true fair value moved
          against it. AVG CLV is the average amount we beat the fair close
          by, and +CLV RATE is how often. Consistently positive CLV is the
          strongest single sign of a real, lasting edge — even more than
          short-term win rate. A CLV marked * is measured against the raw
          close because a full no-vig market wasn't available for that pick.
        </p>
        <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
          * MAX DRAWDOWN is the largest peak-to-trough drop the units curve
          has ever taken — a realistic picture of the worst losing stretch a
          follower would have lived through. Historical results are graded
          against closing lines and stored with full timestamps. Past
          performance never guarantees future results.
        </p>
      </div>
    </div>
  );
}

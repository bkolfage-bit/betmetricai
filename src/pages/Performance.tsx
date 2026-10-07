import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { SectionHead, Sparkline } from "@/components/bits";
import { SportFilter } from "@/components/SportFilter";
import { fmtOdds, fmtTime, num, pct, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Performance() {
  const [sport, setSport] = useState<string | null>(null);
  const { data } = trpc.performance.summary.useQuery(sport ? { sport } : undefined);
  if (!data) {
    return <div className="panel animate-pulse rounded-sm p-10 text-center font-mono2 text-xs text-muted-foreground">LOADING AUDIT TRAIL…</div>;
  }
  const o = data.overall;
  const curve = data.curve.filter((_, i) => i % 2 === 0).map((c) => c.units);

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="AI performance — full transparency"
        sub="Every graded pick is auditable. Losing picks are never hidden, records are never restated."
      />

      <SportFilter value={sport} onChange={setSport} />

      {/* headline stats */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2 sm:grid-cols-4 lg:grid-cols-8">
        {[
          ["PICKS", `${o.total}`],
          ["RECORD", `${o.wins}-${o.losses}-${o.pushes}`],
          ["WIN RATE", pct(o.winRate)],
          ["ROI", signedPct(o.roi)],
          ["UNITS", `${o.units >= 0 ? "+" : ""}${o.units.toFixed(1)}u`],
          ["AVG CLV", `${o.avgClv >= 0 ? "+" : ""}${o.avgClv.toFixed(2)}%`],
          ["+CLV RATE", pct(o.posClvPct, 0)],
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
              {["SPORT", "PICKS", "WIN%", "ROI", "UNITS", "AVG CLV", "+CLV RATE"].map((h) => (
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
                <td className={cn("px-4 py-2.5 tabular-nums", sp.avgClv >= 0 ? "text-pos" : "text-neg")}>{sp.avgClv.toFixed(2)}%</td>
                <td className="px-4 py-2.5 tabular-nums">{pct(sp.posClvPct, 0)}</td>
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
                <td className={cn("px-4 py-2.5 tabular-nums", num(r.clv) >= 0 ? "text-pos" : "text-neg")}>{num(r.clv).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
        * Historical results are graded against closing lines and stored with full
        timestamps. Past performance never guarantees future results. The current
        dataset is simulated DEMO DATA flowing through the real analytics pipeline.
      </p>
    </div>
  );
}
